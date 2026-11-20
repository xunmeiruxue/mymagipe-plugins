
// magpie-mcp-bridge — a remote MCP server's tools as magpie plugin tools.
//
// magpie gives a plugin's tools their own Library server (the gateway's
// /mcp/magpie/tools/<plugin>), so this one entry takes the place of an MCP
// server entry: same tools, same agents, but the sign-in lives here and is
// renewed here, which a Library SSE entry can't do.
//
// What it is given (plugins.json's options, written by its page; config.json
// beside it when the page has never been used):
//   url         the server's address, default https://mcp-pan.baidu.com/sse
//   transport   "sse" (Baidu's), "http", or "auto"
//   headers     headers every request carries, e.g. {"client_name": "Claude"}
//   appKey      Baidu's AppKey (OAuth client_id)
//   secretKey   Baidu's SecretKey (OAuth client_secret)
//   code        the authorization code, once: 10 minutes, one use
//   refreshToken / accessToken  a sign-in pasted in by hand
//   tokenFile   where the token is kept; default: this folder's token.json

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const NAME = /^[A-Za-z0-9_-]{1,48}$/
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export default async function Bridge(_input, options) {
  // options from plugins.json, else config.json beside this file: one folder
  // to add, and deleting it takes its sign-in with it
  // the page saves what it needs into plugins.json's options; config.json
  // beside this file is the fallback for a plugin added without a page
  let cfg = {}
  try { cfg = JSON.parse(fs.readFileSync(path.join(HERE, "config.json"), "utf8")) } catch {}
  const o = options && typeof options === "object" ? options : {}
  // the page writes them flat (appKey, secretKey, code); a hand-written
  // entry may nest them under oauth, and both are read here
  const nested = o.oauth && typeof o.oauth === "object" ? o.oauth : {}
  const fromOptions = !!(o.url || o.appKey || o.code || o.clientId || o.refreshToken || nested.appKey || nested.code)
  if (fromOptions) {
    cfg = { ...cfg, ...o, oauth: { ...(cfg.oauth || {}), ...nested, ...o } }
    delete cfg.oauth.oauth
  }
  // what the page needs to say nothing about: Baidu's own two addresses
  cfg.url ||= "https://mcp-pan.baidu.com/sse"
  cfg.transport ||= "sse"
  cfg.oauth = { ...(cfg.oauth || {}) }
  cfg.oauth.tokenUrl ||= "https://openapi.baidu.com/oauth/2.0/token"
  const st = state(cfg, fromOptions)
  let tools = []
  try {
    // not forced: a token still good is reused, so a host restart costs no
    // refresh (Baidu's is one use and every restart would spend one)
    await ensureToken(st, false)
    tools = await listTools(st)
  } catch (e) {
    log("couldn't read its tools: " + why(e))
  }
  const tool = {}
  for (const t of tools) {
    if (!t || !NAME.test(t.name)) continue
    tool[t.name] = {
      description: String(t.description || t.title || t.name).slice(0, 2000),
      args: t.inputSchema && typeof t.inputSchema === "object" ? t.inputSchema : { type: "object", properties: {} },
      execute: async (args) => {
        await ensureToken(st, false)
        try {
          return await callTool(st, t.name, args || {})
        } catch (e) {
          // a token the server stopped taking: renew once and try again
          if (!/401|403|auth/i.test(why(e))) throw e
          await ensureToken(st, true)
          return await callTool(st, t.name, args || {})
        }
      },
    }
  }
  return { tool }
}

// ---- the token -------------------------------------------------------------

function state(cfg, fromOptions) {
  return {
    cfg,
    cfgFile: path.join(HERE, "config.json"),
    fromOptions: !!fromOptions,
    file: cfg.tokenFile || path.join(HERE, "token.json"),
    token: readToken(cfg),
    conn: null,
    // one refresh at a time: Baidu's refresh_token is good for one use, so
    // two in flight would spend it twice and leave the loser holding a dead one
    inflight: null,
  }
}

function readToken(cfg) {
  const o = cfg.oauth && typeof cfg.oauth === "object" ? cfg.oauth : {}
  const t = { access: o.accessToken || "", refresh: o.refreshToken || "", exp: 0, code: "" }
  try {
    const saved = JSON.parse(fs.readFileSync(cfg.tokenFile || path.join(HERE, "token.json"), "utf8"))
    if (saved.access) t.access = saved.access
    if (saved.refresh) t.refresh = saved.refresh
    if (saved.exp) t.exp = Number(saved.exp) || 0
    // the code that traded for this token: an options field keeps saying it
    // after the host restarted, and a code is good for one use only
    if (saved.code) t.code = String(saved.code)
  } catch {}
  return t
}

function saveToken(st) {
  // through a temporary file: a token half written is a sign-in lost for good
  try {
    const tmp = st.file + ".tmp"
    fs.writeFileSync(tmp, JSON.stringify({ access: st.token.access, refresh: st.token.refresh, exp: st.token.exp, code: st.token.code }, null, 2), { mode: 0o600 })
    fs.renameSync(tmp, st.file)
  } catch (e) {
    log("couldn't save the token: " + why(e))
  }
}

// ensureToken renews the token when it is about to run out. force renews now.
async function ensureToken(st, force) {
  if (st.inflight) return st.inflight
  st.inflight = renew(st, force).finally(() => { st.inflight = null })
  return st.inflight
}

// renew signs in again when there is no token yet (a code, once), else
// renews the one it has. Baidu's refresh_token is good for one use, so what
// comes back replaces it here, at once.
async function renew(st, force) {
  const t = st.token
  const o = st.cfg.oauth || {}
  const lead = 10 * 60 * 1000
  if (!force && t.access && (!t.exp || t.exp - lead > Date.now())) return t.access

  const tokenUrl = o.tokenUrl || ""
  const id = o.appKey || o.clientId || ""
  const secret = o.secretKey || o.clientSecret || ""
  // a code in the config is a sign-in asked for now: it wins over a token
  // left over from before, which the re-authorization may have revoked —
  // unless it is the one already traded, which the options still carry
  if (o.code && o.code !== t.code) {
    if (!tokenUrl) throw new Error("oauth.code is given but no oauth.tokenUrl to trade it at")
    const got = await exchange(st, tokenUrl, {
      grant_type: "authorization_code",
      code: o.code,
      client_id: id,
      client_secret: secret,
      redirect_uri: o.redirectUri || "oob",
    })
    st.token.code = o.code
    saveToken(st)
    clearCode(st)
    return got
  }
  if (t.refresh || o.refreshToken) {
    if (!tokenUrl) {
      if (t.access) return t.access
      throw new Error("no token and no oauth.tokenUrl to get one from")
    }
    return exchange(st, tokenUrl, {
      grant_type: "refresh_token",
      refresh_token: t.refresh || o.refreshToken,
      client_id: id,
      client_secret: secret,
      scope: o.scope,
    })
  }
  throw new Error("还没有登录：config.json 的 oauth 里填一个 code（一次，10 分钟内有效）或一个 refreshToken")
}

// exchange posts one grant to the token endpoint and keeps what comes back.
async function exchange(st, tokenUrl, fields) {
  const form = new URLSearchParams()
  for (const [k, v] of Object.entries(fields)) if (v) form.set(k, v)
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: form.toString(),
  })
  const text = await res.text()
  let j = {}
  try { j = JSON.parse(text) } catch {}
  if (!res.ok || !j.access_token) {
    const said = j.error_description || j.error || text.slice(0, 300)
    if (fields.grant_type === "authorization_code") {
      throw new Error("code 换不到 token（" + res.status + "）：" + said + "。code 只能用一次、10 分钟内有效，重新扫码拿一个")
    }
    // a refresh token Baidu no longer takes is gone for good: keeping it
    // would only fail again on every load, so it is forgotten here and every
    // later answer says what to do instead
    if (/invalid_grant|invalid_client|revoked/i.test(said + " " + (j.error || ""))) {
      st.token.refresh = ""
      st.token.access = ""
      st.token.exp = 0
      saveToken(st)
      throw new Error("授权已失效（" + res.status + " " + (j.error || "") + "）。百度的一次性 refresh_token 失败即作废：到插件的页面重新授权一次")
    }
    throw new Error("续期失败（" + res.status + "）：" + said)
  }
  const t = st.token
  t.access = j.access_token
  if (j.refresh_token) t.refresh = j.refresh_token
  t.exp = j.expires_in ? Date.now() + Number(j.expires_in) * 1000 : 0
  saveToken(st)
  log("signed in, good for " + (j.expires_in ? Math.round(j.expires_in / 3600) + "h" : "as long as it lasts"))
  return t.access
}

// clearCode takes the spent code out of config.json: one use, and leaving it
// would only invite a second try.
function clearCode(st) {
  if (st.fromOptions) return
  try {
    const raw = fs.readFileSync(st.cfgFile, "utf8")
    const cfg = JSON.parse(raw)
    if (!cfg.oauth || !cfg.oauth.code) return
    delete cfg.oauth.code
    const tmp = st.cfgFile + ".tmp"
    fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + "\n")
    fs.renameSync(tmp, st.cfgFile)
    log("the code is spent and out of config.json")
  } catch (e) {
    log("couldn't take the code out of config.json: " + why(e))
  }
}

function headersOf(st) {
  const h = { ...(st.cfg.headers || {}) }
  if (st.token.access) h.Authorization = "Bearer " + st.token.access
  return h
}

// ---- the connection --------------------------------------------------------

// idleAfter is how long a session nobody used is kept: the point of this
// plugin is to sit quiet when no agent is asking for anything.
const idleAfter = 120000

function keepAlive(st) {
  clearTimeout(st.idle)
  st.idle = setTimeout(() => {
    try { st.conn?.close?.() } catch {}
    st.conn = null
    log("session closed: nothing asked for it in " + Math.round(idleAfter / 1000) + "s")
  }, idleAfter)
  st.idle.unref?.()
}

async function connect(st) {
  keepAlive(st)
  if (st.conn) return st.conn
  const order = st.cfg.transport === "sse" ? ["sse"] : st.cfg.transport === "http" ? ["http"] : ["http", "sse"]
  let last
  for (const how of order) {
    try {
      st.conn = how === "sse" ? await openSse(st) : await openHttp(st)
      await rpc(st.conn, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "magpie-mcp-bridge", version: "0.1.0" } })
      st.conn.how = how
      return st.conn
    } catch (e) {
      last = e
      st.conn = null
    }
  }
  throw last || new Error("it answered no MCP handshake")
}

async function reopen(st) {
  try { st.conn?.close?.() } catch {}
  st.conn = null
  return connect(st)
}

async function listTools(st) {
  const conn = await connect(st)
  keepAlive(st)
  const out = []
  let cursor
  for (let i = 0; i < 20; i++) {
    const r = await rpc(conn, "tools/list", cursor ? { cursor } : {})
    for (const t of r.tools || []) out.push(t)
    cursor = r.nextCursor
    if (!cursor) break
  }
  return out
}

async function callTool(st, name, args) {
  const conn = await connect(st)
  keepAlive(st)
  const r = await rpc(conn, "tools/call", { name, arguments: args })
  if (r.isError) throw new Error(typeof r.content?.[0]?.text === "string" ? r.content[0].text : "the tool failed")
  const text = (r.content || []).filter((c) => c && c.type === "text").map((c) => c.text).join("\n")
  return text || JSON.stringify(r.structuredContent ?? r)
}

async function rpc(conn, method, params) {
  const msg = { jsonrpc: "2.0", id: ++conn.id, method, params }
  const got = await conn.post(msg)
  if (got.error) throw new Error(got.error.message || JSON.stringify(got.error))
  return got.result ?? {}
}

// openSse speaks the 2024-11 HTTP+SSE transport: a GET whose first event
// names where to POST, and answers that come back on that stream.
async function openSse(st) {
  const ctl = new AbortController()
  const url = st.cfg.url
  const res = await fetch(url, { headers: { ...headersOf(st), Accept: "text/event-stream" }, signal: ctl.signal })
  if (!res.ok) throw new Error("GET " + url + " → " + res.status + " " + (await res.text().catch(() => "")).slice(0, 200))
  const conn = { id: 0, endpoint: null, waiters: new Map(), close: () => ctl.abort() }
  pump(res.body, (ev, data) => {
    if (ev === "endpoint") conn.endpoint = new URL(data.trim(), url).toString()
    else if (ev === "message" && data) {
      let m
      try { m = JSON.parse(data) } catch { return }
      const w = conn.waiters.get(m.id)
      if (w) { conn.waiters.delete(m.id); w(m) }
    }
  })
  for (let i = 0; i < 400 && !conn.endpoint; i++) await sleep(50)   // 20s
  if (!conn.endpoint) { ctl.abort(); throw new Error("it named no endpoint") }
  conn.post = async (msg) => {
    const p = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { conn.waiters.delete(msg.id); reject(new Error("no answer in 60s")) }, 60000)
      conn.waiters.set(msg.id, (m) => { clearTimeout(timer); resolve(m) })
    })
    const r = await fetch(conn.endpoint, { method: "POST", headers: { ...headersOf(st), "Content-Type": "application/json" }, body: JSON.stringify(msg) })
    if (!r.ok) throw new Error(r.status + " " + (await r.text().catch(() => "")).slice(0, 200))
    // some servers answer in the POST's own body instead of the stream
    const body = await r.text().catch(() => "")
    if (body.trim().startsWith("{")) {
      try {
        const m = JSON.parse(body)
        if (m.id === msg.id) { conn.waiters.delete(msg.id); return m }
      } catch {}
    }
    return p
  }
  return conn
}

// openHttp speaks the streamable HTTP transport: a POST whose answer is
// JSON or an event stream.
async function openHttp(st) {
  const url = st.cfg.url
  const conn = { id: 0, close() {} }
  conn.post = async (msg) => {
    const r = await fetch(url, {
      method: "POST",
      headers: { ...headersOf(st), "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-06-18" },
      body: JSON.stringify(msg),
    })
    if (!r.ok) {
      const b = await r.text().catch(() => "")
      throw new Error(r.status + " " + b.slice(0, 200))
    }
    const ct = r.headers.get("content-type") || ""
    if (ct.includes("text/event-stream")) {
      let answer = null
      pump(r.body, (ev, data) => {
        if (ev !== "message" || !data || answer) return
        try { const m = JSON.parse(data); if (m.id === msg.id) answer = m } catch {}
      })
      for (let i = 0; i < 600 && !answer; i++) await sleep(50)
      if (!answer) throw new Error("no answer in 30s")
      return answer
    }
    const m = JSON.parse(await r.text())
    if (Array.isArray(m)) return m.find((x) => x.id === msg.id) || m[0]
    return m
  }
  return conn
}

// pump reads an event stream and hands each event to on.
async function pump(body, on) {
  const reader = body.getReader()
  const dec = new TextDecoder()
  let buf = ""
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true }).replace(/\r\n/g, "\n")
      let at
      while ((at = buf.indexOf("\n\n")) >= 0) {
        const raw = buf.slice(0, at)
        buf = buf.slice(at + 2)
        let ev = "message", data = ""
        for (const line of raw.split("\n")) {
          if (line.startsWith("event:")) ev = line.slice(6).trim()
          else if (line.startsWith("data:")) data += (data ? "\n" : "") + line.slice(5).replace(/^ /, "")
        }
        if (data) on(ev, data)
      }
    }
  } catch {}
}

function why(e) {
  return (e && (e.message || String(e))) || "unknown"
}

function log(s) {
  try { console.error("[mcp-bridge] " + s) } catch {}
}

export const _internal = { openSse, openHttp, listTools, callTool, connect, ensureToken, state, exchange, renew }
