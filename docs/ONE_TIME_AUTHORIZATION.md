# 无人值守同步的一次性授权

自动分析器、治理数据结构、Google Sheets Upsert 程序与 GitHub Actions 工作流均已建立。由于 ChatGPT 的 Google Drive 连接授权不能被导出给 GitHub Actions，外部无人值守写回仍需要一组独立的 Google Service Account 凭证。

## 需要建立的 GitHub Actions Secrets

- `GOOGLE_SERVICE_ACCOUNT_JSON`：Service Account JSON 的完整内容。
- `GOOGLE_SHEET_ID`：`1jrmn7f_oBIx1UeVsv9ToP0fbkcisYrLuykb1BiyoUJU`

目标试算表必须以编辑者身份分享给 Service Account JSON 中的 `client_email`。凭证不得写入代码、试算表、聊天记录或普通 GitHub 文件。

完成后，每次 `main` 分支 Push 都会自动执行：

1. 解析正式 Userscript。
2. 生成代码索引、依赖、契约、测试与路线图资料。
3. 执行发布门槛检查。
4. Upsert 到治理试算表并保留人工字段。
5. 写入同步日志。
