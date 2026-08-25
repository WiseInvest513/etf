export const SITE_ORIGIN = "https://wise-etf.com";

export const HOME_SEO = {
  path: "/",
  title: "WiseETF - 纳指与标普500基金限购、ETF溢价查询",
  description: "查询纳指100、标普500与美股QDII基金的申购额度、费率、近一年收益，以及场内ETF溢价率和数据日期。",
};

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
