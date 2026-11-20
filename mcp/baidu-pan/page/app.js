// 百度网盘插件的页面。
//
// 页面能知道的只有两件事：它自己写进 plugins.json 的值，和现在的时间。
// magpie 不提供「这个插件现在有几个工具」这类读取（只给 usage:summary 与
// providers:list），页面也不能联网，所以这里不猜任何状态：提交过的内容 +
// 多久之前，结果一律写清去哪看。
(async () => {
  await magpie.ready
  const $ = (id) => document.getElementById(id)
  const badge = $("bridge")
  badge.textContent = "已连接 magpie"
  badge.className = "badge ok"

  let opts = (await magpie.options.get()) || {}

  const ago = (t) => {
    if (!t) return ""
    const s = Math.max(0, Math.round((Date.now() - t) / 1000))
    if (s < 60) return s + " 秒前"
    const m = Math.floor(s / 60)
    if (m < 60) return m + " 分钟前"
    const h = Math.floor(m / 60)
    if (h < 24) return h + " 小时前"
    return Math.floor(h / 24) + " 天前"
  }

  // 每一行：名字、值、跟着时间变的那一段
  function rows() {
    const r = [
      ["AppKey", opts.appKey || opts.clientId ? "已填" : "未填", null],
      ["SecretKey", opts.secretKey || opts.clientSecret ? "已填" : "未填", null],
      ["上次保存", opts.savedAt ? "" : "没有", opts.savedAt],
      ["上次提交 code", opts.code ? "已提交，用过即失效 · " : "没有", opts.codeSubmittedAt],
      ["MCP 地址", opts.url || "https://mcp-pan.baidu.com/sse", null],
    ]
    $("status").replaceChildren(...r.map(([k, v, at]) => {
      const li = document.createElement("li")
      li.innerHTML = '<span class="k"></span><span class="v"></span><span class="at"></span>'
      li.querySelector(".k").textContent = k
      li.querySelector(".v").textContent = v
      const atSpan = li.querySelector(".at")
      atSpan.dataset.at = at ? String(at) : ""
      atSpan.textContent = at ? ago(at) : ""
      return li
    }))
  }

  const tick = () => {
    for (const el of document.querySelectorAll("#status .at")) {
      const at = Number(el.dataset.at)
      if (at) el.textContent = ago(at)
    }
  }

  function fill() {
    $("appKey").value = opts.appKey || opts.clientId || ""
    $("secretKey").value = opts.secretKey || opts.clientSecret || ""
  }

  function paint() { rows(); fill() }
  paint()
  setInterval(tick, 1000)

  const note = (el, text, kind) => { el.textContent = text; el.className = "note " + (kind || "") }

  const set = async (extra) => {
    opts = await magpie.options.set({
      ...opts,
      appKey: $("appKey").value.trim(),
      secretKey: $("secretKey").value.trim(),
      redirectUri: "oob",
      ...extra,
    })
    paint()
  }

  $("save").onclick = async () => {
    if (!$("appKey").value.trim() || !$("secretKey").value.trim()) return note($("saved"), "两项都要填", "bad")
    await set({ savedAt: Date.now() })
    note($("saved"), "已保存。插件会重启一次，工具数在「资源库 › MCP 服务器 › baidu-pan」看", "ok")
  }

  $("link").onclick = () => {
    const key = $("appKey").value.trim()
    if (!key) return note($("saved"), "先填 AppKey", "bad")
    const u = new URL("https://openapi.baidu.com/oauth/2.0/authorize")
    u.searchParams.set("response_type", "code")
    u.searchParams.set("client_id", key)
    u.searchParams.set("redirect_uri", "oob")
    u.searchParams.set("scope", "basic,netdisk")
    u.searchParams.set("qrcode", "1")
    $("url").value = u.toString()
    $("copy").disabled = false
  }

  $("copy").onclick = async () => {
    try { await navigator.clipboard.writeText($("url").value) } catch {
      $("url").select(); document.execCommand("copy")
    }
    $("copy").textContent = "已复制"
    setTimeout(() => { $("copy").textContent = "复制" }, 1500)
  }

  $("login").onclick = async () => {
    const code = $("code").value.trim()
    if (!code) return note($("state"), "先粘一个 code", "bad")
    if (!$("appKey").value.trim()) return note($("state"), "先填 AppKey", "bad")
    await set({ code, codeSubmittedAt: Date.now() })
    note($("state"), "已提交。插件重启后拿它换 token；成功的话资源库里那条服务器的工具数会从 0 变成真实数量", "ok")
  }

  $("again").onclick = async () => {
    opts = (await magpie.options.get()) || {}
    paint()
    note($("state"), "")
    note($("saved"), "")
  }
})()
