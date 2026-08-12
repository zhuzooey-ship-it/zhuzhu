# 油猴脚本活文档与配置治理中心

本仓库用于自动分析 Tampermonkey／Userscript 源代码，生成并维护功能目录、代码索引、依赖关系、数据契约、测试覆盖、变更影响、一致性检查与优化路线图，并同步到指定 Google Sheets。

## 单一事实来源

- `src/`：正式代码实现。
- `src/customer-payment-order-assistant.user.js`：唯一正式主脚本入口。
- `governance/*.json`：经确认的功能、契约、测试、联动与路线图资料。
- `generated/`：分析器生成的机器资料，不应手动编辑。
- Google Sheets：配置、可视化、验证结果、负责人和决策记录。

## 自动流程

1. Push、Pull Request、手动触发或每日排程启动 GitHub Actions。
2. 确认正式内部代码没有放在 Public Repository。
3. 扫描主脚本与 `src/` 下的支持模块。
4. 提取函数、类、DOM 选择器、API、GM 存储键与调用关系。
5. 比对上一版 Manifest，标记新增、修改、移除及受影响联动规则。
6. 检查重复实现、相似分叉、未映射功能、契约、测试覆盖与疑似敏感资料。
7. 生成 Manifest、Mermaid 架构摘要、变更影响报告和发布门槛。
8. `main` 通过检查后自动 Upsert Google Sheets；人工字段不会被覆盖。
9. 「使用说明」橙色待办区域自动从《优化路线图》重新整理。

## 当前治理试算表

- 可编辑治理副本：`https://docs.google.com/spreadsheets/d/1jrmn7f_oBIx1UeVsv9ToP0fbkcisYrLuykb1BiyoUJU/edit`
- 原始配置表保留不动；因原表对连接器仅开放读取，自动维护目标已切换到治理副本。

## 当前安全门槛

- `zhuzooey-ship-it/zhuzhu` 目前是 Public，因此只放置了不含内部资料的初始化 README。
- 正式脚本、平台网址、API 路径及治理 JSON 必须在 Repository 改为 Private 后才上传。
- 唯一正式 V0.1.4 源文件目前尚未可靠定位，系统保持 `WAITING_FOR_CANONICAL_SOURCE`，不会拿历史脚本或朱朱工具箱误当正式基准。
- 禁止提交账号、密码、Cookie、Authorization Token、TOTP 密钥或 Google Service Account 私钥。

## 一次性帐号授权

自动化代码与维护规则由本项目负责。帐号持有人只需完成无法由外部代理代替的三项动作：

1. 将 GitHub Repository 改为 Private。
2. 将唯一正式 `.user.js` 放入指定路径，或提供可访问的正式文件。
3. 建立 Google Service Account、分享目标 Sheet，并把凭证存入 GitHub Actions Secrets。

完成后，每次代码更新都会自动重建资料、检查遗漏并维护试算表。

详见：

- `docs/ONE_TIME_AUTHORIZATION.md`
- `docs/AUTOMATION_SETUP.md`
- `docs/OPERATING_MODEL.md`
- `docs/ADR-0001-code-governance.md`
- `SECURITY.md`
