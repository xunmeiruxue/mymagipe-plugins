// 百度网盘插件的页面。凭证与 code 存进 magpie 的 plugins.json（插件 options）。
// 页面不能联网，也不能问 magpie「插件现在有几个工具」，所以每一步都给出
// 明确的三段状态：已提交 → 重启/换 token 中 → 结果去哪看。保存与提交的时间
// 也记进 options，刷新页面后看得见。
(async () => {
  await magpie.ready
  const $ = (id) => document.getElementById(id)
  const badge = $("bridge")
  badge.textContent = "已连接 magpie"
  badge.className = "badge ok"

  let opts = (await magpie.options.get()) || {}

  const ago = (t) => {
    if (!t) return "没有"
    const s = Math.max(0, Math.round((Date.now() - t) / 1000))
    if (s < 60) return s + " 秒前"
    const m = Math.round(s / 60)
    if (m < 60) return m + " 分钟前"
    const h = Math.round(m / 60)
    if (h < 24) return h + " 小时前"
    return Math.round(h / 24) + " 天前"
  }

  function paint() {
    const rows = [
      ["AppKey", opts.appKey || opts.clientId ? "已填" : "未填"],
      ["SecretKey", opts.secretKey || opts.clientSecret ? "已填" : "未填"],
      ["上次保存", ago(opts.savedAt)],
      ["上次提交 code", opts.code ? ago(opts.codeSubmittedAt) + "（用过即失效）" : "没有"],
      ["MCP 地址", opts.url || "https://mcp-pan.baidu.com/sse"],
    ]
    $("status").replaceChildren(...rows.map(([k, v]) => {
      const li = document.createElement("li")
      li.innerHTML = '<span class="k"></span><span class="v"></span>'
      li.querySelector(".k").textContent = k
      li.querySelector(".v").textContent = v
      return li
    }))
    $("appKey").value = opts.appKey || opts.clientId || ""
    $("secretKey").value = opts.secretKey || opts.clientSecret || ""
  }
  paint()

  // 三段状态：提交 → 进行中 → 该去哪里看结果
  const later = (el, ms, text, kind) => setTimeout(() => { el.textContent = text; el.className = "note " + (kind || "") }, ms)

  const save = async (extra) => {
    const next = {
      ...opts,
      appKey: $("appKey").value.trim(),
      secretKey: $("secretKey").value.trim(),
      redirectUri: "oob",
      ...extra,
    }
    opts = await magpie.options.set(next)
    paint()
  }

  $("save").onclick = async () => {
    if (!$("appKey").value.trim() || !$("secretKey").value.trim()) {
      $("saved").textContent = "两项都要填"
      $("saved").className = "note bad"
      return
    }
    $("saved").textContent = "已保存，插件正在重启…"
    $("saved").className = "note"
    await save({ savedAt: Date.now() })
    later($("saved"), 9000, "插件已重启。工具出现在「资源库 › MCP 服务器 › baidu-pan」", "ok")
  }

  $("link").onclick = () => {
    const key = $("appKey").value.trim()
    if (!key) { $("saved").textContent = "先填 AppKey"; $("saved").className = "note bad"; return }
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
    later($("copy"), 1500, "复制", "")
  }

  $("login").onclick = async () => {
    const code = $("code").value.trim()
    if (!code) { $("state").textContent = "先粘一个 code"; $("state").className = "note bad"; return }
    if (!$("appKey").value.trim()) { $("state").textContent = "先填 AppKey"; $("state").className = "note bad"; return }
    $("state").textContent = "已提交，正在换 token…"
    $("state").className = "note"
    await save({ code, codeSubmittedAt: Date.now() })
    later($("state"), 9000, "换完了。资源库里的工具数应从 0 变成真实数量；仍是 0 就重新生成链接拿新 code（旧的一次即失效）", "ok")
    later($("state"), 60000, "如果一直是 0：code 可能过期或已用过，重新生成链接再来一次", "")
  }

  $("again").onclick = async () => {
    opts = (await magpie.options.get()) || {}
    paint()
    $("state").textContent = ""
    $("saved").textContent = ""
  }
})()
