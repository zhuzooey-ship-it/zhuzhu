# 油猴脚本活文档与配置治理中心

本仓库用于自动分析 Tampermonkey／Userscript 源代码，生成并维护功能目录、代码索引、依赖关系、数据契约、测试覆盖、变更影响与优化路线图，并同步到指定 Google Sheets。

## 单一事实来源

- `src/`：正式代码实现。
- `governance/feature-catalog.json`：经人工确认的功能与业务定义。
- `governance/impact-rules.json`：修改一处时必须联动检查的规则。
- `generated/`：分析器生成的机器资料，不应手动编辑。
- Google Sheets：配置、可视化、验证结果、负责人和决策记录。

## 自动流程

1. Push 或 Pull Request 触发 GitHub Actions。
2. 扫描 `src/**/*.user.js`、`src/**/*.js` 与 `src/**/*.mjs`。
3. 提取函数、类、DOM 选择器、API、GM 存储键和调用关系。
4. 生成 Manifest、依赖图、契约、风险清单和优化路线图。
5. 执行一致性检查与发布门槛检查。
6. `main` 分支在 Google 授权完成后自动同步 Google Sheets。

## 当前状态

自动治理框架已建立。唯一正式 `.user.js` 尚未接入，因此分析结果会显示 `WAITING_FOR_CANONICAL_SOURCE`，避免误把历史脚本或朱朱工具箱版本当成客服支付凭证查单助手的正式基准。

## 安全规则

- 禁止提交账号、密码、Cookie、Authorization Token、TOTP 密钥与 Service Account 私钥。
- 当前仓库若为 Public，正式内部脚本接入前必须改成 Private。
- Google 凭证只允许存放在 GitHub Actions Secrets。
- 自动同步不得覆盖 Google Sheets 的人工字段。

详见：

- `docs/AUTOMATION_SETUP.md`
- `docs/ADR-0001-code-governance.md`
- `SECURITY.md`
