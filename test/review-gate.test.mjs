/**
 * Regression tests for the PMO review-forward gate (v0.11.2).
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

function harness(state) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmo-gate-'))
  const logFile = path.join(dir, 'pmo.log')
  if (state) fs.writeFileSync(path.join(dir, 'pmo-state.json'), JSON.stringify(state), 'utf8')

  const listeners = []
  const sent = []
  const activated = []
  const injected = []
  let route
  const agent = { id: SID, inject: (m) => injected.push(m) }
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
    on: (name, fn) => { listeners.push(fn); return () => {} },
    get: (name) => ({
      webServer: { register: (r) => { route = r.resource; return () => {} } },
      agents: { get: (id) => (String(id) === SID ? agent : undefined) },
      subagents,
      llm: undefined,
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

  const emit = (event) => listeners.forEach((fn) => fn({ id: SID }, event))
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
  return { dir, sent, activated, injected, toggle, forwards, logText, wait, cleanup, turnStart, turnEnd, userMsg, assistantMsg, settlement, imageMsg }
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

  // The child answers without a STATUS line (the f5bb "不构成审查请求" shape).
  h.settlement('收到转发块：本轮无 [用户] 原话，不构成审查请求。')
  h.turnStart(3)
  h.assistantMsg('好的')
  h.turnEnd(3)
  await h.wait()

  assert.equal(h.forwards().length, 1, 'no verdict → no further forward')
  assert.match(h.logText(), /不授予新转发票/)
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

  h.settlement('STATUS: CONTINUE\n结论：无问题')
  await h.wait()
  h.turnStart(2)
  h.assistantMsg('继续做下一步')
  h.turnEnd(2)
  await h.wait()
  assert.equal(h.forwards().length, 2)
  assert.match(h.forwards()[1].text, /续轮审查请求/)

  h.settlement('STATUS: DONE\n结论：完成')
  await h.wait()
  h.turnStart(3)
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
