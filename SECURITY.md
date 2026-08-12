# 安全规则

## 禁止提交

- 后台账号与密码
- TOTP／OTP 密钥
- Cookie、Session、Authorization Header
- Google Service Account JSON
- GitHub Personal Access Token
- 未脱敏的会员资料或支付凭证

## 仓库可见性

治理框架本身可以存放在 Public 仓库，但正式内部 Userscript、平台网址、API 路径和生成的代码索引可能包含内部信息。正式代码接入前，应将仓库改为 Private。

## 日志原则

分析器只记录代码结构、名称、行号、哈希与风险类型。检测到疑似密钥时，只记录文件与行号，不输出密钥内容。
