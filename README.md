# magpie plugins

两个目录：

- `plugins/<name>`：magpie 插件
- `mcp/<name>`：把远程 MCP 桥成插件工具的桥

现在有 `mcp/baidu-pan`（百度网盘 MCP，含 token 续期与填写页面）。

## 安装

```bash
magpie plugin add /绝对路径/mcp/baidu-pan
magpie plugin off|on /绝对路径/mcp/baidu-pan     # 改完代码后重载
```

文件夹就地加载，没有构建步骤。

## 命名

目录名就是资源库里的服务器名与工具前缀：`mcp/baidu-pan` → 服务器 `baidu-pan`，工具 `baidu-pan_get_quota`，MCP 路由里 `baidu-pan__get_quota`。

## 从 GitHub 装

`magpie plugin add github:owner/repo` 只读仓库根的 `package.json`，子目录不会被当成插件。所以这个仓库用路径安装；要给别人装，把包发到 npm（见 [PUBLISHING.md](PUBLISHING.md)）。

## 发布

见 [PUBLISHING.md](PUBLISHING.md)。
