# 自动同步的一次性授权

自动分析、资料建模和 Google Sheets 同步程序均已由仓库维护。无人值守同步只需要完成一次 Google 授权。

## GitHub Actions Secrets

在 Repository → Settings → Secrets and variables → Actions 中建立：

- `GOOGLE_SERVICE_ACCOUNT_JSON`：完整 Service Account JSON，只能存放在 Secret 中。
- `GOOGLE_SHEET_ID`：`1Vm8b9sPXBXarX6mnOEmNClTrPjYnXuW5rX96Xbdmi6w`

随后把目标 Google Sheet 以“编辑者”分享给 Service Account JSON 中的 `client_email`。

完成后，每次 `main` Push 都会自动分析、校验并同步试算表。

## 人工字段保护

同步器依据 `governance.config.json` 中的 `manualColumns` 保留人工字段，不覆盖负责人、优先级、实测结果、验收条件与备注。
