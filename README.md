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

生产环境必须设置 `CRON_SECRET`、`JWT_SECRET` 和 Upstash Redis 凭据；
cron/admin 接口默认关闭匿名访问。可参考 [`.env.example`](./.env.example)。

## 更新节奏

| 北京时间 | 任务 | 内容 |
|---------|------|------|
| 每日 09:10/09:20/09:30 | `/api/cron/funds/{category}` | 三类场外基金错峰更新净值、滚动一年、昨日涨跌、申购状态/额度、跟踪误差 |
| 工作日 15:30 | `/api/cron/etfs` | ETF 收盘行情、最新公布净值、滚动一年、跟踪误差与溢价率 |
| 工作日次日 07:30 | `/api/cron/prem` | 补齐历史溢价快照 |

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
