// Scripted mock model speaking the Messages API that dsh's `deepseek-official`
// provider calls (`<baseURL>/v1/messages`, SSE). No real model is contacted.
//  - main agent: answers "主代理答复 #n：已处理。"
//  - PMO reviewer: check-in -> one-line ack; 1st review -> CONTINUE; later -> DONE
import fs from 'node:fs'
import http from 'node:http'

const textOf = (c) => typeof c === 'string'
  ? c
  : Array.isArray(c) ? c.map((b) => (b?.type === 'text' ? b.text : '')).join('\n') : ''

/**
 * @param {string} requestLog JSONL file receiving one line per model request
 * @returns {Promise<{ port: number, close: () => Promise<void> }>}
 */
export function startMock(requestLog) {
  let mainReplies = 0
  function decide(body) {
    const users = (body.messages ?? []).filter((m) => m.role === 'user').map((m) => textOf(m.content))
    const last = users.at(-1) ?? ''
    if (users.join('\n').includes('你是本会话的常驻 PMO')) {
      if (!last.includes('【PMO 轮次转发')) return { role: 'child', text: '收到，待命。' }
      const reviews = users.filter((u) => u.includes('【PMO 轮次转发')).length
      return {
        role: 'child',
        text: reviews === 1
          ? 'STATUS: CONTINUE\n结论：缺少测试\n问题：1. 未见测试文件\n下一步：补一条测试并回报'
          : 'STATUS: DONE\n结论：目标达成，无遗留问题',
      }
    }
    // Tool-less requests are auxiliary (session title etc.).
    if ((body.tools ?? []).length === 0) return { role: 'aux', text: '测试会话' }
    mainReplies += 1
    return { role: 'main', text: `主代理答复 #${mainReplies}：已处理。` }
  }
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (d) => { raw += d })
    req.on('end', () => {
      if (req.method !== 'POST' || !req.url.includes('/messages')) {
        res.writeHead(404, { 'content-type': 'application/json' })
        res.end('{"type":"error","error":{"type":"not_found_error","message":"mock"}}')
        return
      }
      let body = {}
      try { body = JSON.parse(raw) } catch { /* answered as main */ }
      const out = decide(body)
      const users = (body.messages ?? []).filter((m) => m.role === 'user').map((m) => textOf(m.content))
      fs.appendFileSync(requestLog, JSON.stringify({ role: out.role, reply: out.text, users }) + '\n')
      const message = { id: 'msg_mock', type: 'message', role: 'assistant', model: body.model, stop_sequence: null }
      if (body.stream === false) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ...message, content: [{ type: 'text', text: out.text }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } }))
        return
      }
      const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      send('message_start', { type: 'message_start', message: { ...message, content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 1 } } })
      send('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
      send('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: out.text } })
      send('content_block_stop', { type: 'content_block_stop', index: 0 })
      send('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } })
      send('message_stop', { type: 'message_stop' })
      res.end()
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({
      port: server.address().port,
      close: () => new Promise((done) => server.close(() => done())),
    }))
  })
}
