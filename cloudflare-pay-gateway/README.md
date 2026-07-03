# 成优网短付款链接

Cloudflare Pages 项目，用于生成 30 分钟有效的一次性付款链接。

- 企业付款页：`https://rpin-pay.pages.dev/p/短码`
- 链接生成后台：`https://rpin-pay.pages.dev/admin/`
- 链接状态保存：私有仓库 `chengyou-payment-logs/payment-links/`
- 付款确认日志：私有仓库 `chengyou-payment-logs/payment-logs/`

部署时需要配置两个密钥：

- `GITHUB_TOKEN`：用于写入私有 GitHub 日志仓库
- `ADMIN_TOKEN`：后台生成付款链接时使用的管理口令
