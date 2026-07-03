# 支付日志 Pages Function

这是备用的 Cloudflare Pages Function 部署目录，域名会是 `*.pages.dev`，在部分网络里比 `workers.dev` 更稳定。

部署命令示例：

```bash
wrangler pages deploy public --project-name chengyou-payment-log
wrangler pages secret put GITHUB_TOKEN --project-name chengyou-payment-log
```
