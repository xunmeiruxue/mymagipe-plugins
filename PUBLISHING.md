# 发布到 npm

改 `version` → 合并到 main → 工作流发版。`scripts/publish.sh` 只发 npm 上没有的版本，其余跳过。

## 第一次发一个包

Trusted Publishing 只能给已存在的包配置，第一个版本要有人参与一次：

```bash
npm login
cd mcp/<name> && npm publish --access public
npm trust github <包名> --file publish.yml --repo <账号>/<仓库> --allow-publish -y
```

之后 CI 用 OIDC 发，不需要 token。

## CI 里发首版

`STAGE_ON_NEW=1` 时新包走暂存：

```bash
npm stage list
npm stage approve <stage-id>     # 本人，要 2FA
```

## 加插件

新建 `mcp/<name>/package.json`，写 `name`、`version`、`"publishConfig": {"access": "public"}`、`"files"`。合并即发。

scope 包默认私有，漏 `publishConfig.access` 会报 402。

## 仓库变量

| 变量 | 默认 | 作用 |
| --- | --- | --- |
| `STAGE_ON_NEW` | 0 | 新包走 `npm stage publish` |
| `NPM_PROVENANCE` | 1 | 设 0 去掉 `--provenance`，私有仓库必须设 |
