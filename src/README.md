# 正式 Userscript 放置区

唯一正式基准脚本应放在此目录，例如：

```text
src/customer-payment-order-assistant.user.js
```

规则：

1. 同一时间只能有一个正式基准主脚本。
2. 历史版本使用 Git tag 或 Release，不建立多个 `final`、`new`、`最新版` 副本。
3. 共用逻辑应拆到 `src/modules/`，平台差异放到 `src/adapters/`。
4. 可使用下列注释提供稳定 ID 与用途：

```js
/**
 * @gov-id FUNC-BRIDGE-SEND
 * @feature BRIDGE-001
 * @module 跨 Tab
 * @purpose 建立案件并通知旧后台 Worker
 */
function sendBridgeTask(caseData) {}
```

禁止放入账号密码、Cookie、Token 或 TOTP 密钥。
