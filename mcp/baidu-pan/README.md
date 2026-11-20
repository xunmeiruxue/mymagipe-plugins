# baidu-pan

百度网盘 MCP 的工具进 magpie，token 由插件续。magpie 的 SSE 条目只能带静态 header，续不了期。

## 安装

```bash
magpie plugin add /绝对路径/mcp/baidu-pan
```

## 授权一次

1. 侧边栏「插件 › 百度网盘」
2. 填 AppKey / SecretKey（开放平台应用凭证里的两项）→ 保存
3. 生成授权链接 → 浏览器打开 → 扫码
4. 把页面上的 code 粘回去 → 用这个 code 登录
5. 几秒后「资源库 › MCP 服务器」里 `baidu-pan` 出现工具

之后不用管：access token 30 天，到期前 10 分钟用 refresh_token 换新的，新的 refresh 写回 `token.json`。只有刷新失败时才需要重做第 3–4 步。

## 文件

| 文件 | 内容 |
| --- | --- |
| `index.mjs` | 插件本体，零依赖，HTTP / SSE + OAuth 续期 |
| `page/` | 填写 AppKey / SecretKey / code 的页面 |
| `token.json` | 自动生成，600 权限；删目录即删 |
| `config.example.json` | 没有页面时的配置样式 |
| `test/e2e.mjs` | 自测：`node test/e2e.mjs`，不需要 magpie 与网络 |

## 管理

| 动作 | 结果 |
| --- | --- |
| 资源库里关掉这条服务器 | Agent 与 MCP 路由都拿不到工具，再打开恢复 |
| 插件页停用 | 工具列表变空，资源库条目还在 |
| 移除插件 | 条目一起消失 |
| 闲置 | 120 秒没有调用就断开与百度的连接；CPU 0 |

## 限制

- 工具清单在加载时读一次，远端加工具要重载插件
- 单次工具调用上限 55 秒
- 只桥 `tools`，不桥 prompts / resources
