// Live regression: runs the plugin inside a real dsh runtime (headless
// profile) against a scripted mock model, then checks the dual-line relay.
//
// Usage: npm run test:live
//   DSH_BIN  the dsh command (default "dsh"), e.g. DSH_BIN="npx dsh"
//
// Nothing of yours is touched: the run uses its own DSH_HOME under the system
// temp directory and never contacts a real model. Results land in test/out/.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startMock } from './mock-llm.mjs'

const posix = (p) => p.split(path.sep).join('/')
const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '..', '..')
const out = path.join(repo, 'test', 'out')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pmo-live-'))
const home = path.join(tmp, 'dsh-home')
const work = path.join(tmp, 'work')
const DSH = process.env.DSH_BIN || 'dsh'

fs.rmSync(out, { recursive: true, force: true })
for (const d of [out, home, work]) fs.mkdirSync(d, { recursive: true })

const files = {
  log: path.join(out, 'pmo-button.log'),
  trace: path.join(out, 'trace.jsonl'),
  requests: path.join(out, 'requests.jsonl'),
  stderr: path.join(out, 'dsh-stderr.txt'),
  report: path.join(out, 'report.txt'),
}

function run(command, { env, timeoutMs = 300000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, { cwd: work, env, shell: true })
    let stdout = '', stderr = ''
    child.stdout.on('data', (d) => { stdout += d })
    child.stderr.on('data', (d) => { stderr += d })
    const timer = setTimeout(() => child.kill(), timeoutMs)
    child.on('error', (err) => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: stderr + String(err) }) })
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }) })
  })
}
function fail(step, r) {
  fs.writeFileSync(files.report, `SETUP FAILED at: ${step}\nexit=${r.code}\n--- stdout\n${r.stdout}\n--- stderr\n${r.stderr}\n`, 'utf8')
  console.error(fs.readFileSync(files.report, 'utf8'))
  process.exit(2)
}

const mock = await startMock(files.requests)
const baseURL = `http://127.0.0.1:${mock.port}`
const env = {
  ...process.env,
  DSH_HOME: home,
  DEEPSEEK_API_KEY: 'sk-mock-0000000000000000',
  DEEPSEEK_BASE_URL: baseURL,
  NO_PROXY: '127.0.0.1,localhost',
  no_proxy: '127.0.0.1,localhost',
  PMO_TRACE: files.trace,
}

const version = await run(`${DSH} --version`, { env })
if (version.code !== 0) fail(`"${DSH} --version" (is dsh on PATH? set DSH_BIN)`, version)
// First boot materializes the profile directory.
const boot = await run(`${DSH} headless --dump-config`, { env })
if (boot.code !== 0) fail('create headless profile', boot)
const add = await run(`${DSH} plugin --profile headless add "${posix(repo)}" "${posix(path.join(here, 'pmo-testkit'))}"`, { env })
if (add.code !== 0) fail('install plugin + testkit into the profile', add)
fs.writeFileSync(path.join(home, 'profiles', 'headless', 'cordis.patch.yml'), [
  '- id: llm-deepseek',
  '  config:',
  `    baseURL: ${JSON.stringify(baseURL)}`,
  '- id: pmo-button',
  '  config:',
  `    logFile: ${JSON.stringify(posix(files.log))}`,
  '# the testkit drives the session instead of the one-shot runner',
  '- id: headless-runner',
  '  disabled: true',
  '',
].join('\n'), 'utf8')

const live = await run(`${DSH} headless placeholder`, { env, timeoutMs: 240000 })
await mock.close()
fs.writeFileSync(files.stderr, live.stderr, 'utf8')

// ---- checks ---------------------------------------------------------------
const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '')
const rows = (f) => read(f).split('\n').filter(Boolean).map((l) => JSON.parse(l))
const log = read(files.log)
const trace = rows(files.trace)
const requests = rows(files.requests)
const count = (needle) => log.split(needle).length - 1

const phases = {}
let phase = 'boot'
for (const r of trace) {
  if (r.type === 'phase') { phase = r.name; continue }
  (phases[phase] ??= []).push(r)
}
const mainSteps = (rs = []) => rs.filter((r) => r.who === 'main' && r.type === 'step/start').length
const mainTurns = (rs = []) => rs.filter((r) => r.who === 'main' && r.type === 'turn/start').length
const mainKinds = [...new Set(trace.filter((r) => r.who === 'main' && r.type === 'user/message').map((r) => r.kind))].sort()
const nativeSeen = requests.filter((q) => q.users.some((u) => u.includes('Background subagent') || (q.role === 'main' && u.includes('sent a message: ')))).length
const mainRequests = requests.filter((q) => q.role === 'main').length
const childVerdicts = requests.filter((q) => q.role === 'child' && q.reply.startsWith('STATUS')).map((q) => q.reply.split('\n')[0])

const checks = [
  ['driver finished', live.code === 0 && phase === 'end', `exit=${live.code} lastPhase=${phase}`],
  ['child created once, identity prompt sent once', count('已创建持久子代理') === 1 && count('[身份提示词]') === 1, `created=${count('已创建持久子代理')} role=${count('[身份提示词]')}`],
  ['check-in ack does not wake the main session', mainTurns(phases['start']) === 0, `mainTurns=${mainTurns(phases['start'])}`],
  ['line B delivers CONTINUE', count('[线路B] STATUS=CONTINUE') === 1, `n=${count('[线路B] STATUS=CONTINUE')}`],
  ['line B delivers DONE; wrap-up turn is not forwarded', count('[线路B] STATUS=DONE') === 2 && count('跳过：DONE 后静默') === 2, `done=${count('[线路B] STATUS=DONE')} skipped=${count('跳过：DONE 后静默')}`],
  ['user speech re-opens the loop after DONE', count('DONE 闸门解除') === 1, `n=${count('DONE 闸门解除')}`],
  ['reviewer verdict sequence', childVerdicts.join(',') === 'STATUS: CONTINUE,STATUS: DONE,STATUS: DONE', childVerdicts.join(',')],
  ['gate intercepts dsh native notices', count('[闸门] 已拦截') >= 4, `n=${count('[闸门] 已拦截')}`],
  ['no native notice reaches any model request', nativeSeen === 0, `requestsWithNative=${nativeSeen}`],
  ['main session sees only user / runtime-context / pmo-review', mainKinds.every((k) => ['user', 'runtime-context', 'time-context', 'pmo-review'].includes(k)), mainKinds.join(',')],
  ['main model requests = 5 (no extra step from intercepted notices)', mainRequests === 5 && mainSteps(trace) === 5, `requests=${mainRequests} steps=${mainSteps(trace)}`],
  ['idle parent: intercepted notice closes an empty turn without a step', mainTurns(phases['restart-while-idle']) === 1 && mainSteps(phases['restart-while-idle']) === 0, `turns=${mainTurns(phases['restart-while-idle'])} steps=${mainSteps(phases['restart-while-idle'])}`],
]

const pkg = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'))
const failed = checks.filter((c) => !c[1]).length
const report = [
  `dsh-pmo-button live test — ${failed === 0 ? 'PASS' : `FAIL (${failed})`}`,
  `plugin=${pkg.version} dsh=${version.stdout.trim()} node=${process.version} platform=${process.platform}-${process.arch}`,
  '',
  ...checks.map(([name, ok, detail]) => `${ok ? 'PASS' : 'FAIL'}  ${name}  [${detail}]`),
  '',
].join('\n')
fs.writeFileSync(files.report, report, 'utf8')
console.log(report)
console.log(`artifacts: ${posix(out)}`)
fs.rmSync(tmp, { recursive: true, force: true })
process.exit(failed === 0 ? 0 : 1)
