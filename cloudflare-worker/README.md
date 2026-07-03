# 支付日志 Worker

这个 Cloudflare Worker 用来接收网页上的“我已支付”点击记录，并把日志安全写入私有 GitHub 仓库 `chengyou-payment-logs` 的 `payment-logs/` 目录。

免费方案：Cloudflare Worker 免费额度足够这个页面使用，不需要自己买服务器。

## 保存内容

每次客户点击“我已支付”后，会写入一个 JSON 文件，包含：

- 公司名称
- 开通手机号
- 姓名
- 是否同意《会员服务与使用须知》
- 是否点击“我已支付”
- 提交时间
- 页面地址
- 浏览器信息

保存路径示例：

```text
payment-logs/2026-07-03/20260703-142530-测试公司-8000-a1b2c3d4.json
```

## 部署步骤

1. 注册或登录 Cloudflare。
2. 安装并登录 Wrangler。
3. 在 `cloudflare-worker/` 目录部署 Worker。
4. 设置 GitHub Token 到 Worker Secret。
5. 把 Worker 地址填入 `index.html` 里的 `PAYMENT_LOG_ENDPOINT`。

需要配置一个 Worker Secret：

```bash
wrangler secret put GITHUB_TOKEN
```

Token 需要有当前仓库的 Contents 写入权限。

部署后，把 Worker 地址填入 `index.html` 里的 `PAYMENT_LOG_ENDPOINT`。
