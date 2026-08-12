# 自动同步部署说明

本项目采用 GitHub Actions 直接调用 Google Sheets API。代码分析、资料建模、差异比较、发布门槛和 Sheet Upsert 均由仓库内程序执行。

## 自动触发

- 任意分支 Push：分析与校验。
- Pull Request：分析、差异与校验，不写入 Sheet。
- `main` Push：通过发布门槛后写入 Sheet。
- 每日排程：重新检查并维护 Sheet。
- `workflow_dispatch`：可从 Actions 页面手动重跑。

## GitHub Actions Secrets

在 Repository → Settings → Secrets and variables → Actions 建立：

- `GOOGLE_SERVICE_ACCOUNT_JSON`：完整 Service Account JSON，只能放在 Secret。
- `GOOGLE_SHEET_ID`：`1jrmn7f_oBIx1UeVsv9ToP0fbkcisYrLuykb1BiyoUJU`

将目标 Google Sheet 以“编辑者”分享给 Service Account JSON 内的 `client_email`。

## 自动维护内容

- 总览仪表板
- 功能目录
- 代码索引
- 依赖关系
- 契约表
- 变更联动
- 变更影响
- 一致性检查
- 测试矩阵
- 优化路线图
- 同步日志
- 《使用说明》橙色待补齐区域

## 人工字段保护

同步器依据 `governance.config.json` 的 `manualColumns` 保留负责人、优先级、实际结果、验收条件、人工确认与备注。自动产生项目被代码移除时会标记为“已移除”，不会直接删除历史。
