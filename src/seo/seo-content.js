export const SITE_ORIGIN = "https://www.wise-etf.com";

export const HOME_SEO = {
  path: "/",
  title: "纳指与标普500基金限购、ETF溢价查询 - WiseETF",
  description: "查询纳指100、标普500与美股QDII基金的申购额度、费率、近一年收益，以及场内ETF溢价率和数据日期。",
  heading: "纳指与标普500基金限购、ETF溢价查询",
  lead: "先看今日还能申购的场外QDII、场内ETF溢价，以及产品费率与数据日期。公开额度和溢价不用登录。",
};

export const GUIDE_SEO = {
  path: "/guide",
  title: "纳指和标普500怎么买：场外QDII、场内ETF、美股直购对比 - WiseETF",
  description: "比较纳指和标普500的三种购买路径：场外QDII、场内ETF和美股直购，并通向今日额度、溢价查询和主站开户教程。",
  heading: "纳指和标普500怎么买：场外 QDII、场内 ETF、美股直购对比",
  lead: "同一指数通常有三条路可走。先分清账户、额度、溢价和确认规则，再查当日数字。",
};

export const ONCHAIN_SEO = {
  path: "/onchain",
  title: "链上美股ETF - QQQ与SPY代币化现货购买路径 - WiseETF",
  description: "比较场外QDII、场内ETF与USDT代币化美股现货的额度、溢价、费率和产品结构，并通向主站开户教程。",
  heading: "链上美股现货：和场外 QDII、场内 ETF 怎么比",
  lead: "把额度限制、场内溢价和代币化现货路径放在一起看，再决定要不要继续走场内、场外或链上。",
};

export const MAIN_SITE_TUTORIALS = [
  { label: "纳指和标普怎么买", href: "https://www.wise-invest.org/articles/index/gCSTzdEB" },
  { label: "限购和溢价怎么看", href: "https://www.wise-invest.org/articles/index/ammF22zK" },
  { label: "开户与开始投资计划", href: "https://www.wise-invest.org/articles/index/eq4k5aIU" },
];

export const PRIVATE_SEO_PAGES = [
  {
    path: "/login",
    title: "登录 - WiseETF",
    description: "登录后查看 QDII 估值。公开的申购额度、场内溢价和产品资料无需登录即可查看。",
    heading: "登录 WiseETF",
    lead: "公开的申购额度和场内溢价不用登录。只有查看 QDII 估值时才需要登录。",
  },
  {
    path: "/qdii",
    title: "QDII 估值 - WiseETF",
    description: "登录后查看 QDII 估值。今日额度和今日溢价仍是公开页面，不必先登录。",
    heading: "登录后查看 QDII 估值",
    lead: "这一页需要登录。今日申购额度和场内溢价仍可在公开工具页直接查看。",
  },
  {
    path: "/lazy",
    title: "懒人组合 - WiseETF",
    description: "WiseETF 懒人组合交互工具页，不作为公开检索目录。",
    heading: "懒人组合",
    lead: "这是交互工具页，不会进入公开检索目录。",
  },
  {
    path: "/export",
    title: "导出数据 - WiseETF",
    description: "导出 WiseETF 公开数据的交互工具页，不作为公开检索目录。",
    heading: "导出数据",
    lead: "这是交互工具页，不会进入公开检索目录。",
  },
  {
    path: "/watchlist",
    title: "我的自选 - WiseETF",
    description: "WiseETF 本地自选基金列表，仅保存在当前浏览器，不作为公开检索目录。",
    heading: "我的自选",
    lead: "自选列表只存在于本地浏览器，不会进入公开检索。",
  },
  {
    path: "/admin",
    title: "管理页 - WiseETF",
    description: "WiseETF 内部管理页，不作为公开检索目录。",
    heading: "管理页",
    lead: "这是内部页面，不会进入公开检索目录。",
  },
];

export const TODAY_PAGE_META = {
  limits: {
    path: "/today/qdii-limits",
    eyebrow: "QDII PURCHASE STATUS",
    title: "今日纳指与标普500 QDII申购额度查询",
    description: "查询纳指100、标普500和美股QDII基金今日是否开放申购、单日限购额度及数据日期，可按额度和状态排序。",
  },
  premium: {
    path: "/today/etf-premium",
    eyebrow: "ETF PREMIUM WATCH",
    title: "今日纳指ETF与标普500 ETF溢价率查询",
    description: "查询纳指ETF和标普500 ETF最新收盘溢价率、场内涨跌、成交额与净值日期，可按溢价风险排序。",
  },
};

export const DECISION_PAGE_META = {
  chooser: {
    path: "/chooser",
    title: "纳指与标普500场内还是场外 - QDII购买路径比较 - WiseETF",
    description: "比较纳指100与标普500场外QDII申购额度、场内ETF溢价率、运作费率、跟踪误差和成交情况，筛选更匹配的购买路径。",
    heading: "纳指和标普500，今天场内还是场外？",
    lead: "把今日申购额度、ETF溢价、费率、跟踪误差与成交情况放到同一个页面比较。",
  },
};

export const TODAY_FAQS = {
  limits: [
    {
      question: "今天哪些纳指和标普500 QDII基金还能买？",
      answer: "先查看页面中的开放申购、限额申购和暂停申购状态，再按每日额度排序。只有当日接口明确返回的状态才视为当前数据，待确认不代表可以买。",
    },
    {
      question: "QDII限购10元、50元是什么意思？",
      answer: "通常指单个基金账户在特定销售渠道的单日累计申购上限。不同份额类别、直销与代销渠道可能采用不同额度，下单前仍需核对实际渠道规则。",
    },
    {
      question: "暂停大额申购和暂停申购有什么区别？",
      answer: "暂停大额申购通常仍允许在限额以内小额申购；暂停申购则表示当前不接受新的申购。WiseETF会结合状态文字与明确额度区分两者。",
    },
    {
      question: "为什么支付宝、天天基金和基金公司直销额度可能不同？",
      answer: "基金公司可以对不同销售渠道、份额类别和账户设置不同的单日累计规则。页面用于快速筛选，最终可买额度以实际下单渠道显示为准。",
    },
  ],
  premium: [
    {
      question: "纳指ETF溢价率是什么意思？",
      answer: "溢价率表示场内交易价格高于基金对应净值的比例。溢价越高，买入价格相对基金资产价值越贵；负值则表示折价。",
    },
    {
      question: "纳指ETF溢价率高有什么风险？",
      answer: "即使纳指本身没有下跌，场内供需恢复后溢价回落也可能造成额外损失。比较产品时应同时查看溢价、场内价格和净值日期。",
    },
    {
      question: "这里展示的是实时IOPV溢价吗？",
      answer: "不是。WiseETF展示最新有效收盘价相对最新已公布净值的参考溢价，并保留两侧日期；盘中行情或日期不匹配时不会冒充正式收盘溢价。",
    },
    {
      question: "如何比较哪只纳指ETF或标普500 ETF溢价更低？",
      answer: "选择对应指数后按溢价从低到高排序，并结合成交额、运作费率和数据日期判断。低溢价不等于一定适合买入，仍需核对实时交易价格。",
    },
  ],
};

export const CATEGORY_PAGE_META = {
  nasdaq: {
    path: "/nasdaq",
    title: "纳指100基金对比 - 申购额度、费率与近一年收益 - WiseETF",
    description: "对比国内纳斯达克100 QDII基金的今日申购额度、限购状态、运作费率、规模、跟踪误差和近一年滚动收益。",
    heading: "纳指100 QDII基金额度与费率对比",
    lead: "查找今天还能申购的纳指基金，并比较每日限额、费率、规模、跟踪误差和近一年收益。",
    category: "nasdaq_passive",
  },
  sp500: {
    path: "/sp500",
    title: "标普500基金对比 - 申购额度、费率与收益 - WiseETF",
    description: "对比国内标普500 QDII基金的今日申购额度、限购状态、运作费率、规模、跟踪误差和近一年滚动收益。",
    heading: "标普500 QDII基金额度与费率对比",
    lead: "集中比较标普500场外基金的申购状态、单日额度、费率、规模和收益数据。",
    category: "sp500_passive",
  },
  etf: {
    path: "/etf",
    title: "纳指与标普500 ETF溢价率查询 - 场内ETF对比 - WiseETF",
    description: "查询纳指ETF与标普500 ETF的最新收盘溢价率、场内涨跌、成交额、基金净值、运作费率和数据日期。",
    heading: "纳指与标普500场内ETF溢价对比",
    lead: "比较同指数ETF的收盘溢价、成交额、费率和净值日期，识别高溢价与时点错配风险。",
    productType: "etf",
  },
  active: {
    path: "/active",
    title: "美股主动QDII基金对比 - 限购额度、费率与收益 - WiseETF",
    description: "对比美股主动QDII基金的今日申购额度、暂停申购状态、运作费率、基金规模、近一年收益和昨日涨跌。",
    heading: "美股主动QDII基金额度与收益对比",
    lead: "集中查看主动美股QDII的申购额度、费率、规模、近一年收益与最新净值涨跌。",
    category: "us_active",
  },
};

export function productSeoTitle(product) {
  if (!product) return HOME_SEO.title;
  const subject = `${product.name}（${product.code}）`;
  return product.product_type === "etf"
    ? `${subject}溢价率、净值与成交额 - WiseETF`
    : `${subject}申购额度、费率与收益 - WiseETF`;
}

export function faqStructuredData(faqs) {
  return faqs.map((item) => ({
    "@type": "Question",
    name: item.question,
    acceptedAnswer: { "@type": "Answer", text: item.answer },
  }));
}
