/**
 * PMO button — Host half v0.10.0.
 * Per-session armed set, turn buffers, child registry, and the once-per-session
 * identity-prompt flag are persisted (pmo-state.json), so restarts lose nothing.
 * The `session/event` feed drives two jobs for armed sessions:
 *  1. turn-completion logging — user/message + assistant/message are buffered
 *     per open turn (the two surface types carrying model-visible content) and
 *     flushed to the log file when turn/end closes the turn;
 *  2. the auto-review loop — the flushed blocks are forwarded to the persistent
 *     PMO child (created once per session on startActivation, reused via
 *     sendMessage with cold resume), whose STATUS closing line returns to this
 *     session through the delivery:'parent' settlement notice and is recognized
 *     and logged here.
 * No direct session-log reads: the JSONL persistence is zstd-compressed and
 * batch-flushed, while session/event is the documented post-commit surface.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Schema from '@deepseek-ai/schemastery'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

export const name = 'dsh-pmo-button'
export const inject = ['webServer']

/** The identity prompt delivered exactly once per session (user-authored 原文). */
const ROLE_PROMPT_DEFAULT = [
  '你是本会话的常驻 PMO，代替用户审查父代理（主会话的编码代理）每一轮的工作。',
  '此设定长期有效，直到用户明确更改。',
  '',
  '【你会收到】父代理每轮结束后的转发块：',
  '- [用户] 用户原话：最高权威，目标和验收标准的唯一来源',
  '- [主代理] 该轮完整答复：待审对象，是自述，不是事实',
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
  '- 通讯纪律：不要使用 send_message 向父代理发送消息；你的结束语会随结算自动回传父会话，无需另发。',
  '- 签到与审查分离：收到签到（无 [用户] 新指令的 [待命] 消息）时，只回复一句确认并保持待命，禁止输出 STATUS/DONE；只有收到含 [用户] 新指令的转发块时，才按规程输出 STATUS。',
].join('\n')

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
  /** Identity prompt; delivered exactly once per session (empty disables). */
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
  /** sid -> true: the identity prompt was admitted by the child (once per session) */
  const roleSent = new Map()
  /** sid -> true: the child returned STATUS=DONE — forward gate until user speech or restart */
  const doneSet = new Set()
  /** sid -> true: auto-stopped (STATUS !== CONTINUE or round cap) — button dimmed, listener live */
  const stopped = new Set()
  /** sid -> review rounds forwarded since the last user input (maxRounds cap) */
  const rounds = new Map()
  /** persisted fingerprint of the child-model override triple (reset detector) */
  let stateModelFp
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
      for (const sid of Object.keys(parsed.roleSent)) roleSent.set(sid, true)
    }
    if (parsed?.doneSet && typeof parsed.doneSet === 'object') {
      for (const sid of Object.keys(parsed.doneSet)) doneSet.add(sid)
    }
    if (parsed?.stopped && typeof parsed.stopped === 'object') {
      for (const sid of Object.keys(parsed.stopped)) stopped.add(sid)
    }
    if (parsed?.rounds && typeof parsed.rounds === 'object') {
      for (const [sid, n] of Object.entries(parsed.rounds)) rounds.set(sid, Number(n) || 0)
    }
    if (typeof parsed?.modelFp === 'string') stateModelFp = parsed.modelFp
  } catch { /* first run or unreadable state */ }

  function saveState() {
    const kept = {}
    for (const [sid, b] of buffers) if (enabled.has(sid)) kept[sid] = b
    const doc = {
      version: 8,
      enabled: [...enabled],
      turnCounts: Object.fromEntries(turnCounts),
      buffers: kept,
      children: Object.fromEntries(children),
      roleSent: Object.fromEntries([...roleSent.keys()].map((sid) => [sid, true])),
      doneSet: Object.fromEntries([...doneSet.keys()].map((sid) => [sid, true])),
      stopped: Object.fromEntries([...stopped.keys()].map((sid) => [sid, true])),
      rounds: Object.fromEntries(rounds),
      modelFp: stateModelFp,
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
  /** Auto-stop: dim the button and gate forwarding WITHOUT deafening the
   * session listener — turn logging keeps running, and user speech (or a
   * button re-light) releases the gate so the loop can auto-resume. */
  function extinguish(sid, why) {
    stopped.add(sid)
    doneSet.add(sid)
    saveState()
    append(`${stamp()}  [PMO] 自动熄灭：${why}（转发静默；用户发言或重新点亮按钮恢复）\n`)
  }
  append(`${SEP}${stamp()}  [PMO 插件激活] 日志=${logPath}\n`)

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
  const OTHER_SOURCES = new Set(['inject', 'steering', 'time-context', 'agent-message', 'subagent-settled', 'system-reminder', 'tool-jobs'])
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
  function bufferFor(sid) {
    let b = buffers.get(sid)
    if (!b) { b = emptyBuffer(); buffers.set(sid, b) }
    return b
  }

  function flushTurn(sid, event) {
    const b = buffers.get(sid)
    const turn = event?.data?.turn ?? b?.turn ?? '?'
    const reason = JSON.stringify(event?.data?.reason ?? event?.data ?? null)
    const lines = [`${SEP}${stamp()}  [轮次结束] session=${sid.slice(0, 12)}… turn=${turn} reason=${reason}`]

    const userTasks = (b?.tasks ?? []).filter((t) => !OTHER_SOURCES.has(t.src) && t.src !== '__attach__')
    const attachTasks = (b?.tasks ?? []).filter((t) => t.src === '__attach__')
    const otherTasks = (b?.tasks ?? []).filter((t) => OTHER_SOURCES.has(t.src))
    // Real user speech re-opens the loop after a DONE gate; a DONE-gated turn
    // is logged but not forwarded (breaks the settlement-echo cycle).
    if (userTasks.length > 0 && (doneSet.has(sid) || rounds.has(sid) || stopped.has(sid))) {
      doneSet.delete(sid)
      stopped.delete(sid)
      rounds.delete(sid)
      saveState()
      append(`${stamp()}  [轮次转发] DONE 闸门解除：检测到用户输入，循环恢复\n`)
    }
    const gated = doneSet.has(sid)

    if (!b || (b.tasks.length === 0 && b.texts.length === 0)) {
      lines.push('(PMO 在本轮中途开启或未捕获到内容：本块可能不完整)')
    }
    userTasks.forEach((t) => lines.push(`[PMO] ${clip(t.text)}`))
    attachTasks.forEach((t) => lines.push(clip(t.text)))
    otherTasks.forEach((t) => lines.push(`[注入:${t.src}] ${clip(t.text)}`))
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
    // ---- Phase-2 auto-loop: forward this turn's review blocks to the PMO child
    // (fire-and-forget; the child's STATUS closing line returns to this session
    // through the delivery:'parent' settlement notice and wakes the next step).
    const childId = children.get(sid)
    if (gated) {
      append(`${stamp()}  [轮次转发] turn=${turn} 跳过：DONE 后静默（等待用户输入或重新启动）\n`)
    } else if (childId && b && (b.texts?.length > 0 || b.tasks?.length > 0)) {
      const parts = []
      userTasks.forEach((t) => parts.push(`[用户] ${t.text}`))
      otherTasks.forEach((t) => parts.push(`[注入:${t.src}] ${t.text}`))
      attachTasks.forEach((t) => parts.push(t.text))
      if (b.texts?.length > 0) parts.push(`[主代理] ${b.texts.join('\n\n---\n\n')}`)
      const forward = clip(redact(`【PMO 轮次转发 · turn=${turn} · 审查请求】以下为用户本轮新输入（[PMO]/[图片]）与主代理完整答复，请按规程审查并输出 STATUS；若本轮无 [用户] 新指令，仅确认收到即可，不要输出 DONE。\n` + parts.join('\n')), config.maxChars * 2)
      const agents = ctx.get('agents')
      const agent = agents && typeof agents.get === 'function' ? agents.get(sid) : undefined
      const subagentsSvc = ctx.get('subagents')
      if (!agent || !subagentsSvc || typeof subagentsSvc.sendMessage !== 'function') {
        append(`${stamp()}  [轮次转发] turn=${turn} 跳过：父会话无活跃 Agent 或 subagents 不可用\n`)
      } else {
        const controller = new AbortController()
        Promise.resolve(subagentsSvc.sendMessage(agent, childId, [{ type: 'text', text: forward }], { signal: controller.signal }))
          .then(() => {
            const n = (rounds.get(sid) ?? 0) + 1
            rounds.set(sid, n)
            saveState()
            append(`${stamp()}  [轮次转发] turn=${turn} 已送达 child=${String(childId).slice(0, 12)}…（第 ${n}${config.maxRounds > 0 ? '/' + config.maxRounds : ''} 轮审查）\n`)
            if (config.maxRounds > 0 && n >= config.maxRounds) extinguish(sid, `达到最大审查轮数 ${config.maxRounds}`)
          })
          .catch((err) => append(`${stamp()}  [轮次转发] turn=${turn} 失败: ${err && err.message ? err.message : err}\n`))
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
  // its durable session when it is not resident. delivery:'parent' makes the
  // parent session receive the child's completion notice.
  //
  // The identity prompt (config.rolePrompt) rides the NEXT start exactly once
  // per session — creation or reuse alike — and its flag is committed only
  // after the child admitted the message, so a failed send auto-retries.
  async function ensureChildAndGreet(sid, agent) {
    const subagents = ctx.get('subagents')
    if (!subagents) throw new Error('subagents 服务未挂载')
    const needRole = config.rolePrompt.length > 0 && !roleSent.has(sid)
    const roleBlocks = needRole ? [{ type: 'text', text: config.rolePrompt }] : []
    const existing = children.get(sid)
    if (existing) {
      // options.signal is required by sendMessage's admission path.
      const controller = new AbortController()
      const mid = await subagents.sendMessage(agent, existing, [...roleBlocks, { type: 'text', text: config.greet }], { signal: controller.signal })
      if (needRole) {
        roleSent.set(sid, true)
        saveState()
        append(`${stamp()}  [身份提示词] 已随问候一次性下发 child=${String(existing).slice(0, 12)}…（本会话不会重复）\n`)
      }
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
      { type: 'text', text: config.greet },
    ]
    // agentOptions overrides (spawn capability): empty strings inherit the
    // parent session's provider/model/reasoning effort (spawn README: the
    // child inherits provider, model, reasoning effort unless agentOptions).
    const overrides = {}
    if (config.childModelProvider) overrides.provider = config.childModelProvider
    if (config.childModel) overrides.model = config.childModel
    if (config.childReasoningEffort) overrides.reasoningEffort = config.childReasoningEffort
    const request = { parent: agent, prompt: promptBlocks, description: config.childLabel }
    if (Object.keys(overrides).length > 0) request.agentOptions = overrides
    const act = await subagents.startActivation({
      provider: config.provider,
      label: config.childLabel,
      delivery: 'parent',
      signal: controller.signal,
      request,
    })
    children.set(sid, String(act.childId))
    if (needRole) {
      roleSent.set(sid, true)
      append(`${stamp()}  [身份提示词] 已随首条消息一次性下发 child=${String(act.childId).slice(0, 12)}…（本会话不会重复）\n`)
    }
    saveState()
    const providers = typeof subagents.list === 'function' ? subagents.list().join(',') : '?'
    append(`${stamp()}  [子代理] 已创建持久子代理「${config.childLabel}」 child=${String(act.childId).slice(0, 12)}… provider=${config.provider} 可用=[${providers}]\n`)
  }

  // ---- the documented observation surface: session/event -------------------
  ctx.on('session/event', (session, event) => {
    try {
      if (!event || typeof event.type !== 'string') return
      const sid = session?.id == null ? '' : String(session.id)
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
        // Recognize the PMO child's STATUS protocol from its settlement notice
        // or direct adjacent message, and record the review verdict.
        const src2 = event.data?.message?.source ?? event.data?.source
        if (src2 && (src2.kind === 'subagent-settled' || src2.kind === 'agent-message')) {
          const m = textOf(event.data).match(/STATUS:\s*(CONTINUE|DONE|NEED_HUMAN)/)
          if (m) {
            append(`${stamp()}  [PMO审查] STATUS=${m[1]}（来自子代理）\n`)
            // Pair the notice with the authority-alignment instruction: the
            // review speaks with user authority — execute its next step unless
            // the parent disagrees, and then it must stop and say why.
            try {
              const agentsSvc = ctx.get('agents')
              const a = agentsSvc && typeof agentsSvc.get === 'function' ? agentsSvc.get(sid) : undefined
              if (a && typeof a.inject === 'function') {
                a.inject(createUserMessage({
                  content: [{ type: 'text', text: `收到 PMO 审查（STATUS=${m[1]}）：子代理消息代表用户授权的审查意见，请按其"下一步"执行；不同意时说明理由并停下。` }],
                  source: { kind: 'inject' },
                }))
              }
            } catch (err) { logger.warn?.(`pmo-button: alignment inject failed: ${err}`) }
            // Anything other than CONTINUE stops the auto-loop: the button
            // extinguishes; re-light it or speak to resume.
            if (m[1] !== 'CONTINUE') {
              doneSet.add(sid)
              extinguish(sid, `STATUS=${m[1]}（循环停转）`)
            }
          }
        }
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
        // A changed model override invalidates the existing child: its model
        // is baked into the durable descriptor, so reset to a fresh child
        // (review memory clears — documented trade-off).
        const fp = JSON.stringify([config.childModelProvider, config.childModel, config.childReasoningEffort])
        if (stateModelFp !== undefined && stateModelFp !== fp && children.has(sid)) {
          children.delete(sid)
          roleSent.delete(sid)
          append(`${stamp()}  [子代理] 模型配置变更，已重置审查官：下次启动创建新子代理（新审查模型：${config.childModelProvider || '继承主会话'}/${config.childModel || '继承主会话'}${config.childReasoningEffort ? ' ' + config.childReasoningEffort : ''}；审查记忆清零）\n`)
        }
        stateModelFp = fp
        enabled.add(sid)
        turnCounts.set(sid, turnCounts.get(sid) ?? 0)
        stopped.delete(sid)
        doneSet.delete(sid)
        rounds.delete(sid)
      } else enabled.delete(sid)
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
