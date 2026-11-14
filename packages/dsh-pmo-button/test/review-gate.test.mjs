/**
 * Regression tests for the PMO review loop: the forward ticket gate and
 * payload priority (v0.11.2), and the dual-line relay (v0.12.0) — verdicts are
 * read from the child session's own events and delivered by the plugin, while
 * dsh's native child notices are dropped at agent/pre-step.
 *
 * Replays the 2026-11-13 f5bb incident shape against the real plugin `apply()`:
 * a settlement-notice-triggered turn must never be forwarded, a verdict-less
 * reply must stop the loop, CONTINUE must earn exactly one continuation review,
 * DONE must hold the gate, and injections must never crowd [用户]/[主代理] out
 * of the forward budget.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { apply } from '../index.js'

const SID = 'session-test'
const CHILD = 'child-test'

function harness(state, opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmo-gate-'))
  const logFile = path.join(dir, 'pmo.log')
  if (state) fs.writeFileSync(path.join(dir, 'pmo-state.json'), JSON.stringify(state), 'utf8')

  const listeners = {}
  const sent = []
  const activated = []
  const followups = []
  let route
  const agent = { id: SID, followup: (m) => followups.push(m) }
  const subagents = {
    list: () => ['spawn'],
    sendMessage: async (sender, targetId, content) => {
      sent.push({ targetId: String(targetId), text: content.map((c) => c.text).join('\n') })
      return 'msg-test'
    },
    startActivation: async (spec) => {
      activated.push(spec)
      return { childId: CHILD, result: Promise.resolve({}), dispose: async () => {} }
    },
  }
  const ctx = {
    on: (name, fn) => { (listeners[name] ??= []).push(fn); return () => {} },
    get: (name) => ({
      webServer: { register: (r) => { route = r.resource; return () => {} } },
      agents: { get: (id) => (String(id) === SID ? agent : undefined) },
      subagents,
      llm: opts.llm,
      agentDefaultModel: undefined,
      configEditor: undefined,
    }[name]),
    logger: () => ({ warn: () => {}, info: () => {}, debug: () => {} }),
    effect: (fn) => { fn(); return () => {} },
  }
  apply(ctx, {
    logFile,
    maxChars: 4000,
    provider: 'spawn',
    childLabel: 'PMO 子代理',
    greet: '签到问候',
    rolePrompt: '身份规程',
    maxRounds: 20,
    childModelProvider: '',
    childModel: '',
    childReasoningEffort: '',
  })

  const emitTo = (sid, event) => listeners['session/event'].forEach((fn) => fn({ id: sid }, event))
  const emit = (event) => emitTo(SID, event)
  /** One whole turn of the PMO child: its closing text, then turn/end. */
  const childTurn = (text, reason = { kind: 'completed' }) => {
    emitTo(CHILD, { type: 'turn/start', data: { turn: 1 } })
    if (text) emitTo(CHILD, { type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text }], source: { kind: 'model', provider: 'test', model: 'm1' } } } })
    emitTo(CHILD, { type: 'turn/end', data: { turn: 1, reason } })
  }
  /** Replay a verdict the plugin delivered, as the main session commits it. */
  const commitVerdict = (m) => emit({ type: 'user/message', data: { role: 'user', content: m.content, source: m.source } })
  const native = (kind = 'subagent-settled', id = 'n1') => ({ id, source: { kind, senderSessionId: CHILD } })
  const preStep = (messages, dflt, agentId = SID) => listeners['agent/pre-step'][0]({ agent: { id: agentId }, messages, turn: 1, step: 1 }, async () => dflt)
  const turnStart = (turn) => emit({ type: 'turn/start', data: { turn } })
  const turnEnd = (turn) => emit({ type: 'turn/end', data: { turn, reason: { kind: 'completed' } } })
  const userMsg = (text, kind = 'user') => emit({
    type: 'user/message',
    data: { role: 'user', content: [{ type: 'text', text }], source: { kind } },
  })
  const assistantMsg = (text) => emit({
    type: 'assistant/message',
    data: {
      turn: 1,
      step: 1,
      message: { role: 'assistant', content: [{ type: 'text', text }], source: { kind: 'model', provider: 'test', model: 'm1' } },
    },
  })
  const settlement = (text, kind = 'subagent-settled') => emit({
    type: 'user/message',
    data: {
      role: 'user',
      content: [{ type: 'text', text }],
      source: { kind, form: 'notice', summary: text, senderSessionId: CHILD },
    },
  })
  const imageMsg = (name) => emit({
    type: 'user/message',
    data: {
      role: 'user',
      content: [{
        type: 'image',
        attachment: {
          attachmentId: 'sha256:' + 'a'.repeat(64),
          mediaType: 'image/png',
          width: 12,
          height: 8,
          bytes: 1234,
          name,
        },
      }],
      source: { kind: 'user' },
    },
  })
  const toggle = async (on) => {
    const res = await route(new Request(`http://x/pmo-button/toggle?session=${SID}&enabled=${on ? 1 : 0}`))
    return res.json()
  }
  const forwards = () => sent.filter((s) => s.text.startsWith('【PMO 轮次转发'))
  const logText = () => fs.readFileSync(logFile, 'utf8')
  const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms))
  const cleanup = () => fs.rmSync(dir, { recursive: true, force: true })
  return { dir, sent, activated, followups, childTurn, commitVerdict, native, preStep, toggle, forwards, logText, wait, cleanup, turnStart, turnEnd, userMsg, assistantMsg, settlement, imageMsg, route }
}

test('f5bb replay: a settlement-notice-only turn is never forwarded', async (t) => {
  const h = harness()
  t.after(() => h.cleanup())
  await h.toggle(true)
  await h.wait()
  assert.equal(h.forwards().length, 0)

  h.turnStart(1)
  h.settlement('Background subagent child-test finished and will do no further work unless you send it more.\nIts closing message:\n（无输出）')
  h.assistantMsg('已忽略。')
  h.turnEnd(1)
  await h.wait()

  assert.equal(h.forwards().length, 0, 'settlement-only turn must not pump the child')
  assert.match(h.logText(), /防回声/)
})

test('user turn forwards; a verdict-less reply stops the loop', async (t) => {
  const h = harness()
  t.after(() => h.cleanup())
  await h.toggle(true)
  await h.wait()

  h.turnStart(2)
  h.userMsg('请复核这次改动')
  h.assistantMsg('改好了')
  h.turnEnd(2)
  await h.wait()
  const first = h.forwards()
  assert.equal(first.length, 1)
  assert.match(first[0].text, /\[用户\] 请复核这次改动/)
  assert.match(first[0].text, /\[主代理\] 改好了/)

  // The child answers without a STATUS line (the f5bb "不构成审查请求" shape):
  // the loop stops and the user is told, instead of idling silently.
  h.childTurn('收到转发块：本轮无 [用户] 原话，不构成审查请求。文中提到 STATUS: DONE 不算判定。')
  assert.equal(h.followups.length, 1)
  assert.equal(h.followups[0].source.kind, 'pmo-review')
  assert.match(h.followups[0].content[0].text, /STATUS=NEED_HUMAN/)
  assert.match(h.followups[0].content[0].text, /未按协议输出 STATUS/)
  h.turnStart(3)
  h.commitVerdict(h.followups[0])
  h.assistantMsg('好的')
  h.turnEnd(3)
  await h.wait()

  assert.equal(h.forwards().length, 1, 'no verdict → no further forward')
  assert.match(h.logText(), /自动熄灭/)
})

test('CONTINUE earns one continuation review; DONE holds the gate', async (t) => {
  const h = harness()
  t.after(() => h.cleanup())
  await h.toggle(true)
  await h.wait()

  h.turnStart(1)
  h.userMsg('第一件事')
  h.assistantMsg('做完了')
  h.turnEnd(1)
  await h.wait()
  assert.equal(h.forwards().length, 1)

  h.childTurn('STATUS: CONTINUE\n结论：无问题\n下一步：补测试')
  assert.equal(h.followups.length, 1)
  assert.match(h.followups[0].content[0].text, /STATUS=CONTINUE/)
  assert.match(h.followups[0].content[0].text, /下一步：补测试/)
  h.turnStart(2)
  h.commitVerdict(h.followups[0])
  h.assistantMsg('继续做下一步')
  h.turnEnd(2)
  await h.wait()
  assert.equal(h.forwards().length, 2)
  assert.match(h.forwards()[1].text, /续轮审查请求/)
  assert.match(h.forwards()[1].text, /\[PMO审查\] 【PMO 审查/)
  assert.doesNotMatch(h.forwards()[1].text, /^\[用户\] /m, 'a verdict is never user speech')
  assert.match(h.logText(), /第 2\/20 轮审查/, 'a verdict must not reset the round counter')

  h.childTurn('**STATUS: DONE**\n结论：完成')
  assert.equal(h.followups.length, 2)
  assert.match(h.followups[1].content[0].text, /STATUS=DONE/)
  h.turnStart(3)
  h.commitVerdict(h.followups[1])
  h.assistantMsg('收尾')
  h.turnEnd(3)
  await h.wait()
  assert.equal(h.forwards().length, 2, 'DONE gate must hold')
  assert.match(h.logText(), /自动熄灭/)
})

test('injections never crowd [用户]/[主代理] out of the forward', async (t) => {
  const h = harness()
  t.after(() => h.cleanup())
  await h.toggle(true)
  await h.wait()

  h.turnStart(1)
  h.userMsg('<system-reminder>' + 'x'.repeat(12000) + '</system-reminder>', 'skill-catalog')
  h.userMsg('我要的改动：修 A')
  h.assistantMsg('已修 A')
  h.turnEnd(1)
  await h.wait()

  const forward = h.forwards()[0].text
  assert.match(forward, /\[用户\] 我要的改动：修 A/)
  assert.match(forward, /\[主代理\] 已修 A/)
  assert.ok(forward.length <= 4000 * 2 + 40, `forward length ${forward.length}`)
  assert.ok(!forward.includes('x'.repeat(2000)), 'injection block must be clipped')
})

test('attachments stay in the protected block even when injections are huge', async (t) => {
  const h = harness()
  t.after(() => h.cleanup())
  await h.toggle(true)
  await h.wait()

  h.turnStart(1)
  h.userMsg('<system-reminder>' + 'y'.repeat(12000) + '</system-reminder>', 'system-reminder')
  h.imageMsg('shot.png')
  h.assistantMsg('看到图了')
  h.turnEnd(1)
  await h.wait()

  const forward = h.forwards()[0].text
  assert.match(forward, /\[图片\] shot\.png/)
  assert.match(forward, /\[主代理\] 看到图了/)
})

test('pre-upgrade state with an override resets the child (fingerprint gap)', async (t) => {
  const base = {
    version: 9,
    enabled: [],
    turnCounts: {},
    buffers: {},
    children: { [SID]: 'old-child' },
    roleSent: { [SID]: true },
    doneSet: {},
    stopped: {},
    overrides: { [SID]: { provider: 'p2', model: 'm2' } },
    modelFps: {},
    lastForwardReview: {},
    rounds: {},
  }
  const h = harness(base)
  t.after(() => h.cleanup())
  await h.toggle(true)
  await h.wait()

  assert.equal(h.activated.length, 1, 'a changed/unknown review model must create a fresh child')
  assert.equal(h.sent.filter((s) => s.targetId === 'old-child').length, 0, 'the old child must not be reused')
})

test('pre-upgrade state without an override reuses the child', async (t) => {
  const base = {
    version: 9,
    enabled: [],
    turnCounts: {},
    buffers: {},
    children: { [SID]: 'old-child' },
    roleSent: { [SID]: true },
    doneSet: {},
    stopped: {},
    overrides: {},
    modelFps: {},
    lastForwardReview: {},
    rounds: {},
  }
  const h = harness(base)
  t.after(() => h.cleanup())
  await h.toggle(true)
  await h.wait()

  assert.equal(h.activated.length, 0)
  assert.equal(h.sent.filter((s) => s.targetId === 'old-child').length, 1, 'inherit case keeps the durable child')
})

test('line B: check-in acks and side chats with the child never reach the main session', async (t) => {
  const h = harness()
  t.after(() => h.cleanup())
  await h.toggle(true)
  await h.wait()
  assert.equal(h.activated.length, 1)
  assert.equal(h.activated[0].delivery, 'caller', 'no native settlement notice or send_message guidance on creation')
  assert.match(h.activated[0].request.prompt.at(-1).text, /^\[待命\] /)

  h.childTurn('收到，待命。')
  h.childTurn('STATUS: CONTINUE\n（用户在侧栏直接与审查官对话，不是审查回复）')
  assert.equal(h.followups.length, 0)
})

test('line B: an abnormal reviewer turn becomes NEED_HUMAN', async (t) => {
  const h = harness()
  t.after(() => h.cleanup())
  await h.toggle(true)
  await h.wait()
  h.turnStart(1)
  h.userMsg('做 X')
  h.assistantMsg('做完了')
  h.turnEnd(1)
  await h.wait()

  h.childTurn('', { kind: 'error', error: { message: 'boom', code: 'UNKNOWN' } })
  assert.equal(h.followups.length, 1)
  assert.match(h.followups[0].content[0].text, /STATUS=NEED_HUMAN/)
  assert.match(h.followups[0].content[0].text, /未正常结束（error）/)
})

test('pre-step gate: native child notices never enter the model', async (t) => {
  const h = harness()
  t.after(() => h.cleanup())
  await h.toggle(true)
  await h.wait()
  const user = { id: 'u1', source: { kind: 'user' } }
  const context = { id: 'ctx', source: { kind: 'runtime-context' } }

  // Only native notices: an empty step, without assembling the default batch.
  let nextCalled = false
  const only = await h.preStep([h.native()], undefined).then((d) => d, () => { nextCalled = true })
  assert.deepEqual(only, { kind: 'enter', messages: [] })
  assert.equal(nextCalled, false)
  // The turn that notice opened closes empty: neither logged nor forwarded.
  const before = h.logText()
  h.turnStart(1)
  h.turnEnd(1)
  await h.wait()
  assert.equal(h.logText().split('[轮次结束]').length, before.split('[轮次结束]').length)

  // Mixed batch: the notice is removed, everything else is kept as decided.
  const mixed = await h.preStep([user, h.native('agent-message', 'n2')], { kind: 'enter', messages: [user, h.native('agent-message', 'n2'), context], startsRequestSeries: true })
  assert.deepEqual(mixed.messages, [user, context])
  assert.equal(mixed.startsRequestSeries, true)

  // Untouched batches and other sessions pass straight through.
  const passthrough = { kind: 'enter', messages: [user] }
  assert.equal(await h.preStep([user], passthrough), passthrough)
  assert.equal(await h.preStep([h.native()], passthrough, 'other-session'), passthrough)

  // Button off: the child is still the plugin's — its notices stay out.
  await h.toggle(false)
  assert.deepEqual(await h.preStep([h.native()], passthrough), { kind: 'enter', messages: [] })
})

test('identity prompt: once per session, again only when its text changes', async (t) => {
  const h = harness()
  await h.toggle(true)
  await h.wait()
  assert.equal(h.activated[0].request.prompt.length, 2, 'role + check-in on creation')
  await h.toggle(false)
  await h.toggle(true)
  await h.wait()
  assert.equal(h.sent.length, 1)
  assert.doesNotMatch(h.sent[0].text, /身份规程/, 'unchanged prompt is not resent')

  // A pre-0.12 state stored `true` instead of a fingerprint: resent once, marked as an update.
  const state = JSON.parse(fs.readFileSync(path.join(h.dir, 'pmo-state.json'), 'utf8'))
  state.roleSent = { [SID]: true }
  h.cleanup()
  const h2 = harness(state)
  t.after(() => h2.cleanup())
  await h2.toggle(true)
  await h2.wait()
  assert.equal(h2.activated.length, 0, 'child reused')
  assert.match(h2.sent[0].text, /【身份设定更新，取代此前版本】\n身份规程/)
})

test('only source.kind === "user" is user speech (runtime-context is context)', async (t) => {
  const h = harness()
  t.after(() => h.cleanup())
  await h.toggle(true)
  await h.wait()

  h.turnStart(1)
  h.userMsg('Current runtime context. This snapshot supersedes earlier ones.', 'runtime-context')
  h.assistantMsg('好的')
  h.turnEnd(1)
  await h.wait()

  assert.equal(h.forwards().length, 0, 'a context-only turn earns no ticket')
  assert.match(h.logText(), /\[注入:runtime-context\] Current runtime context/)
  assert.doesNotMatch(h.logText(), /\[PMO\] Current runtime context/)
})

test('session model/effort change resets the reviewer immediately and uses the model catalog', async (t) => {
  const llm = {
    resolveModelInfo: async (provider, model) => {
      if (provider === 'qwen') {
        return {
          provider, id: model, name: model,
          reasoning: {
            defaultEffort: 'medium',
            efforts: [
              { id: 'off', name: 'off' },
              { id: 'low', name: 'low' },
              { id: 'medium', name: 'medium' },
              { id: 'high', name: 'high' },
            ],
          },
        }
      }
      return {
        provider, id: model, name: model,
        reasoning: {
          defaultEffort: 'max',
          efforts: [
            { id: 'minimal', name: 'minimal' },
            { id: 'low', name: 'low' },
            { id: 'medium', name: 'medium' },
            { id: 'high', name: 'high' },
            { id: 'max', name: 'max' },
          ],
        },
      }
    },
  }
  const h = harness(null, { llm })
  t.after(() => h.cleanup())
  await h.toggle(true)
  await h.wait()
  assert.equal(h.activated.length, 1, 'starting the loop creates the inherited reviewer')

  const set = async (qs) => {
    const res = await h.route(new Request('http://x/pmo-button/session-config/set?' + qs))
    return res.json()
  }
  const changed = await set(`session=${SID}&provider=qwen&model=Qwen3.8-Flash-Next-Uncensored-1M&effort=high&maxRounds=`)
  assert.equal(changed.ok, true)
  assert.equal(changed.reset, true, 'the stale child must be reset immediately, not on the next toggle')
  assert.equal(changed.effective.provider, 'qwen')
  assert.equal(changed.effective.effort, 'high')
  assert.deepEqual(changed.reasoning.efforts.map((e) => e.id), ['off', 'low', 'medium', 'high'])
  assert.ok(!changed.reasoning.efforts.some((e) => e.id === 'max'), 'qwen must not advertise max')
  assert.match(h.logText(), /已重置审查官/)
  assert.equal(h.activated.length, 2, 'the reset recreates the reviewer with the new model immediately')
  assert.deepEqual(h.activated[1].request.agentOptions, {
    provider: 'qwen',
    model: 'Qwen3.8-Flash-Next-Uncensored-1M',
    reasoningEffort: 'high',
  })

  // The recreated child is reused; the review is not skipped for "no child".
  h.turnStart(1)
  h.userMsg('继续')
  h.assistantMsg('继续做')
  h.turnEnd(1)
  await h.wait()
  assert.equal(h.forwards().length, 1, 'the next review is delivered to the recreated child')
  assert.equal(h.activated.length, 2, 'the recreated child is reused')

  // An effort the model does not advertise is not persisted.
  const bad = await set(`session=${SID}&provider=qwen&model=Qwen3.8-Flash-Next-Uncensored-1M&effort=max&maxRounds=`)
  assert.equal(bad.effortAdjusted, true)
  assert.equal(bad.override.effort, undefined)
  assert.equal(bad.effective.effort, '')

  // The menu's initial read carries the same model catalog.
  const got = await (await h.route(new Request(`http://x/pmo-button/session-config?session=${SID}`))).json()
  assert.equal(got.override.provider, 'qwen')
  assert.deepEqual(got.reasoning.efforts.map((e) => e.id), ['off', 'low', 'medium', 'high'])
})
