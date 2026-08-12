# ADR-0001：采用代码治理 Manifest 与 Google Sheets 活文档

- 状态：Accepted
- 日期：2026-08-13

## 背景

单一大型 Userscript 同时包含新后台、旧后台、OCR、查单、跨 Tab 与 UI。只依赖人工文档容易出现漏改、共用逻辑分叉、代码与文档不同步，以及 AI 只看到局部代码而误判影响范围。

## 决策

1. GitHub 代码是实现层的事实来源。
2. 分析器自动生成 Symbol、Dependency、Contract、Risk 与 Release Manifest。
3. Google Sheets 展示人类可读内容，并保存负责人、测试、验收等人工字段。
4. 自动字段由同步器 Upsert；删除的 Symbol 标记为 Removed，不直接删除历史。
5. 跨模块修改依据 `governance/impact-rules.json` 执行联动检查。
6. 缺少正式代码、契约不一致或高风险检查未完成时，不视为可发布。

## 结果

- 优点：可追踪、可比较，可由静态分析、测试、AI 与人工共同审核。
- 代价：需要维护稳定 ID、测试 fixture，并完成一次 Google API 授权。
