// node test/e2e.mjs — a stand-in for Baidu's MCP and its OAuth, then this
// plugin against it: code traded once, refresh tokens one use each, tools
// listed, a tool called, a spent refresh refused.
import http from "node:http"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import Bridge, { _internal as B } from "../index.mjs"

let hits = 0
const chain = new Map([["r1", "r2"], ["r2", "r3"], ["r3", "r4"]])
let codeLeft = 1

const token = http.createServer((req, res) => {
  let body = ""
  req.on("data", (c) => (body += c))
  req.on("end", () => {
    const f = new URLSearchParams(body); hits++
    const say = (code, j) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(j)) }
    if (f.get("grant_type") === "authorization_code") {
      if (f.get("code") !== "TESTCODE" || codeLeft <= 0) return say(400, { error: "invalid_grant", error_description: "provided code is invalid" })
      codeLeft--
      return say(200, { access_token: "a1", refresh_token: "r1", expires_in: 3600 })
    }
    const cur = f.get("refresh_token")
    const next = chain.get(cur)
    if (!next) return say(400, { error: "invalid_grant", error_description: "refresh token has been used" })
    chain.delete(cur)
    say(200, { access_token: "a" + next.slice(1), refresh_token: next, expires_in: 3600 })
  })
})
await new Promise((r) => token.listen(0, "127.0.0.1", r))
const tokenUrl = "http://127.0.0.1:" + token.address().port + "/token"

let stream = null
let current = ""
const sse = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x")
  if (req.method === "GET" && u.pathname === "/sse") {
    current = (req.headers.authorization || "").replace(/^Bearer /, "")
    if (!/^a\d+$/.test(current)) { res.writeHead(401); return res.end("{}") }
    res.writeHead(200, { "Content-Type": "text/event-stream" })
    res.write("event: endpoint\ndata: /message?sessionId=t\n\n")
    stream = res
    return
  }
  if (req.method === "POST" && u.pathname === "/message") {
    let body = ""
    req.on("data", (c) => (body += c))
    req.on("end", () => {
      const m = JSON.parse(body)
      const reply = (result) => stream.write("event: message\ndata: " + JSON.stringify({ jsonrpc: "2.0", id: m.id, result }) + "\n\n")
      if (m.method === "initialize") reply({ protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "fake", version: "1" } })
      else if (m.method === "tools/list") reply({ tools: [
        { name: "get_quota", description: "容量", inputSchema: { type: "object", properties: {} } },
        { name: "list_files", description: "列文件", inputSchema: { type: "object", properties: { dir: { type: "string" } }, required: ["dir"] } },
      ] })
      else if (m.method === "tools/call") reply({ content: [{ type: "text", text: m.params.name + " " + JSON.stringify(m.params.arguments || {}) }] })
      res.writeHead(202); res.end("")
    })
    return
  }
  res.writeHead(404); res.end()
})
await new Promise((r) => sse.listen(0, "127.0.0.1", r))
const url = "http://127.0.0.1:" + sse.address().port + "/sse"

const tokenFile = path.join(os.tmpdir(), "baidu-pan-test-token.json")
fs.rmSync(tokenFile, { force: true })

const hooks = await Bridge({}, {
  url, transport: "sse", tokenFile,
  oauth: { tokenUrl, appKey: "k", secretKey: "s", redirectUri: "oob", code: "TESTCODE" },
})
console.log("1) code traded, tools:", Object.keys(hooks.tool))
console.log("2) call:", await hooks.tool.list_files.execute({ dir: "/我的资源" }))
console.log("3) schema passed through:", JSON.stringify(hooks.tool.list_files.args))

const saved = () => JSON.parse(fs.readFileSync(tokenFile, "utf8"))
await hooks.tool.get_quota.execute({})
const st = B.state({ url, tokenFile, oauth: { tokenUrl, appKey: "k", secretKey: "s" } })
st.token.exp = Date.now() - 1000
const before = hits
await Promise.all(Array.from({ length: 8 }, () => B.ensureToken(st, false)))
console.log("4) 8 calls at once on an expired token → token endpoint hits:", hits - before, "| refresh now:", saved().refresh)

sse.close(); token.close()
process.exit(0)
