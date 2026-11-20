// 百度网盘插件的页面：凭证与授权 code 存进 magpie 的 plugins.json（插件的 options），
// 页面自己不能联网，所以授权链接只给你复制，code 由你粘回来。
(async () => {
  await magpie.ready
  const badge = document.getElementById("bridge")
  badge.textContent = "已连接 magpie"
  badge.className = "badge ok"
  const $ = (id) => document.getElementById(id)
  const show = (el, text, bad) => { el.textContent = text; el.className = bad ? "bad" : "ok" }

  let opts = (await magpie.options.get()) || {}
  $("appKey").value = opts.appKey || opts.clientId || ""
  $("secretKey").value = opts.secretKey || opts.clientSecret || ""

  const link = () => {
    const key = $("appKey").value.trim()
    if (!key) return ""
    const u = new URL("https://openapi.baidu.com/oauth/2.0/authorize")
    u.searchParams.set("response_type", "code")
    u.searchParams.set("client_id", key)
    u.searchParams.set("redirect_uri", "oob")
    u.searchParams.set("scope", "basic,netdisk")
    u.searchParams.set("qrcode", "1")
    return u.toString()
  }

  const paintStatus = () => {
    const rows = []
    rows.push(["AppKey", opts.appKey ? "已填" : "未填"])
    rows.push(["SecretKey", opts.secretKey ? "已填" : "未填"])
    rows.push(["上次提交的 code", opts.code ? "有（用过即失效）" : "没有"])
    rows.push(["MCP 地址", opts.url || "默认 https://mcp-pan.baidu.com/sse"])
    $("status").replaceChildren(...rows.map(([k, v]) => {
      const li = document.createElement("li")
      li.innerHTML = '<span class="k"></span><span class="v"></span>'
      li.querySelector(".k").textContent = k
      li.querySelector(".v").textContent = v
      return li
    }))
  }
  paintStatus()

  const save = async (extra) => {
    const next = { ...opts, appKey: $("appKey").value.trim(), secretKey: $("secretKey").value.trim(), redirectUri: "oob", ...extra }
    opts = await magpie.options.set(next)
    paintStatus()
    return opts
  }

  $("save").onclick = async () => {
    if (!$("appKey").value.trim() || !$("secretKey").value.trim()) return show($("saved"), "两项都要填", true)
    await save({})
    show($("saved"), "已保存，插件正在重启")
  }

  $("link").onclick = () => {
    const u = link()
    if (!u) return show($("saved"), "先填 AppKey", true)
    $("url").value = u
    $("copy").disabled = false
  }

  $("copy").onclick = async () => {
    const u = $("url").value
    try { await navigator.clipboard.writeText(u) } catch {
      $("url").select(); document.execCommand("copy")
    }
    $("copy").textContent = "已复制"
    setTimeout(() => { $("copy").textContent = "复制" }, 1500)
  }

  $("login").onclick = async () => {
    const code = $("code").value.trim()
    if (!code) return show($("state"), "先粘一个 code", true)
    if (!$("appKey").value.trim()) return show($("state"), "先填 AppKey", true)
    await save({ code })
    show($("state"), "已提交，插件正在用它换 token")
  }
})()
