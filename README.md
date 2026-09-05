# WiseETF — 美股 ETF 对比工具

> 聚焦纳斯达克100、标普500 QDII 基金及场内 ETF 的一站式对比平台

## 功能概览

- **场外基金对比**：纳指被动、标普500被动、美股主动三大分类，对比费率、规模、自然年度与滚动收益
- **场内 ETF**：溢价率、跟踪误差、日均成交一览
- **每日快照**
  - 昨日涨跌：各基金实际日涨幅（非指数估算）
  - 近1年滚动涨幅
  - 场外申购状态与额度、场内收盘溢价率
- **历史数据**：年度涨跌幅（1990-2025）、关键周期 CAGR、汇率历史
- **今日简报**：每日自动生成市场摘要
- **自选 & 对比**：最多4只基金横向对比

## 数据说明

| 字段 | 来源 | 说明 |
|------|------|------|
| 运作费率 | 天天基金 API | 管理费 + 托管费（年化），不含申购赎回费 |
| 近1年滚动 | 东方财富基金 API | 最近一年滚动涨幅，每日更新 |
| 昨日涨跌 | 天天基金 API | 各基金实际日涨幅 |
| 25年涨幅 | 产品目录 | 2024 年末累计净值至 2025 年末累计净值 |
| 规模 / 费率 | 产品目录 | 低频刷新，保留报告期 |
| 跟踪误差 | 东方财富 F10 特色数据页 | 年化跟踪误差，每日核验，保留上游披露日 |
| 申购状态 / 额度 | 东方财富基金 API | 每日更新；未知不会显示成暂停 |
| ETF 溢价率 | 东方财富行情 + 最新公布净值 | 工作日收盘后更新，任一侧缺失则不重算 |
| USD/CNY | Yahoo Finance | 后端统一快照，失败时标记 stale |

## 技术栈

- **前端**：React 19 + Vite + Recharts
- **后端**：FastAPI (Python) + uvicorn
- **部署**：Vercel（前端 + API Serverless）

## 本地运行

```bash
# 安装依赖
npm install
pip install -r requirements.txt

# 启动（同时启动前端 :5173 和后端 :8000）
# 本地如需手动调用 cron，请在 .env.local 设置 APP_ENV=development。
npm run dev
```

访问 http://localhost:5173

生产环境必须设置 `CRON_SECRET`、Wise ID OIDC 凭据和 Upstash Redis；
cron/admin 接口默认关闭匿名访问。可参考 [`.env.example`](./.env.example)。

## Wise ID 统一登录

Wise ETF 不再保存邮箱密码或向浏览器签发长期 JWT。用户通过 Wise Invest 的
OIDC Authorization Code + PKCE 登录，回调后由 Wise ETF 在 Redis 中建立
30 天可撤销会话，浏览器只持有 `HttpOnly` 会话 Cookie。

在 Wise Invest 的 SSO 后台为 `wise_etf` 登记以下回调地址：

```text
https://www.wise-etf.com/api/auth/callback/wise
http://localhost:5173/api/auth/callback/wise
```

生产环境只需配置 `WISE_AUTH_CLIENT_SECRET`。会话签名密钥会通过用途隔离的
SHA-256 从 Client Secret 自动派生，正式回调地址默认使用 `www.wise-etf.com`。
真实 secret 只能保存在本地或 Vercel 环境变量中，不能使用 `VITE_*` 前缀，
也不能提交到 Git。只有切换主域名时才需要覆盖 `WISE_AUTH_REDIRECT_URI`。

## 更新节奏

| 北京时间 | 任务 | 内容 |
|---------|------|------|
| 工作日 09:10/09:20/09:30 | `/api/cron/funds/{category}` | 三类场外基金错峰更新净值、滚动一年、昨日涨跌、申购状态/额度、跟踪误差；周末不接受上游的闭市状态 |
| 工作日 15:30 | `/api/cron/etfs` | ETF 收盘行情、最新公布净值、滚动一年、跟踪误差与溢价率 |
| 工作日次日 07:30 | `/api/cron/prem` | 补齐历史溢价快照 |

### QDII 估值 v3（默认影子运行）

QDII 估值不再由用户访问页面时临时抓取。受保护的后台任务先更新季度持仓，
再用 Yahoo 批量行情（缺失时才调用对应市场备用源）生成 Redis 快照；公开接口
只读最后一次已验证快照。行情或汇率不完整时只发布短期 `partial`，不会覆盖
永久 Last-Known-Good。

| 北京时间 | 任务 | 内容 |
|---------|------|------|
| 每日 08:10–08:25 | `/api/cron/qdii/holdings/{batch}` | 4 个持仓批次，A/C 份额共用组合 |
| 工作日 09:00–15:45 | `/api/cron/qdii/quotes-asia` | 亚洲交易时段，每 15 分钟 |
| 工作日 16:00–次日 08:55 | `/api/cron/qdii/quotes`（含 late 别名） | 美股盘前/盘中/盘后，每 5 分钟 |

公开读取接口是 `GET /api/v2/qdii/valuations`。生产前端默认显示“逐步上线中”
的内部测试访问门，未解锁时完全不轮询；完成最终验收后设置
`VITE_QDII_ENABLED=true` 可移除访问门。周末可验证周五收盘快照、缓存和
公式，真实盘前/盘中切换需在下一个交易日验收。

规模、费率和已经完结的 2025 自然年度收益来自低频产品目录，不随每日
cron 重复抓取。需要刷新时先只读检查，质量门通过后再原子写入：

```bash
python3 scripts/refresh_catalog_metadata.py
python3 scripts/refresh_catalog_metadata.py --write
```

上游部分失败只会进入短期热缓存；完整永久快照不会被残缺结果覆盖。

## 项目结构

```
├── api/
│   ├── index.py        # FastAPI 路由、provider 与快照发布
│   └── wise_etf/       # 无副作用的数据契约、规范化与计算
├── catalog/            # 唯一产品目录与 JSON Schema
├── scripts/            # 目录 bootstrap / 低频元数据刷新
├── src/
│   ├── App.jsx         # React 前端主文件
│   └── data/           # Web 数据模型与契约测试
├── tests/              # Python 数据/缓存/目录契约测试
├── public/             # 静态资源
├── vercel.json         # Vercel 部署配置
└── requirements.txt    # Python 依赖
```

## API 接口

| 接口 | 说明 |
|------|------|
| `GET /api/funds/nasdaq_passive` | 纳指被动基金列表 |
| `GET /api/funds/sp500_passive` | 标普500被动基金列表 |
| `GET /api/funds/us_active` | 美股主动基金列表 |
| `GET /api/etfs` | 场内ETF列表 |
| `GET /api/live_data` | 兼容旧客户端的每日字段快照 |
| `GET /api/monthly-returns` | 最近12个完整自然月收益 + 当月 MTD |
| `GET /api/market-sentiment` | VIX、CNN 情绪、PE 与指数快照 |
| `GET /api/overview` | 总览统计数据 |
| `GET /api/news` | 今日简报 |
| `GET /api/v2/qdii/valuations` | QDII v3 已验证估值快照（公开只读） |
