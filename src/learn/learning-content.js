// Full learning articles live only in the main site's articles collection.
export const LEARNING_PATH = "/learn/etf";
export const LEARNING_UPDATED_AT = "2026-11-06";
export const MAIN_LEARNING_URL = "https://www.wise-invest.org/articles/series/nasdaq-investing";
export const BOOK_URL = "https://www.wise-invest.org/book/nasdaq";
export const LEARNING_DESCRIPTION = "按基础、进阶、实操学习 ETF：在 Wise Invest 主站阅读完整教程，在 WiseETF 查询基金额度、场内溢价与产品数据。";
export const BASKET_IMAGE = {"src":"/learn/etf/etf-basket.jpg","width":1536,"height":1024,"alt":"多种资产汇入透明ETF篮子，再对应为可交易的基金份额的概念示意图"};
export const LEARNING_CATEGORIES = ["基础","进阶","实操"];
export const LEARNING_ARTICLES = [
  {
    "number": 1,
    "slug": "what-is-etf",
    "title": "ETF 如何运作？",
    "subtitle": "纳斯达克100与标普500入门",
    "category": "基础",
    "status": "published",
    "cover": {
      "src": "/learn/etf/etf-basket.jpg",
      "width": 1536,
      "height": 1024,
      "alt": "多种资产汇入透明ETF篮子，再对应为可交易的基金份额的概念示意图"
    },
    "summary": "理解基金份额、二级市场交易和申购赎回，分清 ETF 的产品形式、收益来源与结构风险。",
    "mainUrl": "https://www.wise-invest.org/articles/index/OOy6MP9A",
    "mainArticleId": "etf-how-it-works"
  },
  {
    "number": 2,
    "slug": "nasdaq-vs-sp500",
    "title": "纳指与标普有什么区别？",
    "subtitle": "同时持有，是否真的更加分散？",
    "category": "基础",
    "summary": "拆开选股规则、权重、行业与共同持仓，用穿透计算理解两只基金在组合里分别做什么。",
    "status": "published",
    "cover": {
      "src": "/learn/etf/cover-nasdaq-vs-sp500.svg",
      "width": 720,
      "height": 480,
      "alt": "纳指与标普有什么区别？的学习封面示意图"
    },
    "mainUrl": "https://www.wise-invest.org/articles/index/OYI4svII",
    "mainArticleId": "etf-nasdaq-vs-sp500"
  },
  {
    "number": 3,
    "slug": "major-us-etfs",
    "title": "美股主要 ETF 一览",
    "subtitle": "10 只代表产品的规模、持仓、收益与回撤",
    "category": "进阶",
    "summary": "从标普、纳指和全市场到海外股票、债券与黄金，建立产品地图，而不是照抄收益排行榜。",
    "status": "published",
    "cover": {
      "src": "/learn/etf/cover-major-us-etfs.svg",
      "width": 720,
      "height": 480,
      "alt": "美股主要 ETF 一览的学习封面示意图"
    },
    "mainUrl": "https://www.wise-invest.org/articles/index/ekPFyBVH",
    "mainArticleId": "etf-major-products"
  },
  {
    "number": 4,
    "slug": "limits-premium-nav",
    "title": "限购、溢价与净值，怎么看？",
    "subtitle": "购买前，需要检查的几个数字",
    "category": "进阶",
    "summary": "读懂暂停、限额、净值日期与折溢价，避免把买得到、看起来便宜和值得买混为一谈。",
    "status": "published",
    "cover": {
      "src": "/learn/etf/cover-limits-premium-nav.svg",
      "width": 720,
      "height": 480,
      "alt": "限购、溢价与净值，怎么看？的学习封面示意图"
    },
    "mainUrl": "https://www.wise-invest.org/articles/index/ammF22zK",
    "mainArticleId": "etf-premium-nav"
  },
  {
    "number": 5,
    "slug": "understand-returns",
    "title": "为什么你的收益和指数不一样？",
    "subtitle": "价格收益、含分红收益、汇率与实际成本",
    "category": "进阶",
    "summary": "统一收益对象、时间、分红与币种，理解年化、现金流和人民币账户的实际结果。",
    "status": "published",
    "cover": {
      "src": "/learn/etf/cover-understand-returns.svg",
      "width": 720,
      "height": 480,
      "alt": "为什么你的收益和指数不一样？的学习封面示意图"
    },
    "mainUrl": "https://www.wise-invest.org/articles/index/E4W4l3nh",
    "mainArticleId": "etf-understand-returns"
  },
  {
    "number": 6,
    "slug": "historical-drawdowns",
    "title": "纳指与标普过去跌过多少？",
    "subtitle": "理解最大回撤、恢复时间与持有体验",
    "category": "进阶",
    "summary": "从互联网泡沫到 2022 年，既看跌幅也看等待时间，把历史压力换算成自己的账户金额。",
    "status": "published",
    "cover": {
      "src": "/learn/etf/cover-historical-drawdowns.svg",
      "width": 720,
      "height": 480,
      "alt": "纳指与标普过去跌过多少？的学习封面示意图"
    },
    "mainUrl": "https://www.wise-invest.org/articles/index/Cor9u5oW",
    "mainArticleId": "etf-historical-drawdowns"
  },
  {
    "number": 7,
    "slug": "purchase-routes",
    "title": "购买纳指和标普，有哪些方式？",
    "subtitle": "海外券商、国内场内场外与代币化产品",
    "category": "实操",
    "summary": "把账户、产品权益、交易与退出串成一张路径图，了解每种购买方式真正需要核对什么。",
    "status": "published",
    "cover": {
      "src": "/learn/etf/cover-purchase-routes.svg",
      "width": 720,
      "height": 480,
      "alt": "购买纳指和标普，有哪些方式？的学习封面示意图"
    },
    "mainUrl": "https://www.wise-invest.org/articles/index/gCSTzdEB",
    "mainArticleId": "nasdaq-investment-guide"
  },
  {
    "number": 8,
    "slug": "compare-index-funds",
    "title": "跟踪同一个指数，基金有什么区别？",
    "subtitle": "费率、跟踪误差、份额与交易体验",
    "category": "实操",
    "summary": "从产品身份到全周期成本，学会比较 QQQ、QQQM、标普 ETF 与国内不同基金份额。",
    "status": "published",
    "cover": {
      "src": "/learn/etf/cover-compare-index-funds.svg",
      "width": 720,
      "height": 480,
      "alt": "跟踪同一个指数，基金有什么区别？的学习封面示意图"
    },
    "mainUrl": "https://www.wise-invest.org/articles/index/KGs3Ns3k",
    "mainArticleId": "index-guide"
  },
  {
    "number": 9,
    "slug": "long-term-plan",
    "title": "如何开始自己的长期投资计划？",
    "subtitle": "定投、资金安排与再平衡",
    "category": "实操",
    "summary": "写下目标、资金边界、投入频率、暂停条件和退出安排，把学习变成可以复核的个人计划。",
    "status": "published",
    "cover": {
      "src": "/learn/etf/cover-long-term-plan.svg",
      "width": 720,
      "height": 480,
      "alt": "如何开始自己的长期投资计划？的学习封面示意图"
    },
    "mainUrl": "https://www.wise-invest.org/articles/index/eq4k5aIU",
    "mainArticleId": "index-qa-2"
  }
];
export function articlePath(article) { return article?.mainUrl || null; }
export function legacyArticlePath(article) { return LEARNING_PATH + "/articles/" + article.slug; }
export function filterArticles(category = "全部", query = "") {
 const keyword = query.trim().toLocaleLowerCase();
 return LEARNING_ARTICLES.filter(a => (category === "全部" || a.category === category) && [a.title,a.subtitle,a.summary].join(" ").toLocaleLowerCase().includes(keyword));
}

// A local preview can connect to the main site's local server; canonical URLs stay production URLs.
export function learningHref(href) {
  const origin = import.meta.env?.DEV && import.meta.env?.VITE_MAIN_SITE_ORIGIN;
  return origin && href.startsWith("https://www.wise-invest.org/")
    ? href.replace("https://www.wise-invest.org", origin.replace(/\/$/, ""))
    : href;
}
