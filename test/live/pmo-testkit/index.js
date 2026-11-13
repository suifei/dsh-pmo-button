// Test-only driver plugin for `npm run test:live`. Never published (not in
// package.json `files`). It stands in for the web server (the headless profile
// mounts none), creates a root session, presses the PMO button, plays the
// user, and records every turn boundary to PMO_TRACE.
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

export const name = 'pmo-testkit'
export const inject = ['agents', 'agentDefaultModel', 'sessions', 'subagents']

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function apply(ctx) {
  const traceFile = process.env.PMO_TRACE
  let handle
  let lastEvent = Date.now()
  let mainId
  const trace = (row) => { if (traceFile) fs.appendFileSync(traceFile, JSON.stringify(row) + '\n') }

  ctx.provide('webServer', { register: (r) => { handle = r.resource; return () => {} } })

  ctx.on('session/event', (session, event) => {
    lastEvent = Date.now()
    const who = String(session.id) === mainId ? 'main' : 'child'
    if (event.type === 'user/message') {
      const m = event.data?.message ?? event.data
      trace({ who, type: event.type, kind: m?.source?.kind, text: String(m?.content?.[0]?.text ?? '').slice(0, 60) })
    } else if (event.type === 'turn/start' || event.type === 'step/start' || event.type === 'turn/end') {
      trace({ who, type: event.type, turn: event.data?.turn, step: event.data?.step, reason: event.data?.reason?.kind })
    }
  })

  const quiet = async (ms) => { await sleep(1500); while (Date.now() - lastEvent < ms) await sleep(250) }
  const toggle = async (on) => {
    const res = await handle(new Request(`http://local/pmo-button/toggle?session=${encodeURIComponent(mainId)}&enabled=${on ? 1 : 0}`))
    trace({ who: 'driver', type: 'toggle', on, body: await res.json() })
  }
  const say = (text) => {
    trace({ who: 'driver', type: 'say', text })
    ctx.agents.get(mainId).followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
  }

  ;(async () => {
    while (handle === undefined) await sleep(50)
    const { agent } = await ctx.agents.create({
      sessionId: `session-${randomUUID()}`,
      meta: { cwd: process.cwd() },
      agentOptions: { ...ctx.agentDefaultModel.currentSelection() },
    })
    mainId = String(agent.id)
    await agent.whenIdle()
    trace({ who: 'driver', type: 'phase', name: 'start' })
    await toggle(true)
    await quiet(4000)
    trace({ who: 'driver', type: 'phase', name: 'task-1' })
    say('做 X')
    await quiet(8000)
    trace({ who: 'driver', type: 'phase', name: 'task-2-after-done' })
    say('再做 Y')
    await quiet(8000)
    trace({ who: 'driver', type: 'phase', name: 'restart-while-idle' })
    await toggle(false)
    await toggle(true)
    await quiet(8000)
    trace({ who: 'driver', type: 'phase', name: 'end' })
    await ctx.sessions.flush(agent.session)
    process.exit(0)
  })().catch((err) => {
    trace({ who: 'driver', type: 'error', error: String(err?.stack ?? err) })
    process.exit(2)
  })
}
