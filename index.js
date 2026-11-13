/**
 * PMO button — Host half v0.12.0 (dual-line relay).
 * Per-session armed set, turn buffers, child registry, and the identity-prompt
 * fingerprint are persisted (pmo-state.json), so restarts lose nothing.
 *
 * Both directions of the review loop pass through this plugin:
 *  Line A (main → child): the `session/event` feed of an armed session buffers
 *     user/message + assistant/message per open turn; turn/end flushes the
 *     block to the log and forwards it to the persistent PMO child via
 *     subagents.sendMessage (cold resume when the child is not resident).
 *     A forward needs a ticket: fresh user speech in the turn, or a CONTINUE
 *     verdict since the last forward (0.11.2 gate, kept as the definition of
 *     "what is reviewable").
 *  Line B (child → main): the SAME `session/event` feed of the child session
 *     captures its closing text; the child's turn/end runs gate B (STATUS
 *     parse, check-in filter) and the plugin itself delivers the verdict to
 *     the main session with agent.followup().
 *  dsh's native return path is silenced: a cold-resumed activation always
 *     settles with delivery 'parent' (dsh-subagent coldResume passes no
 *     delivery), so an `agent/pre-step` listener drops the child's
 *     `subagent-settled` / `agent-message` notices before they reach the model.
 * No direct session-log reads: the JSONL persistence is zstd-compressed and
 * batch-flushed, while session/event is the documented post-commit surface.
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Schema from '@deepseek-ai/schemastery'
import { boundContextSummary, createUserMessage } from '@deepseek-ai/dsh-llm'

export const name = 'dsh-pmo-button'
export const inject = ['webServer']
/** Host-half version, logged on activation so an operator can tell which build
 *  the running Host actually imported (hot reload vs stale module). */
const HOST_VERSION = '0.12.0'

/** The identity prompt; delivered once per session and re-delivered only when its text changes. */
const ROLE_PROMPT_DEFAULT = [
  '你是本会话的常驻 PMO，代替用户审查父代理（主会话的编码代理）每一轮的工作。',
  '此设定长期有效，直到用户明确更改。',
  '',
  '【你会收到】父代理每轮结束后的转发块：',
  '- [用户] 用户原话：最高权威，目标和验收标准的唯一来源',
  '- [主代理] 该轮完整答复：待审对象，是自述，不是事实',
  '- [PMO审查] 你上一轮的审查意见（已由插件转达给主代理）：用于核对主代理是否照做，不是用户原话',
  '- [注入] 系统注入：忽略',
  '- [待命] 循环签到：PMO 重新启动的确认，不是审查请求',
  '',
  '【你的工作】',
  '1. 核实：以工作区的代码、diff、日志、运行结果为准。你只读，不改任何文件。',
  '2. 对照用户原话：是否偏离、越界加功能、漏项、把猜测当事实。',
  '3. 只给当前最重要的一步。',
  '',
  '【输出】作为你的结束语，不要另外发消息：',
  'STATUS: CONTINUE | DONE | NEED_HUMAN',
  '结论：一句话',
  '问题：最多 3 条，各附证据（文件/行号/输出）',
  '下一步：给主代理的具体可执行指令（非 CONTINUE 时省略）',
  '',
  '【规则】',
  '- 没有实质问题就 DONE，不为挑刺而挑刺。',
  '- 没见过用户原话、需求有歧义、同一问题连续两轮未解决、涉及不可逆操作',
  '  → NEED_HUMAN，写清需要用户决定什么。',
  '- 用户原话之外的改进建议一律不提。',
  '- 通讯纪律：不要使用 send_message 向父代理发送消息；你的结束语由 PMO 插件接管转达，无需另发。',
  '- 签到与审查分离：收到签到（[待命] 消息）时，只回复一句确认并保持待命，禁止输出 STATUS/DONE；收到「审查请求」（含 [用户] 新指令）或「续轮审查请求」（无新 [用户]，主代理在执行你上轮的 CONTINUE 下一步）时，按规程审查并输出 STATUS。',
].join('\n')

/** Source kind of the verdict messages this plugin delivers to the main session. */
const REVIEW_SOURCE_KIND = 'pmo-review'
/** dsh's own child→parent message kinds (dsh-subagent continuation-messages). */
const NATIVE_RETURN_KINDS = new Set(['subagent-settled', 'agent-message'])
/** Whole-line STATUS verdict; tolerates markdown emphasis around the line. */
const STATUS_LINE = /^[\s*#>`]*STATUS[\s*]*[:：][\s*`]*(CONTINUE|DONE|NEED_HUMAN)[\s*`]*$/m

/** @typedef {{ logFile: string, maxChars: number, provider: string, childLabel: string, greet: string, rolePrompt: string }} Config */
export const Config = Schema.object({
  /** Deterministic default: ~/.dsh/logs/pmo-button.log (cwd-relative defaults break on restarts). */
  logFile: Schema.string().default(path.join(os.homedir(), '.dsh', 'logs', 'pmo-button.log')),
  maxChars: Schema.number().default(4000),
  /** Subagent provider name registered on ctx.subagents (spawn-in-process default). */
  provider: Schema.string().default('spawn'),
  /** Persistent child label; the child session is reused across PMO starts. */
  childLabel: Schema.string().default('PMO 子代理'),
  /** Text sent to the child each time PMO starts (a check-in, NOT a review). */
  greet: Schema.string().default('PMO 循环已启动（签到，非审查请求）：审查官就位，用户的下一轮工作与审查请求将随后续转发块到达。请保持待命；本轮只需回复一句确认，不要输出 STATUS。'),
  /** Identity prompt; delivered once per session, again only when its text changes (empty disables). */
  rolePrompt: Schema.string().default(ROLE_PROMPT_DEFAULT),
  /** Review-round cap per session since the last user input; 0 disables the cap. */
  maxRounds: Schema.number().default(20),
  /** Child provider override; empty inherits the parent session's provider. */
  childModelProvider: Schema.string().default(''),
  /** Child model override; empty inherits the parent session's model. */
  childModel: Schema.string().default(''),
  /** Child reasoning-effort override; empty inherits the parent session's effort. */
  childReasoningEffort: Schema.string().default(''),
})

const SEP = '\n' + '─'.repeat(68) + '\n'

/** @param {import('@deepseek-ai/cordis').Context} ctx @param {Config} config */
export function apply(ctx, config) {
  const logPath = path.resolve(config.logFile)
  const statePath = path.join(path.dirname(logPath), 'pmo-state.json')
  const logger = ctx.logger ? ctx.logger('pmo-button') : console

  /** @type {Set<string>} */
  let enabled = new Set()
  /** sid -> { tasks: [{src,text}], texts: string[], usage: {input,output}, turn } */
  const buffers = new Map()
  const turnCounts = new Map()
  /** sid -> childId: the persistent PMO subagent session per parent session */
  const children = new Map()
  /** sid -> fingerprint of the identity prompt the child admitted (resent when the text changes) */
  const roleSent = new Map()
  /** childId -> closing text of the child's open turn (line B capture) */
  const childReports = new Map()
  /** sid -> native dsh notices dropped by the pre-step gate in the open turn */
  const gateDrops = new Map()
  /** sid -> true: the child returned STATUS=DONE — forward gate until user speech or restart */
  const doneSet = new Set()
  /** sid -> true: auto-stopped (STATUS !== CONTINUE or round cap) — button dimmed, listener live */
  const stopped = new Set()
  /** sid -> {provider?, model?, effort?, maxRounds?}: per-session overrides over global config */
  const overrides = new Map()
  /** sid -> fingerprint JSON of the effective review model (reset detector) */
  const modelFps = new Map()
  /** sid -> true: the last forward to the child was a review request (gates STATUS parsing) */
  const lastForwardReview = new Map()
  /** sid -> true: this session earned exactly one more forward — a fresh user turn,
   *  or a whole-line STATUS: CONTINUE verdict. The ticket is consumed by the forward
   *  and is never granted by a settlement notice, which is what breaks the echo loop
   *  (f5bb, 2026-11-13: every settlement woke the parent, and every parent turn was
   *  forwarded back to the same child until the 20-round cap). */
  const forwardAllowed = new Map()
  /** sid -> review rounds forwarded since the last user input (maxRounds cap) */
  const rounds = new Map()
  /** 'provider/model' -> display label (resolved via ctx.llm.listModels) */
  const labelCache = new Map()

  function emptyBuffer() {
    return {
      tasks: [], texts: [], usage: { input: 0, output: 0 },
      turn: undefined, model: undefined,
      provider: undefined, modelId: undefined, modelLabel: undefined, effort: undefined,
    }
  }

  // ---- persisted state (armed set, counters, in-flight buffers) -----------
  try {
    const raw = fs.readFileSync(statePath, 'utf8')
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed?.enabled)) enabled = new Set(parsed.enabled.map(String))
    if (parsed?.turnCounts && typeof parsed.turnCounts === 'object') {
      for (const [k, v] of Object.entries(parsed.turnCounts)) turnCounts.set(k, Number(v) || 0)
    }
    if (parsed?.buffers && typeof parsed.buffers === 'object') {
      for (const [sid, b] of Object.entries(parsed.buffers)) {
        if (!enabled.has(sid)) continue
        buffers.set(sid, {
          tasks: Array.isArray(b?.tasks) ? b.tasks : [],
          texts: Array.isArray(b?.texts) ? b.texts.map(String) : [],
          usage: { input: Number(b?.usage?.input) || 0, output: Number(b?.usage?.output) || 0 },
          turn: b?.turn,
          model: b?.model,
          provider: b?.provider,
          modelId: b?.modelId,
          modelLabel: b?.modelLabel,
          effort: b?.effort,
        })
      }
    }
    if (parsed?.children && typeof parsed.children === 'object') {
      for (const [sid, cid] of Object.entries(parsed.children)) children.set(sid, String(cid))
    }
    if (parsed?.roleSent && typeof parsed.roleSent === 'object') {
      // Pre-0.12 states stored `true`: it matches no fingerprint, so the
      // updated protocol prompt is delivered once on the next start.
      for (const [sid, fp] of Object.entries(parsed.roleSent)) roleSent.set(sid, String(fp))
    }
    if (parsed?.childReports && typeof parsed.childReports === 'object') {
      for (const [cid, text] of Object.entries(parsed.childReports)) childReports.set(cid, String(text))
    }
    if (parsed?.doneSet && typeof parsed.doneSet === 'object') {
      for (const sid of Object.keys(parsed.doneSet)) doneSet.add(sid)
    }
    if (parsed?.stopped && typeof parsed.stopped === 'object') {
      for (const sid of Object.keys(parsed.stopped)) stopped.add(sid)
    }
    if (parsed?.modelFps && typeof parsed.modelFps === 'object') {
      for (const [sid, f] of Object.entries(parsed.modelFps)) modelFps.set(sid, String(f))
    }
    if (parsed?.lastForwardReview && typeof parsed.lastForwardReview === 'object') {
      for (const sid of Object.keys(parsed.lastForwardReview)) lastForwardReview.set(sid, true)
    }
    if (parsed?.overrides && typeof parsed.overrides === 'object') {
      for (const [sid, ov] of Object.entries(parsed.overrides)) {
        if (ov && typeof ov === 'object') overrides.set(sid, { ...ov })
      }
    }
    if (parsed?.rounds && typeof parsed.rounds === 'object') {
      for (const [sid, n] of Object.entries(parsed.rounds)) rounds.set(sid, Number(n) || 0)
    }
  } catch { /* first run or unreadable state */ }

  function saveState() {
    const kept = {}
    for (const [sid, b] of buffers) if (enabled.has(sid)) kept[sid] = b
    const doc = {
      version: 10,
      enabled: [...enabled],
      turnCounts: Object.fromEntries(turnCounts),
      buffers: kept,
      children: Object.fromEntries(children),
      roleSent: Object.fromEntries(roleSent),
      childReports: Object.fromEntries(childReports),
      doneSet: Object.fromEntries([...doneSet.keys()].map((sid) => [sid, true])),
      stopped: Object.fromEntries([...stopped.keys()].map((sid) => [sid, true])),
      overrides: Object.fromEntries([...overrides].map(([k, v]) => [k, v])),
      modelFps: Object.fromEntries(modelFps),
      lastForwardReview: Object.fromEntries([...lastForwardReview.keys()].map((sid) => [sid, true])),
      rounds: Object.fromEntries(rounds),
    }
    try {
      fs.mkdirSync(path.dirname(statePath), { recursive: true })
      const tmp = statePath + '.tmp'
      fs.writeFileSync(tmp, JSON.stringify(doc, null, 2), 'utf8')
      fs.renameSync(tmp, statePath)
    } catch (err) { logger.warn?.(`pmo-button: state save failed: ${err}`) }
  }

  // ---- log writer ----------------------------------------------------------
  function stamp() { return new Date().toLocaleString('sv-SE').replace(' ', 'T') }
  function append(text) {
    try {
      fs.mkdirSync(path.dirname(logPath), { recursive: true })
      fs.appendFileSync(logPath, text, 'utf8')
      return true
    } catch (err) { logger.warn?.(`pmo-button: log append failed: ${err}`); return false }
  }
  function clip(s, limit = config.maxChars) {
    const t = String(s ?? '')
    if (t.length <= limit) return t
    return t.slice(0, limit) + `\n…(截断，原长 ${t.length} 字符)`
  }
  /** Never let credential-looking strings (npm_ tokens etc.) reach the log,
   *  the review forward, or the child's durable session. */
  function redact(s) {
    return String(s ?? '').replace(/npm_[A-Za-z0-9]{20,}/g, 'npm_***已脱敏***')
  }
  /** Per-injection cap: a settlement notice or a skill-catalog snapshot is
   *  optional context, never the review target. */
  const INJECT_BLOCK_MAX = 800
  /** Build a review forward with the review target first: [用户] and [主代理]
   *  are placed before any injection, and injections only consume the leftover
   *  budget. Before 0.11.2 a settlement notice plus skill-catalog snapshots could
   *  fill the whole 2×maxChars budget; the child then received only [注入] lines
   *  (f5bb turn=98, 2026-11-13: 13,398 chars clipped to 8,000 before the parent
   *  reply, so it correctly answered "不构成审查请求"). */
  function composeForward(turn, userBlock, mainBlock, otherTasks) {
    const budget = config.maxChars * 2
    const head = !userBlock && mainBlock
      ? `【PMO 轮次转发 · turn=${turn} · 续轮审查请求】本轮无新 [用户] 指令；主代理正在执行你上一轮 STATUS: CONTINUE 的"下一步"，请复审其答复并按规程输出 STATUS。\n`
      : `【PMO 轮次转发 · turn=${turn} · 审查请求】以下为用户本轮新输入（[用户]/[图片]）与主代理答复，请按规程审查并输出 STATUS。\n`
    let body = head
    if (userBlock) body += userBlock + '\n'
    if (mainBlock) {
      // Reserve room for the omission marker plus at least one small injection.
      body += clip(mainBlock, Math.max(200, budget - body.length - 260))
    }
    const injections = []
    for (const t of otherTasks) injections.push(`${otherLabel(t.src)} ${clip(t.text, INJECT_BLOCK_MAX)}`)
    let kept = 0
    for (const line of injections) {
      if (body.length + line.length + 1 > budget) break
      body += '\n' + line
      kept++
    }
    if (kept < injections.length) {
      body += `\n[注入已省略 ${injections.length - kept} 项：转发预算不足（[用户]/[主代理] 优先）]`
    }
    return clip(redact(body), budget)
  }
  /** Auto-stop: dim the button and gate forwarding WITHOUT deafening the
   * session listener — turn logging keeps running, and user speech (or a
   * button re-light) releases the gate so the loop can auto-resume. */
  function extinguish(sid, why) {
    stopped.add(sid)
    doneSet.add(sid)
    forwardAllowed.delete(sid)
    saveState()
    append(`${stamp()}  [PMO] 自动熄灭：${why}（转发静默；用户发言或重新点亮按钮恢复）\n`)
  }
  append(`${SEP}${stamp()}  [PMO 插件激活 v${HOST_VERSION}] 日志=${logPath}\n`)

  // ---- text helpers ----------------------------------------------------------
  // Surface payloads nest the real message under data.message
  // (observed: {turn, step, message:{role, content, source}, usage, stream}).
  function textOf(data) {
    const m = data?.message ?? data
    const c = m?.content
    if (typeof c === 'string') return c
    if (Array.isArray(c)) {
      return c.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n')
    }
    return ''
  }
  function sourceKind(data) {
    return data?.message?.source?.kind ?? data?.source?.kind ?? 'user'
  }
  // Only source.kind === 'user' is user speech. Every other producer kind
  // (runtime-context, time-context, steering, tool-jobs, this plugin's own
  // verdicts, kinds added by future plugins…) is context: MessageSourceMap is
  // merge-extensible, so a blacklist of known kinds can never be complete.
  const isUserTask = (t) => t.src === 'user'
  const isAttachTask = (t) => t.src === '__attach__'
  /** Log/forward label of one non-user task; the plugin's own verdicts get their own tag. */
  function otherLabel(src) {
    return src === REVIEW_SOURCE_KIND ? '[PMO审查]' : `[注入:${src}]`
  }
  function rolePromptFp() {
    return createHash('sha256').update(config.rolePrompt).digest('hex').slice(0, 16)
  }
  /** The armed parent session owning this PMO child, if any. */
  function parentOfChild(childId) {
    for (const [sid, cid] of children) if (cid === childId) return sid
    return undefined
  }
  /** Compact summary of non-text content blocks (images, files, references). */
  function nonTextSummaries(data) {
    const m = data?.message ?? data
    const c = m?.content
    if (!Array.isArray(c)) return []
    const out = []
    const home = process.env.DSH_HOME || path.join(process.env.USERPROFILE || process.env.HOME || '', '.dsh')
    function storePath(sha) {
      return path.join(home, 'attachments', 'v1', 'objects', sha.slice(0, 2), sha)
    }
    function humanSize(n) {
      const v = Number(n) || 0
      return v >= 1024 * 1024 ? (v / 1024 / 1024).toFixed(1) + 'MB' : v >= 1024 ? (v / 1024).toFixed(1) + 'KB' : v + 'B'
    }
    for (const b of c) {
      if (!b || b.type === 'text') continue
      // Observed image shape: {type:'image', attachment:{attachmentId:'sha256:<hex>',
      // mediaType, width, height, bytes, name}} — format it human-readably.
      if (b.type === 'image' && b.attachment && typeof b.attachment.attachmentId === 'string') {
        const a = b.attachment
        const sha = String(a.attachmentId).replace(/^sha256:/, '')
        const dim = a.width && a.height ? ` ${a.width}x${a.height}` : ''
        out.push(`[图片] ${a.name || '未命名'}（${dim.trim() || '尺寸未知'}, ${a.mediaType || '未知类型'}, ${humanSize(a.bytes)}）=> ${storePath(sha)}`)
        continue
      }
      let s = JSON.stringify(b)
      const sha = s.match(/[0-9a-f]{64}/i)
      if (sha) out.push(`[${b.type}] ${s.slice(0, 400)}${s.length > 400 ? '…' : ''} => ${storePath(sha[0])}`)
      else out.push(`[${b.type}] ${s.slice(0, 400)}${s.length > 400 ? '…' : ''}`)
    }
    return out
  }
  function effectiveFor(sid) {
    const ov = overrides.get(sid) || {}
    return {
      provider: ov.provider || config.childModelProvider,
      model: ov.model || config.childModel,
      effort: ov.effort || config.childReasoningEffort,
      maxRounds: ov.maxRounds !== undefined && ov.maxRounds !== null ? Number(ov.maxRounds) : config.maxRounds,
    }
  }
  /** Error message with its cause chain (SubagentError wraps the real reason in `cause`). */
  function errText(err) {
    const out = []
    for (let e = err, i = 0; e && i < 4; e = e.cause, i++) out.push(e.code ? `${e.message} [${e.code}]` : String(e.message ?? e))
    return out.join(' ← ')
  }
  function bufferFor(sid) {
    let b = buffers.get(sid)
    if (!b) { b = emptyBuffer(); buffers.set(sid, b) }
    return b
  }

  function flushTurn(sid, event) {
    const b = buffers.get(sid)
    // A turn opened only by dsh's native child notice is emptied by the
    // pre-step gate and closes without a step: nothing to log or forward.
    const dropped = gateDrops.get(sid) ?? 0
    gateDrops.delete(sid)
    if (dropped > 0 && (!b || (b.tasks.length === 0 && b.texts.length === 0))) return
    const turn = event?.data?.turn ?? b?.turn ?? '?'
    const reason = JSON.stringify(event?.data?.reason ?? event?.data ?? null)
    const lines = [`${SEP}${stamp()}  [轮次结束] session=${sid.slice(0, 12)}… turn=${turn} reason=${reason}`]

    const userTasks = (b?.tasks ?? []).filter(isUserTask)
    const attachTasks = (b?.tasks ?? []).filter(isAttachTask)
    const otherTasks = (b?.tasks ?? []).filter((t) => !isUserTask(t) && !isAttachTask(t))
    // Real user speech is the only unconditional forwarding ticket; a DONE-gated
    // turn is logged but not forwarded (breaks the settlement-echo cycle). A fresh
    // instruction also supersedes any verdict still pending from the last forward.
    const hasUser = userTasks.length > 0
    if (hasUser) {
      forwardAllowed.set(sid, true)
      lastForwardReview.set(sid, false)
      if (doneSet.has(sid) || rounds.has(sid) || stopped.has(sid)) {
        doneSet.delete(sid)
        stopped.delete(sid)
        rounds.delete(sid)
        saveState()
        append(`${stamp()}  [轮次转发] DONE 闸门解除：检测到用户输入，循环恢复\n`)
      }
    }
    const gated = doneSet.has(sid)

    if (!b || (b.tasks.length === 0 && b.texts.length === 0)) {
      lines.push('(PMO 在本轮中途开启或未捕获到内容：本块可能不完整)')
    }
    userTasks.forEach((t) => lines.push(`[PMO] ${clip(t.text)}`))
    attachTasks.forEach((t) => lines.push(clip(t.text)))
    otherTasks.forEach((t) => lines.push(`${otherLabel(t.src)} ${clip(t.text)}`))
    // assistant/message events fire PER STEP; the conversation view shows the
    // concatenation of all step texts, so join them in order to match it.
    if (b?.texts?.length > 0) {
      // Effort: event sniff first; else the host default selection, but only
      // when it matches the model that actually produced this turn's reply.
      let effSrc = b.effort
      if (!effSrc && b.provider && b.modelId) {
        const adm = ctx.get ? ctx.get('agentDefaultModel') : undefined
        const sel = adm && typeof adm.currentSelection === 'function' ? adm.currentSelection() : undefined
        if (sel && sel.provider === b.provider && sel.model === b.modelId) {
          effSrc = sel.reasoningEffort ?? sel.effort
        }
      }
      const eff = typeof effSrc === 'string' && effSrc
        ? ' ' + effSrc.charAt(0).toUpperCase() + effSrc.slice(1)
        : ''
      const modelPart = b.modelLabel
        || (b.provider && b.modelId ? `${b.provider}/${b.modelId}` : b.model)
      if (modelPart) lines.push(`[${modelPart}${eff}]`)
      if (userTasks.length > 0 || otherTasks.length > 0 || attachTasks.length > 0) lines.push('')
      lines.push(clip(b.texts.join('\n\n---\n\n')))
      const u = b.usage
      if (u && (u.input > 0 || u.output > 0)) {
        lines.push(`(usage: in=${u.input} out=${u.output})`)
      }
    } else if (userTasks.length > 0 || otherTasks.length > 0) {
      lines.push('(本轮未捕获 assistant 消息)')
    }

    if (append(lines.join('\n') + '\n')) {
      turnCounts.set(sid, (turnCounts.get(sid) ?? 0) + 1)
    }
    // ---- Line A: forward this turn's review block to the PMO child
    // (fire-and-forget; the verdict comes back on line B — see onChildEvent).
    // Forwarding requires a ticket: fresh user speech in this turn, or a whole-line
    // STATUS: CONTINUE verdict since the last forward. Turns woken by anything
    // else (other subagents' notices, system reminders) are never forwarded.
    const childId = children.get(sid)
    const ticket = forwardAllowed.get(sid) === true
    if (gated) {
      append(`${stamp()}  [轮次转发] turn=${turn} 跳过：DONE 后静默（等待用户输入或重新启动）\n`)
    } else if (!ticket) {
      append(`${stamp()}  [轮次转发] turn=${turn} 跳过：无用户输入且无 CONTINUE 判定（防回声）\n`)
    } else if (!childId || !b) {
      append(`${stamp()}  [轮次转发] turn=${turn} 跳过：无活跃子代理或空缓冲\n`)
    } else {
      // Attachments (images/files) are user material too: keep them in the
      // protected block, never in the optional injection budget.
      const userParts = userTasks.map((t) => `[用户] ${t.text}`)
      for (const a of attachTasks) userParts.push(a.text)
      const userBlock = userParts.join('\n')
      const mainBlock = b.texts?.length > 0 ? `[主代理] ${b.texts.join('\n\n---\n\n')}` : ''
      if (!userBlock && !mainBlock) {
        append(`${stamp()}  [轮次转发] turn=${turn} 跳过：无可审材料（只有注入）\n`)
      } else {
        const forward = composeForward(turn, userBlock, mainBlock, otherTasks)
        const agents = ctx.get('agents')
        const agent = agents && typeof agents.get === 'function' ? agents.get(sid) : undefined
        const subagentsSvc = ctx.get('subagents')
        if (!agent || !subagentsSvc || typeof subagentsSvc.sendMessage !== 'function') {
          append(`${stamp()}  [轮次转发] turn=${turn} 跳过：父会话无活跃 Agent 或 subagents 不可用\n`)
        } else {
          const controller = new AbortController()
          const effMax = effectiveFor(sid).maxRounds
          forwardAllowed.delete(sid) // consumed: the next forward needs a fresh user turn or CONTINUE
          lastForwardReview.set(sid, true)
          Promise.resolve(subagentsSvc.sendMessage(agent, childId, [{ type: 'text', text: forward }], { signal: controller.signal }))
            .then(() => {
              const n = (rounds.get(sid) ?? 0) + 1
              rounds.set(sid, n)
              saveState()
              append(`${stamp()}  [轮次转发] turn=${turn} 已送达 child=${String(childId).slice(0, 12)}…（第 ${n}${effMax > 0 ? '/' + effMax : ''} 轮审查）\n`)
              if (effMax > 0 && n >= effMax) extinguish(sid, `达到最大审查轮数 ${effMax}`)
            })
            .catch((err) => {
              lastForwardReview.set(sid, false)
              append(`${stamp()}  [轮次转发] turn=${turn} 失败: ${errText(err)}\n`)
            })
        }
      }
    }
    buffers.set(sid, emptyBuffer())
    saveState()
  }

  function logGoalChange(sid, event) {
    append(`${SEP}${stamp()}  [目标变化 ${event.type}] session=${sid.slice(0, 12)}…\n${clip(JSON.stringify(event.data))}\n`)
  }

  // ---- PMO subagent: one persistent continuable child per parent session ----
  // First start creates the child (it inherits the parent's model settings and
  // reasoning effort by default) and sends the greet; every later start reuses
  // the SAME persisted childId via sendMessage — the child cold-resumes from
  // its durable session when it is not resident. The creating activation uses
  // delivery:'caller' (no settlement notice, no send_message return guidance
  // appended to the prompt); cold-resumed activations fall back to 'parent'
  // inside dsh-subagent, which the pre-step gate below silences.
  //
  // The identity prompt (config.rolePrompt) rides the NEXT start once per
  // session — creation or reuse alike — and again only when its text changes.
  // Its fingerprint is committed only after the child admitted the message,
  // so a failed send auto-retries.
  async function ensureChildAndGreet(sid, agent) {
    const subagents = ctx.get('subagents')
    if (!subagents) throw new Error('subagents 服务未挂载')
    const roleFp = rolePromptFp()
    const prevRole = roleSent.get(sid)
    const needRole = config.rolePrompt.length > 0 && prevRole !== roleFp
    const roleText = prevRole === undefined ? config.rolePrompt : `【身份设定更新，取代此前版本】\n${config.rolePrompt}`
    const roleBlocks = needRole ? [{ type: 'text', text: roleText }] : []
    const existing = children.get(sid)
    if (existing) {
      // options.signal is required by sendMessage's admission path.
      const controller = new AbortController()
      const mid = await subagents.sendMessage(agent, existing, [...roleBlocks, { type: 'text', text: `[待命] ${config.greet}` }], { signal: controller.signal })
      if (needRole) {
        roleSent.set(sid, roleFp)
        saveState()
        append(`${stamp()}  [身份提示词] 已随问候下发 child=${String(existing).slice(0, 12)}…（文本不变则不再重复）\n`)
      }
      lastForwardReview.set(sid, false)
      append(`${stamp()}  [子代理] 已向持久会话发送问候 child=${String(existing).slice(0, 12)}… msg=${String(mid).slice(0, 8)}… text=${config.greet}\n`)
      return
    }
    // The parent travels INSIDE request (startActivation checks the exact live
    // agent: agents.get(request.parent.id) === request.parent); the top-level
    // spec.signal is required (resolveDirectory and admission call
    // spec.signal.throwIfAborted() unconditionally); request.prompt must be
    // CONTENT BLOCKS — withContinuableReturnGuidance spreads it (`[...prompt,
    // guidance]`), so a raw string would splinter into per-character blocks.
    const controller = new AbortController()
    const promptBlocks = [
      ...roleBlocks,
      { type: 'text', text: `[待命] ${config.greet}` },
    ]
    // agentOptions overrides (spawn capability): resolution order — session
    // override (per-session menu) → global config → inherit the parent
    // session's provider/model/reasoning effort (spawn README).
    const eff = effectiveFor(sid)
    const agentOptions = {}
    if (eff.provider) agentOptions.provider = eff.provider
    if (eff.model) agentOptions.model = eff.model
    if (eff.effort) agentOptions.reasoningEffort = eff.effort
    const request = { parent: agent, prompt: promptBlocks, description: config.childLabel }
    if (Object.keys(agentOptions).length > 0) request.agentOptions = agentOptions
    const act = await subagents.startActivation({
      provider: config.provider,
      label: config.childLabel,
      delivery: 'caller',
      signal: controller.signal,
      request,
    })
    children.set(sid, String(act.childId))
    lastForwardReview.set(sid, false)
    // Record the fingerprint of the model the child was born with, so a later
    // override change is detected even for state written before the field existed
    // (0.11.2: pre-upgrade sessions had no fingerprint and silently skipped the reset).
    modelFps.set(sid, JSON.stringify([eff.provider, eff.model, eff.effort]))
    if (needRole) {
      roleSent.set(sid, roleFp)
      append(`${stamp()}  [身份提示词] 已随首条消息下发 child=${String(act.childId).slice(0, 12)}…（文本不变则不再重复）\n`)
    }
    saveState()
    const providers = typeof subagents.list === 'function' ? subagents.list().join(',') : '?'
    append(`${stamp()}  [子代理] 已创建持久子代理「${config.childLabel}」 child=${String(act.childId).slice(0, 12)}… provider=${config.provider} 可用=[${providers}]\n`)
  }

  // ---- Line B: the child's verdict, delivered to the main session by the plugin
  // agent.followup() queues a next-turn prompt and wakes the driver — the same
  // call dsh-subagent's own sendWaking() makes for an idle parent. The source
  // kind is this plugin's own (MessageSourceMap is merge-extensible; consumers
  // fall through unknown kinds), so the main-session listener never mistakes a
  // verdict for user speech.
  function deliverVerdict(sid, childId, status, report) {
    const head = status === 'CONTINUE'
      ? `【PMO 审查 · STATUS=CONTINUE】以下是常驻 PMO 审查官对你上一轮工作的审查意见，代表用户授权：请按其"下一步"执行；不同意时说明理由并停下，不要自行改写目标。`
      : status === 'DONE'
        ? `【PMO 审查 · STATUS=DONE】审查官确认目标已达成，自动循环已停止。请只用一两句话向用户收尾，不要继续修改或开始新工作。`
        : `【PMO 审查 · STATUS=NEED_HUMAN】自动循环已停止，等待用户决定。请把下面审查官提出的待决事项原样转达给用户，然后停下，不要替用户做决定。`
    // Anything other than CONTINUE closes the forward gate BEFORE the main
    // session is woken, so its wrap-up turn is logged but never forwarded.
    // A CONTINUE verdict grants exactly one more forward (the ticket).
    if (status !== 'CONTINUE') extinguish(sid, `STATUS=${status}（循环停转）`)
    else forwardAllowed.set(sid, true)
    const agents = ctx.get('agents')
    const agent = agents && typeof agents.get === 'function' ? agents.get(sid) : undefined
    if (!agent || typeof agent.followup !== 'function') {
      if (status === 'CONTINUE') extinguish(sid, '主会话无活跃 Agent，审查意见未送达')
      else append(`${stamp()}  [线路B] 主会话无活跃 Agent，STATUS=${status} 未送达（见上方子代理报告）\n`)
      return
    }
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: `${head}\n\n${report}` }],
      source: {
        kind: REVIEW_SOURCE_KIND,
        form: 'notice',
        summary: boundContextSummary(`PMO 审查 STATUS=${status}`),
        senderSessionId: childId,
      },
    }))
    append(`${stamp()}  [线路B] STATUS=${status} 已送达主会话 session=${sid.slice(0, 12)}…\n`)
  }

  /** Gate B: runs when the PMO child's turn closes. */
  function onChildTurnEnd(sid, childId, event) {
    const report = redact(childReports.get(childId) ?? '')
    childReports.delete(childId)
    const reason = event?.data?.reason
    const kind = reason?.kind ?? '?'
    const wasReview = lastForwardReview.get(sid) === true
    lastForwardReview.set(sid, false)
    saveState()
    append(`${SEP}${stamp()}  [子代理报告] child=${String(childId).slice(0, 12)}… turn=${event?.data?.turn ?? '?'} reason=${JSON.stringify(reason ?? null)} ${wasReview ? '审查' : '签到/其他'}\n${clip(report) || '(无结束语)'}\n`)
    // Check-in acks and side conversations with the child stay on this side.
    if (!wasReview) return
    if (kind !== 'completed') {
      deliverVerdict(sid, childId, 'NEED_HUMAN', `审查官本轮未正常结束（${kind}），没有给出审查结论。${report ? '\n其最后输出：\n' + report : ''}`)
      return
    }
    const m = report.match(STATUS_LINE)
    if (!m) {
      deliverVerdict(sid, childId, 'NEED_HUMAN', `审查官未按协议输出 STATUS 行，循环无法自动判定。其原文：\n${report || '(无结束语)'}`)
      return
    }
    append(`${stamp()}  [PMO审查] STATUS=${m[1]}（来自子代理）\n`)
    deliverVerdict(sid, childId, m[1], report)
  }

  function onChildEvent(sid, childId, event) {
    const t = event.type
    if (t === 'turn/start') {
      childReports.delete(childId)
    } else if (t === 'assistant/message') {
      // Per-step event: the last non-empty text is the child's closing message.
      const text = textOf(event.data)
      if (text) { childReports.set(childId, text); saveState() }
    } else if (t === 'turn/end') {
      onChildTurnEnd(sid, childId, event)
    }
  }

  // ---- silence dsh's native child→parent path ------------------------------
  // Waterfall contract (dsh-agent-loop preStep): payload.messages are the
  // claimed inbox messages (already removed from the inbox), next() yields the
  // default {kind:'enter', messages:[...claimed, context?]}. A batch made only
  // of the PMO child's notices enters as an EMPTY step: on a turn's first step
  // the loop closes the turn without a model request, mid-turn it continues
  // with the tool results it already has. Mixed batches keep everything else.
  ctx.on('agent/pre-step', async (payload, next) => {
    let isNative
    try {
      const sid = payload?.agent?.id == null ? '' : String(payload.agent.id)
      // Applies to the plugin-owned child even while the button is off, so
      // switching off mid-review stops the loop instead of handing it to dsh.
      const childId = children.get(sid)
      const claimed = Array.isArray(payload?.messages) ? payload.messages : []
      isNative = (m) => childId !== undefined && NATIVE_RETURN_KINDS.has(m?.source?.kind) && m.source.senderSessionId === childId
      const hits = claimed.filter(isNative).length
      if (hits === 0) return next()
      gateDrops.set(sid, (gateDrops.get(sid) ?? 0) + hits)
      append(`${stamp()}  [闸门] 已拦截 dsh 原生回传 ${hits} 条 session=${sid.slice(0, 12)}… turn=${payload.turn} step=${payload.step}\n`)
      if (hits === claimed.length) return { kind: 'enter', messages: [] }
    } catch (err) {
      logger.warn?.(`pmo-button: pre-step gate error: ${err}`)
      return next()
    }
    const decision = await next()
    if (!decision || decision.kind !== 'enter' || !Array.isArray(decision.messages)) return decision
    return { ...decision, messages: decision.messages.filter((m) => !isNative(m)) }
  })

  // ---- the documented observation surface: session/event -------------------
  ctx.on('session/event', (session, event) => {
    try {
      if (!event || typeof event.type !== 'string') return
      const sid = session?.id == null ? '' : String(session.id)
      const parentSid = parentOfChild(sid)
      if (parentSid !== undefined) {
        if (enabled.has(parentSid)) onChildEvent(parentSid, sid, event)
        return
      }
      if (!enabled.has(sid)) return
      const t = event.type
      if (t === 'turn/start') {
        const b = bufferFor(sid)
        b.tasks = []
        b.texts = []
        b.usage = { input: 0, output: 0 }
        b.turn = event.data?.turn
        b.provider = undefined
        b.modelId = undefined
        b.modelLabel = undefined
        b.effort = undefined
      } else if (t === 'user/message') {
        const b = bufferFor(sid)
        const text = redact(textOf(event.data))
        // Harness system reminders (skill-catalog snapshots etc.) arrive as
        // user-role messages without a distinguishing source kind; classify
        // them by their text marker instead of defaulting to user input.
        const srcKind = text.trimStart().startsWith('<system-reminder>')
          ? 'system-reminder'
          : sourceKind(event.data)
        b.tasks.push({ src: srcKind, text: redact(text) })
        for (const s of nonTextSummaries(event.data)) b.tasks.push({ src: '__attach__', text: s })
        saveState()
      } else if (t === 'assistant/message') {
        const b = bufferFor(sid)
        const text = redact(textOf(event.data))
        if (text) b.texts.push(text)
        const src = event.data?.message?.source ?? event.data?.source
        if (src && src.kind === 'model' && src.provider && src.model) {
          b.provider = src.provider
          b.modelId = src.model
          const key = `${src.provider}/${src.model}`
          if (!labelCache.has(key)) {
            labelCache.set(key, undefined)
            const llm = ctx.get ? ctx.get('llm') : undefined
            // Empirical: resolveModel is absent from the service face exposed
            // to bundles; the display label lives in the listModels catalog
            // entry's `name` field (observed: {"id":"glm-5.3-flash","name":"GLM-5.3-Flash"}).
            if (llm && typeof llm.listModels === 'function') {
              Promise.resolve(llm.listModels(src.provider))
                .then((list) => {
                  const entry = Array.isArray(list)
                    ? list.find((e) => e && (e.id === src.model || e.model === src.model))
                    : undefined
                  const label = entry && (entry.name ?? entry.label ?? entry.displayName)
                  const v = typeof label === 'string' && label ? label : undefined
                  labelCache.set(key, v)
                  if (v) { b.modelLabel = v; saveState() }
                })
                .catch(() => { })
            }
          } else if (labelCache.get(key)) {
            b.modelLabel = labelCache.get(key)
          }
        }
        const u = event.data?.usage
        if (u) {
          b.usage.input += Number(u.inputTokens) || 0
          b.usage.output += Number(u.outputTokens) || 0
        }
        saveState()
      } else if (t === 'request/header') {
        // Best-effort sniff of the reasoning effort for the report prefix.
        const d = event.data || {}
        const ms = d.modelSelection || d.selection || d
        const eff = ms.reasoningEffort ?? ms.effort ?? d.reasoningEffort ?? d.effort
        if (typeof eff === 'string' && eff) bufferFor(sid).effort = eff
      } else if (t === 'turn/end') {
        flushTurn(sid, event)
      } else if (t.startsWith('goal/')) {
        logGoalChange(sid, event)
      }
    } catch (err) { logger.warn?.(`pmo-button: listener error: ${err}`) }
  })

  // ---- package-private routes (Client half is the only caller) ------------
  function json(obj, status = 200) {
    return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } })
  }
  async function handle(request) {
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/pmo-button')) return json({ ok: false, error: 'not found' }, 404)
    const rest = url.pathname.slice('/pmo-button'.length)
    if (request.method === 'GET' && (rest === '' || rest === '/ping')) {
      return json({ ok: true, route: 'alive', enabledSessions: [...enabled] })
    }
    if (request.method === 'GET' && rest === '/state') {
      const sid = url.searchParams.get('session') ?? 'unknown'
      return json({
        ok: true,
        sessionId: sid,
        enabled: enabled.has(sid) && !stopped.has(sid),
        turns: turnCounts.get(sid) ?? 0,
      })
    }
    if (request.method === 'GET' && rest === '/config') {
      const editor = ctx.get('configEditor')
      return json({ ok: true, config: { ...config }, editorAvailable: editor !== void 0 })
    }
    if (request.method === 'GET' && rest === '/config/save') {
      // Persisted through the configEditor user layer (survives upgrades) and
      // validated by the same Schemastery schema the Loader applies. GET with
      // query params: the desktop shell was observed to drop same-origin POSTs.
      const editor = ctx.get('configEditor')
      const entry = ctx.fiber && ctx.fiber.entry !== undefined ? ctx.fiber.entry : undefined
      if (!editor || entry === undefined) return json({ ok: false, error: '当前部署不支持持久配置保存' }, 400)
      const q = url.searchParams
      const patch = {}
      if (q.has('maxRounds')) patch.maxRounds = Math.max(0, Math.floor(Number(q.get('maxRounds')) || 0))
      if (q.has('maxChars')) patch.maxChars = Math.max(200, Math.floor(Number(q.get('maxChars')) || 4000))
      for (const k of ['logFile', 'provider', 'childLabel', 'greet', 'rolePrompt', 'childModelProvider', 'childModel', 'childReasoningEffort']) {
        if (q.has(k)) patch[k] = String(q.get(k))
      }
      let validated
      try { validated = Config({ ...config, ...patch }) } catch (err) {
        return json({ ok: false, error: String((err && err.message) || err) }, 400)
      }
      await editor.edit(entry, () => ({ ...validated }))
      return json({ ok: true, config: validated })
    }
    if (request.method === 'GET' && rest === '/models') {
      // The same catalog the composer's model selector consumes: providers ×
      // advertised models (id + display name). `llm.listProviders()` returns
      // LlmProviderInfo ({id,name}) — passing the object straight to listModels
      // silently emptied this route before 0.12.1.
      const llm = ctx.get('llm')
      if (!llm || typeof llm.listProviders !== 'function') return json({ ok: false, error: 'llm 服务不可用' }, 400)
      const out = []
      const providers = await llm.listProviders()
      for (const p of Array.isArray(providers) ? providers : []) {
        const id = typeof p === 'string' ? p : (p && p.id)
        if (!id) continue
        const name = typeof p === 'string' ? p : ((p && p.name) || id)
        try {
          const models = await llm.listModels(id)
          if (Array.isArray(models)) {
            out.push({
              provider: id,
              name,
              models: models.map((m) => ({
                id: m.id ?? m.model ?? '',
                name: m.name ?? m.label ?? m.id ?? m.model ?? '',
              })),
            })
          }
        } catch { /* catalog-less provider: skip */ }
      }
      return json({ ok: true, providers: out })
    }
    if (request.method === 'GET' && rest === '/providers') {
      const subagents = ctx.get('subagents')
      const list = subagents && typeof subagents.list === 'function' ? subagents.list() : []
      return json({ ok: true, providers: Array.isArray(list) ? list : [] })
    }
    if (request.method === 'GET' && rest === '/session-config') {
      const sid = url.searchParams.get('session') ?? 'unknown'
      return json({ ok: true, sessionId: sid, override: overrides.get(sid) || null })
    }
    if (request.method === 'GET' && rest === '/session-config/set') {
      const sid = url.searchParams.get('session')
      if (!sid || sid === 'unknown') return json({ ok: false, error: 'missing session' }, 400)
      const cur = { ...(overrides.get(sid) || {}) }
      for (const k of ['provider', 'model', 'effort']) {
        if (url.searchParams.has(k)) {
          const v = String(url.searchParams.get(k) || '')
          if (v) cur[k] = v
          else delete cur[k]
        }
      }
      if (url.searchParams.has('maxRounds')) {
        const n = Math.floor(Number(url.searchParams.get('maxRounds')))
        if (Number.isFinite(n) && n > 0) cur.maxRounds = n
        else delete cur.maxRounds
      }
      overrides.set(sid, cur)
      saveState()
      return json({ ok: true, sessionId: sid, override: cur, effective: effectiveFor(sid) })
    }
    if (rest === '/toggle') {
      let sid, on
      if (request.method === 'GET') {
        sid = String(url.searchParams.get('session') ?? 'unknown')
        const flag = url.searchParams.get('enabled')
        on = flag === '1' || flag === 'true'
      } else {
        let body
        try { body = await request.json() } catch { return json({ ok: false, error: 'bad json' }, 400) }
        sid = String(body?.sessionId ?? 'unknown')
        on = Boolean(body?.enabled)
      }
      if (on) {
        // A changed effective review model invalidates the existing child: its
        // model is baked into the durable descriptor, so reset to a fresh
        // child (review memory clears — documented trade-off). Pre-upgrade state
        // has no fingerprint; if any override is configured, treat the existing
        // child as unverified and reset it rather than silently keeping the old
        // model (0.11.2).
        const eff = effectiveFor(sid)
        const fp = JSON.stringify([eff.provider, eff.model, eff.effort])
        const prev = modelFps.get(sid)
        const hasModelOverride = Boolean(eff.provider || eff.model || eff.effort)
        const modelChanged = prev === undefined ? hasModelOverride : prev !== fp
        if (modelChanged && children.has(sid)) {
          childReports.delete(children.get(sid))
          children.delete(sid)
          roleSent.delete(sid)
          append(`${stamp()}  [子代理] 审查模型配置变更或指纹缺失，已重置审查官：下次启动创建新子代理（审查模型：${eff.provider || '继承主会话'}/${eff.model || '继承主会话'}${eff.effort ? ' ' + eff.effort : ''}；审查记忆清零）\n`)
        }
        modelFps.set(sid, fp)
        enabled.add(sid)
        turnCounts.set(sid, turnCounts.get(sid) ?? 0)
        stopped.delete(sid)
        doneSet.delete(sid)
        rounds.delete(sid)
        lastForwardReview.delete(sid)
        forwardAllowed.delete(sid)
      } else {
        enabled.delete(sid)
        forwardAllowed.delete(sid)
      }
      saveState()
      append(`${SEP}${stamp()}  [PMO ${on ? '启动' : '停止'}] session=${sid.slice(0, 12)}…\n`)
      if (on && sid !== 'unknown') {
        const agents = ctx.get('agents')
        const agent = agents && typeof agents.get === 'function' ? agents.get(sid) : undefined
        if (!agents || !agent) {
          append(`${stamp()}  [子代理] 无法启动：当前会话无活跃 Agent（agents=${agents ? '有' : '无'}）\n`)
        } else {
          ensureChildAndGreet(sid, agent).catch((err) => {
            const msg = err && err.message ? err.message : String(err)
            const stack = err && err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : ''
            let provs = '?'
            try {
              const s = ctx.get('subagents')
              provs = s && typeof s.list === 'function' ? s.list().join(',') : 'list不可用'
            } catch { /* ignore */ }
            append(`${stamp()}  [子代理] 失败: ${msg}；可用提供方=[${provs}] 已尝试=${config.provider}；栈顶: ${stack}\n`)
          })
        }
      }
      return json({ ok: true, sessionId: sid, enabled: on, turns: turnCounts.get(sid) ?? 0, child: children.get(sid) ?? null })
    }
    return json({ ok: false, error: 'not found' }, 404)
  }

  const webServer = ctx.get('webServer')
  if (webServer) {
    ctx.effect(() => webServer.register({ kind: 'prefix', path: '/pmo-button', resource: handle }), 'pmo-button: routes')
  } else {
    logger.warn?.('pmo-button: webServer absent — Client 将无法同步开关状态')
  }
}
