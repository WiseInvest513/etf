import purchase from "./articles/purchase-routes.js";
import major from "./articles/major-us-etfs.js";
import comparison from "./articles/nasdaq-vs-sp500.js";
import selection from "./articles/compare-index-funds.js";
import premium from "./articles/limits-premium-nav.js";
import returns from "./articles/understand-returns.js";
import drawdowns from "./articles/historical-drawdowns.js";
import plan from "./articles/long-term-plan.js";

export const LEARNING_PATH = "/learn/etf";
export const LEARNING_UPDATED_AT = "2026-10-11";
export const BOOK_URL = "https://www.wise-invest.org/book/nasdaq";
export const LEARNING_DESCRIPTION = "从ETF是什么开始，认识纳斯达克100与标普500，再学习购买方式、基金比较、限购溢价、收益回撤与长期投资。";
export const LEARNING_CATEGORIES = ["基础认识", "购买与比较", "收益与长期"];
export const BASKET_IMAGE = {
  src: "/learn/etf/etf-basket.jpg", width: 1536, height: 1024,
  alt: "多种资产汇入透明ETF篮子，再对应为可交易的基金份额的概念示意图",
};
export const INDEX_IMAGE = {
  src: "/learn/etf/index-baskets.jpg", width: 1774, height: 887,
  alt: "分别标记100和500的两只资产篮子，以通用行业图标示意两个指数的选股范围差异",
};

const cover = (slug, alt) => ({ src: `/learn/etf/cover-${slug}.svg`, width: 720, height: 480, alt });
export const LEARNING_ARTICLES = [
  { number: 1, slug: "what-is-etf", title: "ETF 是什么？", subtitle: "纳斯达克100与标普500入门", category: "基础认识", status: "published", cover: BASKET_IMAGE, summary: "理解 ETF 的实际价值、运作机制与收益来源，认识纳指100和标普500，再看清费用、溢价与风险。" },
  ...[
    [2, "purchase-routes", "购买纳指和标普，有哪些方式？", "海外券商、国内场内场外与代币化产品", "购买与比较", "把账户、产品权益、交易与退出串成一张路径图，了解每种购买方式真正需要核对什么。"],
    [3, "major-us-etfs", "美股主要 ETF 一览", "10 只代表产品的规模、持仓、收益与回撤", "基础认识", "从标普、纳指和全市场到海外股票、债券与黄金，建立产品地图，而不是照抄收益排行榜。"],
    [4, "nasdaq-vs-sp500", "纳指与标普有什么区别？", "同时持有，是否真的更加分散？", "基础认识", "拆开选股规则、权重、行业与共同持仓，用穿透计算理解两只基金在组合里分别做什么。"],
    [5, "compare-index-funds", "跟踪同一个指数，基金有什么区别？", "费率、跟踪误差、份额与交易体验", "购买与比较", "从产品身份到全周期成本，学会比较 QQQ、QQQM、标普 ETF 与国内不同基金份额。"],
    [6, "limits-premium-nav", "限购、溢价与净值，怎么看？", "购买前，需要检查的几个数字", "购买与比较", "读懂暂停、限额、净值日期与折溢价，避免把买得到、看起来便宜和值得买混为一谈。"],
    [7, "understand-returns", "为什么你的收益和指数不一样？", "价格收益、含分红收益、汇率与实际成本", "收益与长期", "统一收益对象、时间、分红与币种，理解年化、现金流和人民币账户的实际结果。"],
    [8, "historical-drawdowns", "纳指与标普过去跌过多少？", "理解最大回撤、恢复时间与持有体验", "收益与长期", "从互联网泡沫到 2022 年，既看跌幅也看等待时间，把历史压力换算成自己的账户金额。"],
    [9, "long-term-plan", "如何开始自己的长期投资计划？", "定投、资金安排与再平衡", "收益与长期", "写下目标、资金边界、投入频率、暂停条件和退出安排，把学习变成可以复核的个人计划。"],
  ].map(([number, slug, title, subtitle, category, summary]) => ({ number, slug, title, subtitle, category, summary, status: "published", cover: cover(slug, `${title}的学习封面示意图`) })),
];

export const ARTICLE_SOURCES = [
  { id: "etf-guide", label: "SEC Investor.gov：ETF 投资者指南", url: "https://www.investor.gov/introduction-investing/general-resources/news-alerts/alerts-bulletins/investor-bulletins-24" },
  { id: "etf-basics", label: "SEC Investor.gov：基金与 ETF 基础", url: "https://www.investor.gov/introduction-investing/investing-basics/investment-products/mutual-funds-and-exchange-traded-2" },
  { id: "ndx", label: "Nasdaq：Nasdaq-100 指数编制方法（PDF）", url: "https://indexes.nasdaq.com/docs/Methodology_NDX.pdf" },
  { id: "composite", label: "Nasdaq：综合指数与 Nasdaq-100 的区别", url: "https://www.nasdaq.com/newsroom/nasdaq-composite-vs-nasdaq-100-what-investors-should-know" },
  { id: "sp500", label: "S&P Dow Jones Indices：标普500 指数", url: "https://www.spglobal.com/spdji/en/indices/equity/sp-500/" },
  { id: "sp-method", label: "S&P：美国指数编制方法（PDF）", url: "https://www.spglobal.com/spdji/en/documents/methodologies/methodology-sp-us-indices.pdf" },
  { id: "qqq", label: "Invesco：QQQ 产品介绍", url: "https://www.invesco.com/qqq-etf/en/about.html" },
  { id: "voo", label: "Vanguard：VOO 产品介绍", url: "https://advisors.vanguard.com/investments/products/voo/vanguard-sp-500-etf" },
  { id: "etf-structure", label: "ICI / IDC：ETF 与个人投资者常见问题", url: "https://www.idc.org/idc/issues/types/etf/faqs/ci.faqs_etfs_retail_investors" },
  { id: "fees", label: "SEC Investor.gov：理解投资费用", url: "https://www.investor.gov/introduction-investing/getting-started/understanding-fees" },
  { id: "diversification", label: "SEC Investor.gov：资产配置与分散投资", url: "https://www.investor.gov/introduction-investing/getting-started/asset-allocation" },
  { id: "leveraged", label: "SEC Investor.gov：杠杆与反向 ETF 风险提示", url: "https://www.investor.gov/introduction-investing/general-resources/news-alerts/alerts-bulletins/investor-alerts/sec" },
  { id: "whitepaper", label: "Wise Invest：纳指 / 标普投资白皮书（概念、收益与产品结构章节）", url: "https://www.wise-invest.org/book/nasdaq" },
  { id: "bitget", label: "Bitget：rToken 产品、权益与交易规则", url: "https://www.bitget.com/academy/what-is-bitget-rtoken-tokenized-us-stocks-with-usdt-how-it-works" },
  { id: "binance", label: "Binance：bStocks 常见问题与用户资格", url: "https://www.binance.com/en-AU/support/faq/detail/f0c03cd6509a4085b4cce1636f16be38" },
  { id: "invesco-suite", label: "Invesco：QQQ / QQQM 目标与费用", url: "https://www.invesco.com/us/en/solutions/innovation-suite.html" },
  { id: "spy", label: "State Street：SPY 产品与规模", url: "https://www.ssga.com/us/en/individual/etfs/state-street-spdr-sp-500-etf-trust-spy" },
  { id: "ivv", label: "iShares：IVV 产品与规模", url: "https://www.ishares.com/us/products/239726/ishares-core-sp-500-etf" },
  { id: "vanguard-voo", label: "Vanguard：VOO 2026-06-30 事实表", url: "https://institutional.vanguard.com/assets/corp/fund_communications/pdf_publish/us-products/fact-sheet/F0968.pdf" },
  { id: "vti", label: "Vanguard：VTI 2026-06-30 事实表", url: "https://institutional.vanguard.com/assets/corp/fund_communications/pdf_publish/us-products/fact-sheet/F0970.pdf" },
  { id: "vxus", label: "Vanguard：VXUS 2026-06-30 事实表", url: "https://institutional.vanguard.com/assets/corp/fund_communications/pdf_publish/us-products/fact-sheet/F3369.pdf" },
  { id: "iwm", label: "iShares：IWM 产品与规模", url: "https://www.ishares.com/us/products/239710/ishares-russell-2000-etf" },
  { id: "agg", label: "iShares：AGG 产品与规模", url: "https://www.ishares.com/us/products/239458/ishares-core-total-us-bond-market-etf" },
  { id: "gld", label: "State Street：GLD 产品与规模", url: "https://www.ssga.com/us/en/individual/etfs/spdr-gold-shares-gld" },
  { id: "qqq-aum", label: "Invesco / SEC：2026-09-30 QQQ 资产披露", url: "https://www.sec.gov/Archives/edgar/data/914208/000091420826000360/ivzform8-ka0926.htm" },
  { id: "qqqm-aum", label: "FT / Markit：QQQM 规模快照（2026-10-02）", url: "https://markets.ft.markitdigital.com/data/etfs/tearsheet/summary?s=QQQM%3ANMQ%3AUSD" },
  ...["SPY", "VOO", "IVV", "QQQ", "QQQM", "VTI", "VXUS", "IWM", "AGG", "GLD"].map((symbol) => ({ id: `history-${symbol.toLowerCase()}`, label: `PortfoliosLab：${symbol} 分红调整收益与可用历史回撤（2026-10-11 核验）`, url: `https://portfolioslab.com/symbol/${symbol}` })),
];

// The React reader and build-time HTML use the same manuscript, not two copies.
export const FIRST_ARTICLE = {
  ...LEARNING_ARTICLES[0], updatedAt: LEARNING_UPDATED_AT,
  description: "ETF是什么、有什么价值？详解基金份额、申赎机制和收益来源，认识纳斯达克100与标普500，理解持仓权重、费用、溢价、汇率与投资风险。",
  lead: "ETF 的价值，不只是“一次买很多只股票”。它把资产选择、组合维护和交易组织成一种可持有的工具。先理解它如何工作，再认识纳斯达克100与标普500，以及便利背后仍需承担的成本和风险。",
  sections: [
    { id: "etf-core", toc: "ETF 的核心", title: "ETF：把一篮子资产装进一份基金", blocks: [
      { type: "paragraph", text: "如果你想同时投资多家公司，直接逐一买入，就需要处理许多笔交易。ETF 提供了另一种形式：由基金管理一组资产，投资者买卖这只基金的份额，而不是自己逐一维护整组持仓。ETF 的英文是 Exchange-Traded Fund，可以理解为在交易所交易的基金。", cites: ["etf-guide"] },
      { type: "paragraph", text: "这里最重要的词，不是“交易”，而是“基金”。你持有的份额，代表对基金资产组合的相应权益；它不是某一家公司的股票，也不等于你个人直接登记持有篮子里每一家公司的股份。基金组合可以包含股票、债券等不同资产，具体买什么，要看它的投资目标。", cites: ["etf-guide"] },
      { type: "flow", steps: [ { title: "一组资产", text: "例如不同公司的股票" }, { title: "基金组合", text: "按既定策略管理持仓" }, { title: "基金份额", text: "投资者在交易所买卖" } ], caption: "资产是内容，基金是载体，份额是你持有和交易的单位。" },
      { type: "callout", title: "ETF 是一种产品形式，不是收益承诺。", text: "许多常见 ETF 跟踪指数，也有主动管理的 ETF。不能看到“ETF”三个字，就默认它一定跟踪纳指、一定分散，或者一定保本。先看基金说明书里的投资目标和风险。", cites: ["etf-guide"] },
      { type: "paragraph", text: "ETF 的交易价格会在交易时段变化，基金资产的净值也会随持仓变化。两者有关联，却不一定时时相等：市场价格可能高于净值，也可能低于净值。这就是以后讨论“溢价”和“折价”的起点。", cites: ["etf-guide"] },
    ] },
    { id: "three-concepts", toc: "交易所、指数与基金", title: "先分清三个名字：交易所、指数、ETF", blocks: [
      { type: "paragraph", text: "新闻说“纳斯达克上涨”，产品页面写“纳斯达克100”，交易软件里又有“QQQ”。这些名字有关联，但不是同一种东西。可以先按下面的关系理解。" },
      { type: "table", caption: "三个概念，解决三个不同的问题", headers: ["概念", "它是什么", "你要关注什么"], rows: [ ["交易所", "股票等证券上市和交易的市场，例如 Nasdaq", "证券在哪里上市或交易"], ["指数", "按规则选取证券、确定权重并计算表现的指标", "选了谁、怎么分配权重"], ["ETF", "可以交易的基金产品，可把某个指数作为跟踪目标", "跟踪目标、费率、净值与交易价格"] ] },
      { type: "paragraph", text: "以产品为例：Invesco 的 QQQ 跟踪纳斯达克100指数，Vanguard 的 VOO 跟踪标普500指数。指数是它们希望跟随的目标；QQQ、VOO 才是可买卖的具体基金。产品代码不同，不一定意味着背后的指数不同。", cites: ["qqq", "voo"] },
      { type: "heading", text: "指数是一套规则，不是一张永远不变的股票名单" },
      { type: "paragraph", text: "基金负责把指数目标落实为资产组合。它可能尽量持有全部成分，也可能采用抽样等合同允许的方法；现实中还会存在现金、交易和费用。于是“指数表现”和“基金净值表现”并非天然完全一致。指数可以被计算得很精确，但基金仍要在真实市场里执行。", cites: ["whitepaper"] },
      { type: "callout", title: "指数涨了 1%，不等于你的账户一定涨 1%。", text: "基金费用会影响净值，买卖价格和买入时点会影响个人收益。跨币种投资还需要统一汇率口径。比较之前，也要区分是否包含分红；这些差异会在后续文章里单独解释。", cites: ["etf-basics"] },
    ] },
    { id: "etf-value", toc: "ETF 的实际价值", title: "ETF 的价值：让组合投资更容易执行", blocks: [
      { type: "paragraph", text: "为什么不自己买几十只股票，反而要借助一只基金？原因不在于基金有某种神奇的收益能力，而在于建立和维护组合本身就需要成本。你要分配每只股票的金额，处理交易单位、现金余额和分红，还要面对停牌、并购、成分变化等问题。投资对象越多，重复执行的工作就越多。" },
      { type: "heading", text: "价值一：减少对单一公司的依赖" },
      { type: "paragraph", text: "单只股票可能因为经营失误、产品失败或财务问题发生永久性损失。持有覆盖多家公司、多行业的基金，可以把某一家公司出问题的影响限制在它的权重范围内。这里减少的是特定公司风险，不是市场风险；如果经济环境或估值变化同时影响许多公司，整个组合仍可能明显下跌。", cites: ["diversification"] },
      { type: "heading", text: "价值二：把重复的组合维护交给产品" },
      { type: "paragraph", text: "指数 ETF 按规定目标维护组合，投资者不必每次成分调整都亲自逐只买卖。它把许多执行动作集中到基金层面，让个人可以更多关注资金用途、持有期限和整体配置。这不是“完全不用了解”，而是把需要了解的问题，从每家公司的短期胜负，转向一套组合规则是否适合自己的目标。" },
      { type: "heading", text: "价值三：以可比较的方式取得市场敞口" },
      { type: "paragraph", text: "“敞口”可以简单理解为：哪些资产的变化会影响你的钱。想接触美国大型企业，不必先猜中唯一的赢家，可以先理解一组企业的共同机会与风险。产品披露的投资目标、持仓、费用和跟踪表现，为比较提供了起点。两只基金跟踪相同指数时，你可以进一步比较费用、实现方法和交易条件，而不是只比较营销口号。", cites: ["etf-structure"] },
      { type: "heading", text: "价值四：降低部分执行摩擦，而不是保证最低成本" },
      { type: "paragraph", text: "一次交易取得组合权益，通常比个人分别维护大量股票更方便。部分指数 ETF 的运营费用也较低，但“ETF 一定便宜”不成立：不同策略收费不同，你还可能付出买卖价差、券商费用、汇兑成本或溢价。便利是一种价值，不应被误读为没有成本。最终应看取得同类敞口的总成本，而不是只看一个费率数字。", cites: ["fees"] },
    ] },
    { id: "how-it-works", toc: "份额、净值与交易", title: "它如何运作：你的买单与基金持仓之间发生了什么？", blocks: [
      { type: "heading", text: "二级市场：多数个人投资者买卖基金份额" },
      { type: "paragraph", text: "以美国常见 ETF 为例，个人在券商账户买入时，通常是在交易所按市场价格与其他交易者成交，而不是每次都直接把资金交给基金管理人。你卖出时，也通常是在市场上转让份额。成交价格由买卖双方的订单决定；底层资产价值、交易需求和流动性都会影响报价。", cites: ["etf-structure"] },
      { type: "paragraph", text: "ETF 还存在另一套机制。具备相应资格、与基金建立安排的授权参与者（AP），可以按规定以一篮子证券和现金等交付物换取大单位的 ETF 份额；反过来，也可以交回大单位份额，取得证券篮子或现金。普通个人交易一两份 ETF，并不是在直接执行这套大单位申赎。不同市场和产品的申赎规则有差别，不能照搬美国的资格和流程。", cites: ["etf-guide"] },
      { type: "flow", steps: [{ title: "底层资产", text: "证券篮子、现金等交付物" }, { title: "基金申赎", text: "AP 按规则创建或赎回份额" }, { title: "市场交易", text: "投资者按报价买卖份额" }], caption: "美国常见 ETF 的简化结构：创建时向右，赎回时反向。并非所有产品使用同一种交付方式，个人二级市场买卖不等于直接申赎。" },
      { type: "paragraph", text: "当 ETF 份额价格明显高于取得相应资产篮子的成本，能够参与申赎的机构可能创建份额，再在市场出售；反向差异下，也可能买入份额并赎回。两边的价格差提供经济激励，新增或减少份额的活动有助于价格贴近资产价值。这是理解 ETF 定价的重要机制，但不是价格永远相等的承诺。", cites: ["etf-guide"] },
      { type: "callout", title: "净值、盘中参考值和成交价格，是三个不同的数字。", text: "每份净值大致等于基金净资产除以份额数，通常有规定的估值时点；盘中参考值可能带有估算和时间差；成交价格则是你实际下单的结果。比较溢价时，先核对参考值对应的时间、币种和计算口径，不能拿延迟净值当成绝对实时价值。", cites: ["whitepaper"] },
    ] },
    { id: "return-sources", toc: "收益从哪里来", title: "ETF 不会凭空创造收益：回到它持有的资产", blocks: [
      { type: "paragraph", text: "如果一只 ETF 主要持有股票，它的经济基础仍然是股票。企业经营、每股盈利、现金分配，以及市场愿意支付的价格，共同影响投资者的结果。把多只股票装进基金，并不会额外制造一个保证赚钱的来源；基金只是把这些资产的表现，按持仓和费用等因素传递给持有人。", cites: ["whitepaper"] },
      { type: "callout", title: "虚构例子：盈利增长 10%，股价却下降 12%。", text: "假设一家公司每股盈利从 5 元增至 5.5 元，市盈率从 20 倍降至 16 倍；价格从 5 × 20 = 100 元变成 5.5 × 16 = 88 元。只考虑价格、忽略分红等因素，收益是 −12%。这个例子不是实际公司数据，只说明盈利与估值共同决定结果，不能把盈利增长直接当成投资收益。" },
      { type: "heading", text: "分红也是回报的一部分，但不是“额外白送钱”" },
      { type: "paragraph", text: "基金持有的公司可能支付股息，基金再按产品规则向持有人分配或处理收入。评价完整回报时，需要同时看价格变化和分配，并说明是否将分配再投资。只看价格线，可能漏掉现金收入；反过来，收到分红也不代表总资产凭空增加，因为除息会影响相应价格或净值。高分红率不能单独证明高总回报。", cites: ["etf-basics"] },
    ] },
    { id: "nasdaq-100", toc: "纳斯达克100", title: "纳斯达克100：有筛选规则的大型非金融公司组合", blocks: [
      { type: "paragraph", text: "纳斯达克100（Nasdaq-100）以纳斯达克市场上市的大型非金融公司为选取范围，目标是反映其中100家公司的表现。它不是“美国所有科技股”，也不是“全球最好的100家公司”。是否在 Nasdaq 上市、是否属于金融行业，以及指数的其他资格规则，都影响一家公司能否进入。", cites: ["ndx"] },
      { type: "paragraph", text: "它的核心是选股范围与权重规则，而不是“科技”这个标签。组合里可以有科技公司，也可以有消费、医疗等行业的公司；金融公司则不在这一指数的选取范围内。行业分布会随公司规模和成分调整变化，不能把某一期的比例当成永久比例。", cites: ["ndx"] },
      { type: "paragraph", text: "纳斯达克100采用修正市值加权。简单说，公司规模会影响权重，同时还有调整和约束规则，并不是100家公司各占1%。所以，少数较大权重公司的价格变化，可能对整体表现产生较明显的影响。", cites: ["ndx"] },
      { type: "heading", text: "上市地点、行业与权重，构成它的独特边界" },
      { type: "paragraph", text: "成分和权重会按方法论维护，公司的上涨下跌也会改变相对影响力。“100”表达指数的设计定位；多重股票类别可能让证券数量不同，现行方法在部分调整情形下也允许公司数量暂时超过100。读持仓表时，应该带着截止日期理解，而不是认为一只基金永远只会有整整100条持仓。", cites: ["ndx"] },
      { type: "callout", title: "“纳斯达克综合指数”不等于“纳斯达克100”。", text: "综合指数的覆盖范围更广，包含金融等行业与不同规模的公司。看行情、选基金时，要核对完整指数名称，不要只看到“纳斯达克”就当成同一个基准。", cites: ["composite"] },
    ] },
    { id: "sp500", toc: "标普500", title: "标普500：观察美国大型公司的另一个窗口", blocks: [
      { type: "paragraph", text: "标普500（S&P 500）覆盖500家具有代表性的美国大型公司，常被用作观察美国大盘股票市场的基准。这里的“美国大型公司”是关键：它不是全球股票市场，也不包含所有美国上市公司。", cites: ["sp500"] },
      { type: "paragraph", text: "它也不是简单地把市值排名前500的公司全部放进去。指数有美国公司资格、市值、流动性、盈利等纳入条件，并由指数委员会按规则维护。规模很大，不代表会自动进入；成分公司也不是永远不变。", cites: ["sp-method"] },
      { type: "paragraph", text: "标普500采用自由流通市值加权，可以理解为按可在市场流通的股份价值决定影响力。因此，大公司通常权重更大，并不是每家公司各占0.2%。它覆盖的行业范围更广，但这不意味着每个行业或每家公司权重一样。", cites: ["sp-method"] },
      { type: "paragraph", text: "在市值加权组合里，大型公司上涨，往往既推动指数，也提高自己的相对权重。即使名单没有改变，组合的集中程度也会变化。标普500的行业覆盖较广，但如果少数大公司的规模显著扩大，它们仍可能成为表现的重要驱动。“比某个行业基金更广”与“没有集中风险”，是两回事。" },
      { type: "paragraph", text: "把它当成一个观察美国大型企业整体表现的窗口，比把它理解成“稳稳赚的钱”更准确。股票市场整体下跌时，持有很多家公司的股票基金同样可能下跌。", cites: ["etf-basics"] },
    ] },
    { id: "comparison", toc: "两个指数的区别", title: "放在一起看：差别在“装了什么、装了多少”", blocks: [
      { type: "figure", image: INDEX_IMAGE, caption: "选股范围的概念示意，并非实际持仓、行业权重或风险排名。100与500对应公司数量概念；同一公司的不同股票类别可能使证券数量不同。", cites: ["ndx", "sp-method"] },
      { type: "table", caption: "纳斯达克100与标普500的基本规则", headers: ["比较项", "纳斯达克100", "标普500"], rows: [ ["主要范围", "Nasdaq 上市的大型非金融公司", "符合纳入条件的美国大型公司"], ["行业范围", "不含金融公司，并不只含科技公司", "覆盖金融、科技、医疗等多个行业"], ["权重方法", "修正市值加权", "自由流通市值加权"], ["常见 ETF 示例", "QQQ", "VOO"], ["共同提醒", "不等权、不保本", "不等权、不保本"] ], cites: ["ndx", "sp500", "qqq", "voo"] },
      { type: "paragraph", text: "下面用一个只有三家公司的虚构组合，看看权重如何影响结果。它不是纳指或标普的真实持仓，也不是对未来收益的预测。" },
      { type: "example", title: "假设你持有这样一个组合", holdings: [ { name: "公司 A", weight: 50, move: 10 }, { name: "公司 B", weight: 30, move: 0 }, { name: "公司 C", weight: 20, move: -5 } ], formula: "50% × 10% + 30% × 0% + 20% × (−5%) = +4%", text: "同一期间、仅考虑价格变化，组合收益为 +4%，而不是三家公司涨跌幅的简单平均。这里忽略费用、分红、交易、汇率及期间内权重变化。" },
      { type: "paragraph", text: "所以，比较两个指数时，与其只问“里面有多少家公司”，不如继续问：较大的几家公司占了多少？行业是否集中？它们是否受相似因素影响？公司数量能说明覆盖范围，却不能单独回答风险有多大。" },
      { type: "paragraph", text: "一家公司可以同时满足两个指数的条件。于是，你分别持有跟踪两者的基金，可能是在不同权重下重复持有一些相同公司，而不是取得完全独立的两篮子股票。组合是否更分散，需要把两只基金展开后合并看，而不是数账户里的基金代码数量。", cites: ["whitepaper"] },
    ] },
    { id: "costs-and-price", toc: "费用、溢价与汇率", title: "为什么买了同一个指数，最后赚到的钱却不一样？", blocks: [
      { type: "paragraph", text: "指数到个人账户之间，还有一连串真实摩擦。基金要付运营与交易成本；你要以某个报价成交；跨币种持仓还受汇率影响。即使两个人买同一只基金，只要投入时间、金额或分红处理不同，个人收益也可能不同。“我买的是标普”不足以完整解释一笔投资的结果。", cites: ["whitepaper"] },
      { type: "heading", text: "费用不仅是交易软件里看到的手续费" },
      { type: "table", caption: "从指数表现到账户收益，需要检查的几层差异", headers: ["项目", "它影响什么", "初学者应怎样理解"], rows: [["基金持续费用", "在基金资产层面支付，影响净值", "通常不会在账户里每年单独扣一笔钱；不同基金有不同费用"], ["交易费用与价差", "买入、卖出的实际执行成本", "零佣金也不等于零成本，卖价和买价之间可能有差距"], ["溢价或折价", "成交价相对于参考资产价值的偏离", "不仅要看基金涨跌，还要看你买得是否偏贵"], ["跟踪表现", "基金回报与基准回报的偏离", "费用、现金和执行方式等可能造成差异"], ["汇率与分配处理", "把资产回报换成账户币种及现金流", "统一币种，说明是否计入分红再投资"], ["税费与渠道成本", "最终可取得的净回报", "依账户、产品与适用规则而异，不能默认每个人相同"]], cites: ["fees", "whitepaper"] },
      { type: "heading", text: "溢价回落，可以让底层没跌的投资也亏钱" },
      { type: "callout", title: "虚构例子：参考价值不变，5%溢价回落产生约4.76%的价格损失。", text: "假设每份可比参考价值为1元，你以1.05元买入；后来参考价值仍为1元，市场价格回到1元。忽略其他费用，收益是1 ÷ 1.05 − 1 ≈ −4.76%。不是底层资产跌了，而是进入时付出的额外价格消失了。这里假设参考值时间与币种可比，真实跨境产品必须先核对这一点。" },
    ] },
    { id: "types-and-risks", toc: "ETF 不是安全标签", title: "同样叫 ETF，可能是完全不同的投资", blocks: [
      { type: "paragraph", text: "ETF 描述交易和产品形式，并不统一投资对象。股票、债券、不同国家或行业、主动策略，背后的风险来源不同。市场上还有被统称为交易所交易产品的其他结构，其法律性质未必与普通股票 ETF 相同。不能因为它们显示在同一软件分类里，就认为取得相同权利、可以用相同方式长期持有。", cites: ["etf-basics"] },
      { type: "table", caption: "先识别篮子内容，再讨论是否适合", headers: ["类型", "通常关注什么", "不能自动推导什么"], rows: [["宽基股票 ETF", "较广的一组股票及其权重", "覆盖较广不等于全球覆盖，也不等于没有回撤"], ["行业或主题 ETF", "特定行业、产业链或主题规则", "很多公司可能仍受同一因素影响"], ["债券 ETF", "债券信用、期限和利率等风险", "有利息收入不等于基金价格不会跌"], ["主动管理 ETF", "基金经理的策略、持仓与费用", "ETF 不都采用被动指数策略"], ["杠杆或反向 ETF", "目标倍数、方向与重置周期", "不能把每日目标倍数当成多年收益倍数"]], cites: ["etf-basics", "leveraged"] },
      { type: "heading", text: "尤其要分清“普通指数”与“每日杠杆目标”" },
      { type: "paragraph", text: "许多杠杆和反向 ETF 设定的是每日表现目标，并按日重置。复利和价格路径会使较长期间的表现，显著偏离你直觉中的固定倍数。所谓“三倍纳指”，不能直接理解成“纳指十年收益乘三”。初学者应先识别投资目标与重置机制，不要把相似名称当成普通指数基金的升级版。", cites: ["leveraged"] },
      { type: "paragraph", text: "持有很多公司可以减少一家公司失败的影响，但股票市场共同下跌、估值压缩、行业集中和流动性变化，仍会作用于组合。降低研究和操作负担，与降低所有风险不是同一回事。你还可能遇到基金终止、交易受限或渠道规则改变，实际持有体验不能只从一条历史曲线推断。" },
      { type: "paragraph", text: "长期持有也需要资金条件。近期要用的生活费、应急储备或必须按期支付的款项，不能因为工具容易购买，就自然获得承担股票波动的能力。真正需要检查的不是你能不能忍住看行情，而是市场不利时，是否会因现实现金需求被迫卖出。", cites: ["diversification"] },
    ] },
    { id: "next-steps", toc: "读完之后看什么", title: "先知道买的是什么，再研究怎么买", blocks: [
      { type: "paragraph", text: "到这里，你不需要记住所有公司名称。先记住三层关系就够了：指数规定组合规则，基金负责实现投资策略，你持有的是具体基金产品的份额。纳斯达克100与标普500是两套不同的规则，不是两个可以直接下单的商品。" },
      { type: "heading", text: "读产品页面时，按这六个问题逐项核对" },
      { type: "list", items: ["我买的是什么法律产品、哪一种份额？先分清普通 ETF、联接基金与其他结构。", "它跟踪哪个完整指数，或采用什么主动策略？有没有杠杆、反向或每日重置安排？", "它持有哪些资产，头部和行业权重怎样？与已有持仓是否重复？", "持续费用是多少，过去跟踪表现如何？这些数字对应哪段时间和哪种收益口径？", "当前价格相对可比参考价值是否偏离，买卖价差和成交条件如何？", "这笔资金什么时候要用？如果遇到较长回撤，现实支出是否会迫使我退出？"] },
      { type: "paragraph", text: "基金说明书、合同、定期报告与管理人披露，是识别产品的重要依据；行情网站和工具帮助你查看数据，却不能取代正式文件。动态字段要带着日期看：今日额度不能由旧公告直接推断，溢价需要对应报价和参考值，持仓比例也不是永远不变。把规则与实时数据分开，是避免误判的基础。", cites: ["whitepaper"] },
      { type: "paragraph", text: "在国内，通过场内 ETF 或场外基金接触同一指数，涉及的交易规则并不一样。下一篇把海外券商、国内场内场外，以及代币化产品的路径串起来；尤其会说明，代币化产品不自动等同于直接持有 ETF 份额。本文先把基础概念讲清楚，不替你做购买选择。" },
    ] },
  ],
};

export function articlePath(article) {
  return article.status === "published" && article.slug ? `${LEARNING_PATH}/articles/${article.slug}` : null;
}

export const ALL_ARTICLES = [FIRST_ARTICLE, purchase, major, comparison, selection, premium, returns, drawdowns, plan].map((article, index) => ({ ...LEARNING_ARTICLES[index], updatedAt: LEARNING_UPDATED_AT, ...article }));
export const ARTICLE_STATS = Object.fromEntries(ALL_ARTICLES.map((article) => [article.slug, articleStats(article)]));
export function sourcesForArticle(article) {
  const used = new Set(article.sections.flatMap((section) => section.blocks.flatMap((block) => block.cites || [])));
  used.add("whitepaper");
  return ARTICLE_SOURCES.filter((source) => used.has(source.id));
}

export function filterArticles(category = "全部", query = "") {
  const needle = query.trim().toLocaleLowerCase();
  return LEARNING_ARTICLES.filter((article) => (category === "全部" || article.category === category)
    && `${article.title} ${article.subtitle} ${article.category}`.toLocaleLowerCase().includes(needle));
}

export function exampleReturn(holdings) {
  return holdings.reduce((sum, holding) => sum + holding.weight / 100 * holding.move, 0);
}

export function articleStats(article) {
  // Count reader-facing copy only: no asset paths, citations or duplicate metadata.
  const text = article.sections.flatMap((section) => [section.title, ...section.blocks.flatMap((block) => [
    block.title || "", block.text || "", block.caption || "", block.formula || "",
    ...(block.items || []), ...(block.headers || []), ...(block.rows || []).flat(),
    ...(block.steps || []).flatMap((step) => [step.title, step.text]),
    ...(block.holdings || []).map((holding) => holding.name),
  ])]).join("");
  const wordCount = (text.match(/\p{Script=Han}|[\p{L}\p{N}]+/gu) || []).length;
  return { wordCount, minutes: Math.ceil(wordCount / 300), approximateWords: Math.round(wordCount / 100) * 100 };
}
