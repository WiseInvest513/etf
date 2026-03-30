# WiseETF — 美股 ETF 对比工具

> 聚焦纳斯达克100、标普500 QDII 基金及场内 ETF 的一站式对比平台

## 功能概览

- **场外基金对比**：纳指被动、标普500被动、美股主动三大分类，实时对比运作费率、规模、涨幅
- **场内 ETF**：溢价率、跟踪误差、日均成交一览
- **实时行情**（5分钟自动刷新）
  - 昨日涨跌：各基金实际日涨幅（非指数估算）
  - 近1年滚动涨幅
- **历史数据**：年度涨跌幅（1990-2025）、关键周期 CAGR、汇率历史
- **今日简报**：每日自动生成市场摘要
- **自选 & 对比**：最多4只基金横向对比

## 数据说明

| 字段 | 来源 | 说明 |
|------|------|------|
| 运作费率 | 天天基金 API | 管理费 + 托管费（年化），不含申购赎回费 |
| 近1年滚动 | 天天基金 API | 最近365天滚动涨幅，实时数据 |
| 昨日涨跌 | 天天基金 API | 各基金实际日涨幅 |
| 25年涨幅 | 静态 | 2025年全年涨幅 |
| 跟踪误差 | 静态 | 年化跟踪误差 |
| USD/CNY | ExchangeRate-API | 实时汇率 |

## 技术栈

- **前端**：React 18 + Vite + Recharts
- **后端**：FastAPI (Python) + uvicorn
- **部署**：Vercel（前端 + API Serverless）

## 本地运行

```bash
# 安装依赖
npm install
pip install -r requirements.txt

# 启动（同时启动前端 :5173 和后端 :8000）
npm run dev
```

访问 http://localhost:5173

## 项目结构

```
├── api/
│   └── index.py        # FastAPI 后端，所有数据接口
├── src/
│   └── App.jsx         # React 前端主文件
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
| `GET /api/live_data` | 实时行情（昨日涨跌 + 近1年，5分钟缓存） |
| `GET /api/overview` | 总览统计数据 |
| `GET /api/news` | 今日简报 |
