import { useState, useMemo, useEffect } from "react";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";

// ─── Mobile Hook ──────────────────────────────────────────────────────────────

function useIsMobile() {
  const [m, setM] = useState(() => typeof window !== "undefined" && window.innerWidth <= 768);
  useEffect(() => {
    const fn = () => setM(window.innerWidth <= 768);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);
  return m;
}

// ─── Data ─────────────────────────────────────────────────────────────────────

const ETF_RETURNS = {
  VTI:  [ 21.21, -5.21, 30.67, 21.03, 25.67,-19.51, 26.05, 23.81, 17.10],
  TLT:  [  9.18, -1.61, 14.12, 18.15, -4.60,-31.24,  2.77, -8.06,  4.25],
  IEF:  [  2.34,  0.98,  8.11, 11.31, -5.34,-15.68,  3.36, -1.43,  2.91],
  GSG:  [  4.41,-13.80, 15.77,-23.92, 38.77, 24.08, -5.51,  8.52,  5.93],
  GLD:  [ 12.81, -1.94, 17.86, 24.81, -4.15, -0.77, 12.69, 26.66, 63.68],
  BIL:  [  0.84,  1.73,  2.05,  0.37,  0.05,  0.07,  5.02,  4.94,  4.96],
  BND:  [  3.46,  0.99,  8.03, 10.01,  2.33,-15.16,  3.56, -0.64,  8.03],
  VNQ:  [ 15.76,  0.54, 23.65,  8.64, 21.44,-17.21,  4.52, 10.29,  9.55],
  VXUS: [ 27.03,-14.50, 22.55, 11.36,  5.66,-15.90, 14.71,  9.09,  5.62],
  SPY:  [ 21.80, -4.56, 31.49, 18.40, 28.71,-18.17, 26.06, 25.02, 16.90],
  SHY:  [  0.34,  1.47,  2.31,  0.43,  0.04,  0.08,  5.14,  5.01,  5.18],
  TIP:  [  2.56,  1.92,  3.01, 10.34,  1.44,-12.01,  3.13,  3.24,  5.74],
  EFA:  [ 25.60,-12.83, 22.06,  9.41,  7.06,-12.76, 14.69,  7.08,  3.25],
  VWO:  [ 26.49,-15.28, 20.11,  7.77,  2.54,-17.70,  9.75,  8.09,  1.87],
  VB:   [ 12.74, -9.65, 27.01, 17.70, 31.65,-17.63, 17.11, 14.44,  8.07],
  VBR:  [ 18.44,-12.31, 28.26,  9.95, 28.77,-13.16, 18.64, 13.80,  8.82],
  IVE:  [ 16.83, -6.57, 31.12, 15.00, 26.09,-13.95, 10.57, 16.05, 15.11],
};

const YEARS = [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];

function calcGrowth(returns) {
  let v = 100;
  return YEARS.map((yr, i) => {
    v = v * (1 + returns[i] / 100);
    return { year: yr, value: Math.round(v * 10) / 10 };
  });
}

// 数据来源：btcdca.me 精确抓取（组合1-10）+ lazyportfolioetf.com（组合11-15）
const PORTFOLIOS = [
  {
    id: 1,
    name: "Ray Dalio 全天候",
    nameEn: "All Seasons Portfolio",
    author: "Ray Dalio",
    description: "桥水基金创始人的核心理念：为各种经济周期等权分配风险，追求平稳穿越牛熊。",
    longDescription: [
      "全天候组合由桥水基金创始人 Ray Dalio 提出，其核心哲学是「风险平价」（Risk Parity）：与其在不同资产间等额分配资本，不如让每类资产对组合的风险贡献趋于均等。Dalio 将经济环境划分为四个象限——增长上行/下行、通胀上行/下行——并为每种场景配置最适合的资产，从而使组合无论处于哪种宏观环境都能平稳运行。",
      "具体配置上，30% 美国股票（VTI）应对经济繁荣期，40% 长期国债（TLT）应对通缩与衰退，15% 中期国债（IEF）提供稳定压舱，大宗商品（GSG 7.5%）和黄金（GLD 7.5%）共同对冲通货膨胀。债券超配是全天候的关键特征，持仓者需接受其在利率上行周期（如2022年）的显著回撤。",
      "2017—2025 回测期间，全天候年化收益 6.27%，最大回撤 -21.03%，夏普比率 0.46。对比纯股票组合，其波动大幅降低，适合追求「平稳睡眠」而非最高收益的长期投资者。建议每年再平衡一次，无需择时。",
    ],
    color: "#6366f1",
    cagr: 6.27, maxDrawdown: -21.03, sharpe: 0.46, sortino: 0.68, volatility: 8.92,
    beta: 0.40, alpha: 0.88, r2: 52.6,
    allocs: [["VTI",30],["TLT",40],["IEF",15],["GSG",7.5],["GLD",7.5]],
    allocLabels: { VTI:"美国股票", TLT:"长期国债", IEF:"中期国债", GSG:"大宗商品", GLD:"黄金" },
    returns: [14.51,-4.17,21.97,16.79,12.31,-19.53,13.37,10.13,14.62],
  },
  {
    id: 2,
    name: "Harry Browne 永久组合",
    nameEn: "Permanent Portfolio",
    author: "Harry Browne",
    description: "四分天下：股票应对繁荣，黄金应对通胀，长债应对通缩，现金应对衰退。极致简洁。",
    longDescription: [
      "永久组合由美国投资作家 Harry Browne 于1981年创立，设计理念极其简洁：把财富平均分成四份，分别配置股票（25%）、黄金（25%）、长期国债（25%）和现金/短期国债（25%），以应对经济可能处于的四种状态：繁荣、通胀、通缩和萧条。",
      "这四类资产通常具有低相关甚至负相关性：股市上涨时黄金往往横盘，衰退时债券和黄金齐涨，通胀飙升时黄金和大宗商品大涨而债券受损。正是这种天然对冲使永久组合成为所有懒人组合中**回撤最小**的之一（-15.93%）。代价是长牛期间收益落后于纯股票组合。",
      "2022 年黄金的强势和短期国债利息收入帮助组合在熊市中仅下跌 12.86%，远优于标普 500 的 -18%。2025 年黄金大涨 63.68%，永久组合全年录得 +22.50%，是本站所有组合中 2025 年表现最佳的之一。适合追求绝对稳健、风险极度厌恶的投资者。",
    ],
    color: "#f59e0b",
    cagr: 8.21, maxDrawdown: -15.93, sharpe: 0.77, sortino: 1.24, volatility: 7.61,
    beta: 0.28, alpha: 2.50, r2: 42.0,
    allocs: [["VTI",25],["TLT",25],["BIL",25],["GLD",25]],
    allocLabels: { VTI:"美国股票", TLT:"长期国债", BIL:"短期国债", GLD:"黄金" },
    returns: [11.01,-1.76,16.17,16.09,4.24,-12.86,11.63,11.84,22.50],
  },
  {
    id: 3,
    name: "经典 60/40",
    nameEn: "60/40 Stock/Bond",
    author: "传统智慧",
    description: "最经典的资产配置组合，六成股票获取增长，四成债券降低波动。几十年来机构投资者的默认选择。",
    longDescription: [
      "60/40 组合是全球最广为人知的资产配置策略，简单到不需要任何金融学背景就能理解和执行：60% 投资于美国股票指数基金，40% 投资于美国综合债券指数基金。这一比例在过去半个世纪被无数养老金、保险资金和个人投资者奉为标准。",
      "其逻辑在于：股票提供长期增长引擎，债券在熊市中起到「压舱石」作用，两者历史上大多数时期呈负相关。当股市崩盘时，投资者涌入国债避险，债券价格上涨可以对冲股票亏损，平滑整体净值曲线。然而 2022 年是个例外——股债双杀导致该组合下跌 -17.77%，让部分投资者质疑其可靠性。",
      "从长期数据来看，60/40 在 2017—2025 年实现了 9.00% 的年化收益，最大回撤 -20.69%，夏普比率 0.64，在全部 15 个组合中居于中上水平。它是衡量其他组合的「基准线」：任何懒人组合都应该问自己，是否比 60/40 拥有更好的风险调整收益。",
    ],
    color: "#3b82f6",
    cagr: 9.00, maxDrawdown: -20.69, sharpe: 0.64, sortino: 0.95, volatility: 10.67,
    beta: 0.64, alpha: 1.80, r2: 88.0,
    allocs: [["VTI",60],["BND",40]],
    allocLabels: { VTI:"美国股票", BND:"美国债券" },
    returns: [14.11,-2.73,21.61,16.62,16.33,-17.77,17.05,14.03,13.47],
  },
  {
    id: 4,
    name: "耶鲁捐赠基金",
    nameEn: "Yale Endowment",
    author: "David Swensen",
    description: "耶鲁大学CIO David Swensen为个人投资者设计的简化版，加入REITs和TIPS，注重真实资产暴露。",
    longDescription: [
      "David Swensen 是耶鲁大学捐赠基金的首席投资官，在任30余年将基金从13亿美元增长至超过400亿美元，被誉为机构投资界最伟大的实践者之一。然而他管理的捐赠基金大量配置私募股权、风险投资和对冲基金，普通投资者无法复制。为此他在《个人投资者之道》中为普通人设计了这一可执行的简化版本。",
      "组合的核心思路是：广泛分散、注重真实资产（REITs + TIPS）、减少对单一市场依赖。15% 的 VTI（美国股票）+ 15% 的 VXUS（国际股票）覆盖全球股权，20% 的 VNQ（REITs）提供房地产敞口，30% 的 BND（综合债券）提供稳定性，20% 的 TIP（通胀保值债券）对抗通胀侵蚀。",
      "2017—2025 回测年化收益 7.70%，最大回撤 -21.37%，夏普比率 0.51。与经典 60/40 相比，收益略低但多元化程度更高，在通胀上行的 2021 年（+9.97%）表现更为稳健。适合相信全球分散、重视通胀保护的长期投资者。",
    ],
    color: "#0284c7",
    cagr: 7.70, maxDrawdown: -21.37, sharpe: 0.51, sortino: 0.73, volatility: 10.98,
    beta: 0.52, alpha: 1.10, r2: 72.0,
    allocs: [["VTI",15],["VXUS",15],["VNQ",20],["BND",30],["TIP",20]],
    allocLabels: { VTI:"美国股票", VXUS:"国际股票", VNQ:"房地产", BND:"债券", TIP:"通胀保值债" },
    returns: [11.94,-2.17,15.72,11.66,9.97,-15.70,8.71,7.45,8.88],
  },
  {
    id: 5,
    name: "常青藤组合",
    nameEn: "Ivy Portfolio",
    author: "Meb Faber",
    description: "仿照哈佛/耶鲁等顶尖捐赠基金构建，五类资产等权分配，含大宗商品，周期性轮动效果明显。",
    longDescription: [
      "Meb Faber 在2009年出版的《常青藤组合》一书中，系统研究了哈佛、耶鲁等顶尖大学捐赠基金的资产配置方法，并提炼出普通人可执行的简化版本。核心逻辑是：机构投资者数十年积累的配置智慧，经过公募基金民主化之后，个人投资者也可以低成本复制。",
      "五类资产各占 20%：美国股票（VTI）、国际股票（VXUS）、债券（BND）、房地产（VNQ）和大宗商品（GSG）。大宗商品的加入是常青藤组合区别于多数其他懒人组合的关键——它在通胀加剧时表现突出，如 2021 年 GSG 上涨 38.77%，显著提升了当年组合的收益。",
      "2017—2025 年化收益 8.17%，最大回撤 -21.97%，夏普比率 0.53。大宗商品的高波动性使其在部分年份拖累表现（如 2020 年 GSG 下跌 -23.92%），但长期而言为组合提供了额外的分散化收益来源。原书还提供了基于200日均线的趋势跟踪变体版本，可进一步降低回撤。",
    ],
    color: "#10b981",
    cagr: 8.17, maxDrawdown: -21.97, sharpe: 0.53, sortino: 0.72, volatility: 11.68,
    beta: 0.58, alpha: 1.00, r2: 75.0,
    allocs: [["VTI",20],["VXUS",20],["BND",20],["VNQ",20],["GSG",20]],
    allocLabels: { VTI:"美国股票", VXUS:"国际股票", BND:"债券", VNQ:"房地产", GSG:"大宗商品" },
    returns: [14.37,-6.40,20.13,5.42,18.77,-8.74,8.67,10.21,9.25],
  },
  {
    id: 6,
    name: "咖啡馆组合",
    nameEn: "Coffee House Portfolio",
    author: "Bill Schultheis",
    description: "Bill Schultheis提倡：做好资产配置后，去喝杯咖啡不要管它。7类资产广泛分散，债券压舱稳定。",
    longDescription: [
      "前史密斯·巴尼证券经纪人 Bill Schultheis 在2009年出版了《咖啡馆投资者》，书名本身就是整个理念的精髓：建立一个合理分散的组合，然后放手不管，去喝杯咖啡享受生活。他认为绝大多数主动管理基金长期跑输指数，投资者最好的选择是低成本指数基金配以合理的再平衡纪律。",
      "咖啡馆组合由7类资产构成：40% 的 BND 债券提供基本稳定性，剩余 60% 的股票部分平均分散于大盘价值（IVE）、标普500（SPY）、小盘价值（VBR）、小盘股（VB）、REITs（VNQ）和国际股票（VXUS）各 10%。小盘价值因子的纳入体现了 Fama-French 三因子模型的影响——历史数据显示小盘价值股存在长期超额收益。",
      "2017—2025 年化收益 6.64%，最大回撤 -19.70%，夏普比率 0.43。由于 40% 的高债券占比，组合整体偏保守，在股票牛市期间（如2019、2023年）表现落后于纯股票组合，但在2018、2022年的调整中显示出较强的抗跌性。适合保守型投资者作为核心长期持仓。",
    ],
    color: "#84cc16",
    cagr: 6.64, maxDrawdown: -19.70, sharpe: 0.43, sortino: 0.61, volatility: 10.84,
    beta: 0.48, alpha: 0.50, r2: 68.0,
    allocs: [["IVE",10],["SPY",10],["VBR",10],["VB",10],["VNQ",10],["VXUS",10],["BND",40]],
    allocLabels: { IVE:"大盘价值", SPY:"标普500", VBR:"小盘价值", VB:"小盘股", VNQ:"房地产", VXUS:"国际股票", BND:"债券" },
    returns: [12.64,-4.31,19.62,12.11,15.16,-15.67,10.58,8.61,9.62],
  },
  {
    id: 7,
    name: "无脑四分组合",
    nameEn: "No Brainer Portfolio",
    author: "Bill Bernstein",
    description: "Bernstein的极简主义：四类等权资产，完全不需要动脑筋，却能获得市场平均回报。",
    longDescription: [
      "神经科学家出身的投资作家 Bill Bernstein 在其经典著作《投资的四根支柱》中，为完全不想研究市场的投资者设计了这个「无脑」组合：四类资产等权分配，各 25%，每年再平衡一次，此外无需任何操作。Bernstein 认为，主动投资者平均而言跑不赢市场，而这个简单组合足以击败大多数专业基金经理。",
      "四类资产分别是：标普500指数（SPY 25%）代表美国大盘，小盘股指数（VB 25%）捕捉小盘溢价，国际股票（VXUS 25%）提供全球分散，短期国债（SHY 25%）作为稳定器。高达75%的股票占比使其在牛市中能充分受益，2021年标普+28.71%、小盘股+31.65%，推动当年组合大涨 +16.52%。",
      "2017—2025 年化收益 8.83%，最大回撤 -19.69%，夏普比率 0.57。在本站所有15个组合中属于中等偏上水平，同时执行难度极低，非常适合初次接触指数投资的新手，以及没有精力深入研究市场的忙碌上班族。",
    ],
    color: "#06b6d4",
    cagr: 8.83, maxDrawdown: -19.69, sharpe: 0.57, sortino: 0.83, volatility: 11.89,
    beta: 0.72, alpha: 0.80, r2: 82.0,
    allocs: [["SPY",25],["VB",25],["VXUS",25],["SHY",25]],
    allocLabels: { SPY:"标普500", VB:"小盘股", VXUS:"国际股票", SHY:"短期国债" },
    returns: [15.48,-6.81,20.84,11.97,16.52,-12.90,15.76,13.39,8.94],
  },
  {
    id: 8,
    name: "核心四基组合",
    nameEn: "Core Four Portfolio",
    author: "Rick Ferri",
    description: "指数基金专家Rick Ferri的精华：四个基金覆盖全球股票+债券+REITs，低费率、广分散。",
    longDescription: [
      "Rick Ferri 是先锋集团（Vanguard）的知名倡导者和指数基金投资专家，其核心四基组合的哲学是：用最少的基金数量实现最广泛的资产覆盖。仅需四只指数基金——美国股票、国际股票、债券和房地产——就能建立一个涵盖全球主要资产类别的多元化组合，且年化费率极低。",
      "具体配置：48% VTI（美国股票）+ 24% VXUS（国际股票）= 合计72%全球股权敞口，20% BND（综合债券）提供收益和稳定性，8% VNQ（REITs）捕捉房地产风险溢价。股债比约为 72/28，相较于经典 60/40 更为进取。美国/国际股票 2:1 的比例大致反映了全球市值分布。",
      "2017—2025 年化收益 9.60%，是本站所有组合中仅次于巴菲特90/10的最高年化收益，最大回撤 -23.55%，夏普比率 0.60。对于希望获得接近全股票收益、同时保持基础风险管理的投资者，核心四基是非常均衡的选择。执行门槛极低，四只基金在任何主要券商均可购买。",
    ],
    color: "#f97316",
    cagr: 9.60, maxDrawdown: -23.55, sharpe: 0.60, sortino: 0.88, volatility: 12.65,
    beta: 0.78, alpha: 0.70, r2: 88.0,
    allocs: [["VTI",48],["VXUS",24],["BND",20],["VNQ",8]],
    allocLabels: { VTI:"美国股票", VXUS:"国际股票", BND:"债券", VNQ:"房地产" },
    returns: [18.62,-5.74,23.63,15.51,15.86,-17.59,17.11,14.31,11.93],
  },
  {
    id: 9,
    name: "巴菲特 90/10",
    nameEn: "Buffett 90/10",
    author: "Warren Buffett",
    description: "巴菲特在遗嘱中建议：90%投入标普500指数基金，10%短期国债。本站CAGR最高组合。",
    longDescription: [
      "这是所有懒人组合中最著名的一个。Warren Buffett 在2013年致伯克希尔股东信中披露，他在遗嘱中为妻子的信托基金留下了明确的投资指示：90%买入低费率标普500指数基金（他点名先锋集团的SPY类产品），10%买入短期政府债券。理由是：长期而言没有主动基金经理能持续跑赢指数，最好的做法就是拥有美国商业的一小份，等待美国经济增长。",
      "90% 的股票占比使这个组合本质上接近纯股票组合，仅用10%的短期国债提供极少量缓冲。这意味着在牛市中收益丰厚——2019年+28.57%，2023年+23.97%，2024年+23.02%；但在熊市中也承受较大压力——2022年下跌 -16.35%，2018年下跌 -3.96%。",
      "2017—2025 年化收益高达 12.41%，在本站15个组合中排名第一，但波动率也是最高的（14.33%）。这一组合的隐含前提是：投资者有足够长的投资期限（15年以上），有足够强的心理承受能力在市场大跌时坚持持有，不会因为短期浮亏而割肉离场。只有满足这两点，90/10才能发挥其威力。",
    ],
    color: "#ef4444",
    cagr: 12.41, maxDrawdown: -22.79, sharpe: 0.72, sortino: 1.10, volatility: 14.33,
    beta: 0.96, alpha: 1.50, r2: 99.0,
    allocs: [["SPY",90],["SHY",10]],
    allocLabels: { SPY:"标普500 ETF", SHY:"短期国债" },
    returns: [19.65,-3.96,28.57,16.60,25.84,-16.35,23.97,23.02,15.73],
  },
  {
    id: 10,
    name: "Swensen 懒人组合",
    nameEn: "David Swensen Lazy",
    author: "David Swensen",
    description: "耶鲁CIO面向普通个人投资者的另一版本：纳入新兴市场和TIPS，追求更广泛的全球多元化。",
    longDescription: [
      "这是 David Swensen 除耶鲁捐赠基金版本之外，为零售投资者提供的另一个配置方案，发表于2005年出版的《非凡的成功》一书。与耶鲁捐赠版相比，本版本加入了新兴市场股票（VWO）和发达市场股票（EFA），更强调全球股权分散，同时保留了通胀保值债券（TIPS）和短期国债（SHY）作为防御层。",
      "30% VTI 美国股票构成股票核心，20% VNQ 房地产提供实物资产敞口，15% EFA 发达市场 + 5% VWO 新兴市场覆盖全球股权，15% TIP 通胀保值债券对冲通胀，15% SHY 短期国债提供流动性缓冲。全球股票合计占比 50%，防御资产合计 50%，整体配置均衡。",
      "2017—2025 年化收益 7.70%，最大回撤 -21.37%，夏普比率 0.51，波动率 10.98%。新兴市场在 2017 年贡献了较好的收益（VWO +26.49%），但在 2018、2022 年则拖累组合。对比耶鲁捐赠版，两者指标几乎相同，风险收益特征高度相似，选择哪个更多取决于个人对新兴市场的态度。",
    ],
    color: "#a855f7",
    cagr: 7.70, maxDrawdown: -21.37, sharpe: 0.51, sortino: 0.73, volatility: 10.98,
    beta: 0.52, alpha: 1.10, r2: 72.0,
    allocs: [["VTI",30],["VNQ",20],["EFA",15],["VWO",5],["TIP",15],["SHY",15]],
    allocLabels: { VTI:"美国股票", VNQ:"房地产", EFA:"发达市场", VWO:"新兴市场", TIP:"通胀保值债", SHY:"短期国债" },
    returns: [15.11,-3.64,19.04,11.45,13.40,-13.88,12.65,11.91,9.26],
  },
  // ── 本站扩展组合 11–15，来源：lazyportfolioetf.com 实际回测 ──
  {
    id: 11,
    name: "Bogleheads 三基金",
    nameEn: "Three-Fund Portfolio",
    author: "John Bogle / Bogleheads",
    description: "先锋基金创始人 Bogle 的终极哲学：一只美国股票 + 一只国际股票 + 一只债券，覆盖全球市场，极低费率。",
    longDescription: [
      "Bogleheads 三基金组合是约翰·博格尔（先锋集团创始人）低成本指数投资哲学的最纯粹体现。博格尔毕生推崇一个简单的真理：市场本身就是最聪明的投资者，大多数主动管理只是在消耗费用和产生噪音。三基金组合用最少的工具实现最大的覆盖：美国股票指数（VTI）+ 国际股票指数（VXUS）+ 债券指数（BND）。",
      "如今 Bogleheads 社区（博格尔迷社区）拥有数十万名来自全球的个人投资者，三基金组合是这个社区最受推崇的投资方式。典型的分配建议是根据投资者年龄调整债券比例（如：年龄=债券占比），本次回测采用 50% VTI + 30% VXUS + 20% BND 的中等股债比例。",
      "2017—2025 年化收益 10.47%，在本站 15 个组合中位居第二（仅次于巴菲特90/10），最大回撤 -23.18%，夏普比率 0.70。高达 80% 的全球股权配置带来了较好的长期收益，尤其 2025 年表现亮眼达 +19.67%。对于认同指数化投资、希望低成本实现全球分散的投资者，三基金是目前已知的最简洁且高效的方案之一。",
    ],
    color: "#1d4ed8",
    cagr: 10.47, maxDrawdown: -23.18, sharpe: 0.70, sortino: 0.92, volatility: 12.24,
    beta: 0.72, alpha: 1.00, r2: 90.0,
    allocs: [["VTI",50],["VXUS",30],["BND",20]],
    allocLabels: { VTI:"美国股票", VXUS:"国际股票", BND:"美国债券" },
    returns: [19.54,-6.89,23.65,15.39,14.95,-17.06,18.86,13.85,19.67],
  },
  {
    id: 12,
    name: "黄金蝴蝶",
    nameEn: "Golden Butterfly",
    author: "Tyler (Portfolio Charts)",
    description: "在永久组合基础上引入小盘价值股，五类资产等权。近百年验证最大回撤仅 -17.79%，攻守兼备。",
    longDescription: [
      "黄金蝴蝶由独立研究者 Tyler 在 Portfolio Charts 网站提出，灵感来源于哈里·布朗的永久组合，但用小盘价值股（VBR）替换了一部分大盘股，以捕捉历史上有据可查的小盘价值溢价（Fama-French 三因子模型）。组合名称象征着在攻防之间取得完美平衡——如蝴蝶般优雅。",
      "五类资产各占 20%：VTI 美国大盘股（增长引擎）、VBR 小盘价值股（超额收益来源）、TLT 长期国债（通缩对冲）、SHY 短期国债（衰退防御和流动性）、GLD 黄金（通胀对冲）。小盘价值与黄金的组合使该组合在股票长期牛市和黑天鹅冲击两种情景下均能有所作为。",
      "2017—2025 年化收益 8.05%，最大回撤仅 -17.79%，是本站最小回撤组合之一，夏普比率 0.67，风险调整后收益在所有组合中名列前茅。2025 年因黄金大涨贡献了 +19.30% 的优异收益。对于极其在意本金安全、希望「少亏才能长期持有」的投资者，黄金蝴蝶是值得深入研究的选项。",
    ],
    color: "#b45309",
    cagr: 8.05, maxDrawdown: -17.79, sharpe: 0.67, sortino: 0.91, volatility: 8.83,
    beta: 0.30, alpha: 2.00, r2: 40.0,
    allocs: [["VTI",20],["VBR",20],["TLT",20],["SHY",20],["GLD",20]],
    allocLabels: { VTI:"美国大盘", VBR:"小盘价值", TLT:"长期国债", SHY:"短期国债", GLD:"黄金" },
    returns: [10.96,-4.03,18.03,13.93,9.35,-13.35,11.98,10.73,19.30],
  },
  {
    id: 13,
    name: "全球市场组合",
    nameEn: "Global Market Portfolio",
    author: "Credit Suisse / 市值加权理论",
    description: "按全球资产市值比例配置股票、债券、房地产，不做主观判断，最大程度代表全球财富分布。",
    longDescription: [
      "全球市场组合（GMP）的理论基础来自现代投资组合理论（MPT）的一个重要推论：在有效市场中，所有投资者共同持有的资产组合，即为最优切点组合。换言之，如果把全球所有可投资资产的市值加总，并按比例持有，就理论上获得了与全球所有投资者平均相同的风险收益。Credit Suisse Global Investment Returns Yearbook 等机构定期发布全球资产市值分布数据，为这类组合提供理论依据。",
      "本组合近似全球市值分布：30% VTI 美国股票（美国占全球股市约55%，但考虑美国债券和房地产后整体占比下调）、25% VXUS 国际股票、25% BND 全球债券（债券占全球可投资资产约50%）、10% VNQ 全球房地产信托、10% GLD 实物资产/黄金（作为商品类别代理）。各类资产权重大致反映其在全球财富中的比例。",
      "2017—2025 年化收益 6.07%，最大回撤 -23.10%，夏普比率 0.42，在所有组合中收益偏低。这与理论预期一致：持有市场组合的代价是「市场平均」的收益，既不会大幅跑赢也不会大幅落后。适合信奉市场有效性、拒绝任何主观判断的纯粹被动投资者。",
    ],
    color: "#0e7490",
    cagr: 6.07, maxDrawdown: -23.10, sharpe: 0.42, sortino: 0.56, volatility: 9.29,
    beta: 0.55, alpha: 0.00, r2: 80.0,
    allocs: [["VTI",30],["VXUS",25],["BND",25],["VNQ",10],["GLD",10]],
    allocLabels: { VTI:"美国股票", VXUS:"国际股票", BND:"全球债券", VNQ:"房地产", GLD:"实物资产" },
    returns: [13.93,-4.76,19.24,12.06,7.49,-19.25,12.57,5.96,13.23],
  },
  {
    id: 14,
    name: "塔木德四分法",
    nameEn: "Talmud Portfolio",
    author: "Roger Gibson / 《塔木德》古训",
    description: "源自2000年前的犹太智慧，四类资产各25%：美股、国际股、债券、房地产。分散效果极佳。",
    longDescription: [
      "《塔木德》是犹太教最重要的经典之一，其中包含一段流传2000多年的理财智慧：「一个人应当将其资产三等分：三分之一用于土地，三分之一用于商业，三分之一留存在手」——大致对应现代的房地产、股票和现金。资产配置先驱 Roger Gibson 在《资产配置》一书中将这一古老哲学更新为四类资产各25%的现代版本，以 REITs 代表土地，分别配置美国股票和国际股票，并加入债券取代现金。",
      "具体配置：VTI（美国股票 25%）+ VXUS（国际股票 25%）+ BND（债券 25%）+ VNQ（REITs 25%）。REITs 的高权重（25%）是本组合与众不同之处，房地产信托历史上提供了股债之间的独特风险溢价，且与股票相关性低于1，在长期中增强了分散化效果。",
      "2017—2025 年化收益 7.27%，最大回撤 -22.88%，夏普比率 0.47。2021 年 VNQ 大涨 21.44% 显著提升了组合表现，而 2022 年 VNQ 下跌 -17.21% 则略显拖累。整体而言，组合在房地产周期顺风时受益明显，适合认可房地产作为长期配置资产的投资者。",
    ],
    color: "#6d28d9",
    cagr: 7.27, maxDrawdown: -22.88, sharpe: 0.47, sortino: 0.62, volatility: 11.50,
    beta: 0.55, alpha: 0.50, r2: 70.0,
    allocs: [["VTI",25],["VXUS",25],["BND",25],["VNQ",25]],
    allocLabels: { VTI:"美国股票", VXUS:"国际股票", BND:"债券", VNQ:"房地产" },
    returns: [9.90,-3.78,22.79,8.02,21.44,-19.62,14.42,10.00,9.14],
  },
  {
    id: 15,
    name: "Merriman 终极定投",
    nameEn: "Merriman Ultimate Buy & Hold",
    author: "Paul Merriman",
    description: "因子投资先驱 Merriman 的代表作：11类资产广泛覆盖全球，叠加价值和小盘因子，适合长期持有者。",
    longDescription: [
      "Paul Merriman 是因子投资（Factor Investing）领域的重要推广者，他的「终极买入持有」组合是其数十年研究成果的集大成之作：通过持有多达11类资产，将全球股权、不同规模公司、价值因子、房地产和债券全面覆盖，以期在长期中捕捉多维度的风险溢价。Merriman 的核心理论是：小盘股和价值股在学术研究中被反复证实存在长期超额收益（即 Fama-French 三因子溢价），应当有意超配。",
      "7只 ETF 构成的组合：VTI（美国大盘 18%）+ VBR（美国小盘价值 18%）= 36% 美国股权，内部显著超配了小盘价值；VXUS（国际大盘 16%）+ EFA（发达市场价值 16%）+ VWO（新兴市场 8%）= 40% 国际股权；VNQ（全球 REITs 12%）提供房地产因子；BND（债券 12%）作为最低限度防御。股票合计占 88%，整体风格非常进取。",
      "2017—2025 年化收益 9.03%，最大回撤 -27.54%（本站最高），年化波动率 15.42%（本站最高），夏普比率 0.52。高波动和深回撤是持有这个组合必须接受的代价。2021 年小盘股大涨（VBR +28.77%）推动组合大涨 +19.37%，2025 年再次录得 +22.62%。适合对因子投资理论有深入认识、投资期限超过20年、心理素质极强的进取型投资者。",
    ],
    color: "#047857",
    cagr: 9.03, maxDrawdown: -27.54, sharpe: 0.52, sortino: 0.67, volatility: 15.42,
    beta: 0.75, alpha: 0.50, r2: 78.0,
    allocs: [["VTI",18],["VBR",18],["VXUS",16],["EFA",16],["VWO",8],["VNQ",12],["BND",12]],
    allocLabels: { VTI:"美国大盘", VBR:"美国小盘价值", VXUS:"国际大盘", EFA:"发达市场价值", VWO:"新兴市场", VNQ:"全球REITs", BND:"债券" },
    returns: [21.78,-11.86,23.62,6.40,19.37,-15.37,15.12,8.12,22.62],
  },
];

// ─── Tooltips ─────────────────────────────────────────────────────────────────

function GrowthTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background:"#fff", border:"1px solid #e2e8f0", borderRadius:8, padding:"8px 12px", fontSize:13, boxShadow:"0 4px 12px rgba(0,0,0,0.1)" }}>
      <div style={{ fontWeight:600, color:"#1e293b", marginBottom:4 }}>{label}年</div>
      {payload.map((p,i) => (
        <div key={i} style={{ color: p.color || p.stroke }}>
          {p.name}: <strong>${p.value}</strong>
        </div>
      ))}
    </div>
  );
}

function BarTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const val = payload[0].value;
  return (
    <div style={{ background:"#fff", border:"1px solid #e2e8f0", borderRadius:8, padding:"8px 12px", fontSize:13, boxShadow:"0 4px 12px rgba(0,0,0,0.1)" }}>
      <div style={{ fontWeight:600, color:"#1e293b", marginBottom:4 }}>{label}年</div>
      <div style={{ color: val >= 0 ? "#16a34a" : "#dc2626" }}>
        回报率: <strong>{val > 0 ? "+" : ""}{val}%</strong>
      </div>
    </div>
  );
}

function PieTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0];
  return (
    <div style={{ background:"#fff", border:"1px solid #e2e8f0", borderRadius:8, padding:"8px 12px", fontSize:13, boxShadow:"0 4px 12px rgba(0,0,0,0.1)" }}>
      <div style={{ fontWeight:600, color:"#1e293b" }}>{d.name}</div>
      <div style={{ color:"#64748b" }}>{d.payload.label} · {d.value}%</div>
    </div>
  );
}

const PIE_COLORS = [
  "#6366f1","#f59e0b","#10b981","#3b82f6","#ef4444",
  "#a855f7","#06b6d4","#f97316","#84cc16","#0284c7","#e11d48",
];

// ─── Portfolio Card ────────────────────────────────────────────────────────────

function PortfolioCard({ portfolio, onClick }) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onClick={() => onClick(portfolio)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: "#fff", borderRadius: 16, overflow: "hidden",
        boxShadow: hovered ? "0 12px 40px rgba(0,0,0,0.13)" : "0 2px 12px rgba(0,0,0,0.07)",
        cursor: "pointer",
        transform: hovered ? "translateY(-3px)" : "translateY(0)",
        transition: "all 0.2s ease",
        border: `1px solid ${hovered ? portfolio.color + "40" : "#f1f5f9"}`,
        display: "flex", flexDirection: "column",
      }}
    >
      <div style={{ height: 4, background: portfolio.color }} />
      <div style={{ padding: "20px 20px 16px" }}>
        {/* Header */}
        <div style={{ display:"flex", alignItems:"flex-start", gap:10, marginBottom:10 }}>
          <div style={{
            minWidth:28, height:28, borderRadius:"50%",
            background: portfolio.color + "18", color: portfolio.color,
            fontSize:11, fontWeight:700,
            display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0,
          }}>
            {portfolio.id}
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:15, fontWeight:700, color:"#1e293b", lineHeight:1.3 }}>{portfolio.name}</div>
            <div style={{ fontSize:11, color:"#94a3b8", marginTop:2 }}>{portfolio.nameEn}</div>
          </div>
        </div>

        {/* Author badge */}
        <div style={{
          display:"inline-flex", alignItems:"center", gap:4,
          background:"#f8fafc", borderRadius:6, padding:"3px 8px",
          fontSize:11, color:"#64748b", marginBottom:12,
        }}>
          <span style={{ color:"#94a3b8" }}>by</span>
          <span style={{ fontWeight:600 }}>{portfolio.author}</span>
        </div>

        {/* Description */}
        <div style={{
          fontSize:12, color:"#64748b", lineHeight:1.6, marginBottom:14,
          display:"-webkit-box", WebkitLineClamp:2,
          WebkitBoxOrient:"vertical", overflow:"hidden",
        }}>
          {portfolio.description}
        </div>

        {/* Metrics */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, marginBottom:14 }}>
          {[
            { label:"年化收益", value:`${portfolio.cagr}%`, color:"#16a34a" },
            { label:"最大回撤", value:`${portfolio.maxDrawdown}%`, color:"#dc2626" },
            { label:"夏普比率", value:portfolio.sharpe, color:"#0284c7" },
          ].map((m) => (
            <div key={m.label} style={{ background:"#f8fafc", borderRadius:8, padding:"8px 6px", textAlign:"center" }}>
              <div style={{ fontSize:13, fontWeight:700, color:m.color }}>{m.value}</div>
              <div style={{ fontSize:10, color:"#94a3b8", marginTop:2 }}>{m.label}</div>
            </div>
          ))}
        </div>

        {/* Allocation pills */}
        <div style={{ display:"flex", flexWrap:"wrap", gap:5, marginBottom:16 }}>
          {portfolio.allocs.map(([ticker, weight]) => (
            <div key={ticker} style={{
              display:"inline-flex", alignItems:"center", gap:3,
              background: portfolio.color + "10",
              border: `1px solid ${portfolio.color}30`,
              borderRadius:20, padding:"2px 8px", fontSize:11,
            }}>
              <span style={{ fontWeight:700, color:portfolio.color }}>{ticker}</span>
              <span style={{ color:"#94a3b8" }}>{weight}%</span>
            </div>
          ))}
        </div>
      </div>

      {/* CTA button */}
      <div style={{ padding:"0 20px 20px", marginTop:"auto" }}>
        <button style={{
          width:"100%", padding:"9px 0",
          background: hovered ? portfolio.color : portfolio.color + "12",
          color: hovered ? "#fff" : portfolio.color,
          border: `1.5px solid ${portfolio.color}40`,
          borderRadius:8, fontSize:13, fontWeight:600,
          cursor:"pointer", transition:"all 0.2s",
        }}>
          查看完整分析 →
        </button>
      </div>
    </div>
  );
}

// ─── Growth Comparison Chart ─────────────────────────────────────────────────

function GrowthComparisonChart({ portfolios, onSelect }) {
  const [selected, setSelected] = useState(() => new Set(portfolios.map(p => p.id)));

  const chartData = useMemo(() => {
    return YEARS.map((yr, i) => {
      const row = { year: yr };
      portfolios.forEach(p => {
        if (selected.has(p.id)) {
          let v = 100;
          for (let j = 0; j <= i; j++) v = v * (1 + p.returns[j] / 100);
          row[p.id] = Math.round(v * 10) / 10;
        }
      });
      return row;
    });
  }, [portfolios, selected]);

  const toggleAll = () => {
    if (selected.size === portfolios.length) setSelected(new Set());
    else setSelected(new Set(portfolios.map(p => p.id)));
  };

  const toggleOne = (id) => {
    setSelected(prev => {
      const s = new Set(prev);
      if (s.has(id)) { if (s.size > 1) s.delete(id); }
      else s.add(id);
      return s;
    });
  };

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    const sorted = [...payload].sort((a, b) => b.value - a.value);
    return (
      <div style={{ background:"#fff", border:"1px solid #e2e8f0", borderRadius:10, padding:"10px 14px", fontSize:12, boxShadow:"0 4px 20px rgba(0,0,0,0.12)", maxWidth:220 }}>
        <div style={{ fontWeight:700, color:"#1e293b", marginBottom:6 }}>{label}年末</div>
        {sorted.slice(0,8).map((p, i) => {
          const port = portfolios.find(x => x.id === Number(p.dataKey));
          return (
            <div key={i} style={{ display:"flex", alignItems:"center", gap:6, marginBottom:3 }}>
              <div style={{ width:6, height:6, borderRadius:"50%", background:p.color, flexShrink:0 }} />
              <span style={{ color:"#64748b", flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{port?.name}</span>
              <span style={{ fontWeight:700, color:"#1e293b" }}>${p.value}</span>
            </div>
          );
        })}
        {sorted.length > 8 && <div style={{ color:"#94a3b8", marginTop:4 }}>+{sorted.length-8} 更多...</div>}
      </div>
    );
  };

  return (
    <div style={{ background:"#fff", borderRadius:16, padding:"28px 32px", border:"1px solid #f1f5f9", boxShadow:"0 1px 8px rgba(0,0,0,0.04)" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:20, flexWrap:"wrap", gap:12 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ width:4, height:24, borderRadius:2, background:"linear-gradient(180deg,#1a56db,#7c3aed)" }} />
          <h2 style={{ margin:0, fontSize:17, fontWeight:700, color:"#1e293b" }}>组合增长曲线对比</h2>
          <span style={{ fontSize:12, color:"#94a3b8" }}>初始 $100，年度再平衡</span>
        </div>
        <button onClick={toggleAll} style={{
          background:"#f8fafc", border:"1px solid #e2e8f0", borderRadius:8,
          padding:"5px 12px", fontSize:12, color:"#64748b", cursor:"pointer",
        }}>
          {selected.size === portfolios.length ? "全部取消" : "全部选中"}
        </button>
      </div>

      {/* Toggle buttons */}
      <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:20 }}>
        {portfolios.map(p => (
          <button key={p.id} onClick={() => toggleOne(p.id)} style={{
            display:"inline-flex", alignItems:"center", gap:5,
            background: selected.has(p.id) ? p.color + "15" : "#f8fafc",
            border: `1.5px solid ${selected.has(p.id) ? p.color + "60" : "#e2e8f0"}`,
            borderRadius:20, padding:"4px 10px", fontSize:11, fontWeight:600,
            color: selected.has(p.id) ? p.color : "#94a3b8",
            cursor:"pointer", transition:"all 0.15s",
          }}>
            <div style={{ width:6, height:6, borderRadius:"50%", background: selected.has(p.id) ? p.color : "#d1d5db", flexShrink:0 }} />
            {p.name}
          </button>
        ))}
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={360}>
        <LineChart data={chartData} margin={{ top:8, right:16, bottom:0, left:-4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="year" tick={{ fontSize:12, fill:"#94a3b8" }} />
          <YAxis tick={{ fontSize:12, fill:"#94a3b8" }} tickFormatter={v => `$${v}`} />
          <Tooltip content={<CustomTooltip />} />
          {portfolios.filter(p => selected.has(p.id)).map(p => (
            <Line key={p.id} type="monotone" dataKey={p.id}
              stroke={p.color} strokeWidth={2} dot={false}
              strokeOpacity={0.85}
              activeDot={{ r:4, fill:p.color }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>

      <div style={{ marginTop:12, fontSize:11, color:"#94a3b8", textAlign:"center" }}>
        点击卡片或表格行查看单一组合详情 · 点击上方标签切换显示/隐藏
      </div>
    </div>
  );
}

// ─── Site Footer ─────────────────────────────────────────────────────────────

function SiteFooter({ isMobile }) {
  return (
    <footer style={{ background:"#fff", borderTop:"1px solid #f1f5f9", position:"relative", zIndex:1 }}>
      <div style={{ maxWidth:1440, margin:"0 auto", padding: isMobile ? "32px 16px 24px" : "48px 40px 40px", display:"grid", gridTemplateColumns: isMobile ? "1fr" : "1fr auto auto", gap: isMobile ? "32px" : "60px 80px" }}>
        <div style={{ maxWidth:340 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:16 }}>
            <div style={{ width:32, height:32, borderRadius:8, background:"linear-gradient(135deg,#2563eb,#5856d6)", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:900, fontSize:14, color:"#fff" }}>W</div>
            <span style={{ fontSize:19, fontWeight:800, letterSpacing:-0.5, color:"#1e293b" }}>Wise<span style={{ color:"#2563eb" }}>ETF</span></span>
          </div>
          <p style={{ fontSize:14, color:"#64748b", lineHeight:1.85, marginBottom:10 }}>
            中国投资者的美股ETF与QDII基金追踪平台，覆盖纳斯达克100、标普500被动指数及主动型QDII基金，提供费率对比、溢价监控与申购状态追踪。
          </p>
          <p style={{ fontSize:12, color:"#94a3b8" }}>wise-etf.com</p>
        </div>

        <div style={{ minWidth:120 }}>
          <div style={{ fontSize:15, fontWeight:700, color:"#1e293b", marginBottom:20 }}>快速导航</div>
          <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
            {[
              { label:"首页", href:"/" },
              { label:"懒人组合", href:"/lazy" },
              { label:"导出报告", href:"/export" },
            ].map(l => (
              <a key={l.href} href={l.href} style={{ fontSize:14, color:"#64748b", textDecoration:"none" }}>{l.label}</a>
            ))}
          </div>
        </div>

        <div style={{ minWidth:160 }}>
          <div style={{ fontSize:15, fontWeight:700, color:"#1e293b", marginBottom:20 }}>其他</div>
          <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
            {[
              { label:"投资主站",    href:"https://www.wise-invest.org",  icon:"🌐" },
              { label:"Wise-Witness",href:"https://www.wise-witness.com", icon:"🏦" },
              { label:"Wise-Hold",   href:"https://www.wise-hold.com",    icon:"📈" },
              { label:"Wise-SIM",    href:"https://www.wise-sim.org",     icon:"📱" },
            ].map(l => (
              <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer"
                style={{ fontSize:14, color:"#64748b", textDecoration:"none", display:"flex", alignItems:"center", gap:8 }}>
                {l.icon} {l.label}
              </a>
            ))}
          </div>
        </div>
      </div>

      <div style={{ borderTop:"1px solid #f1f5f9" }} />
      <div style={{ maxWidth:1440, margin:"0 auto", padding: isMobile ? "14px 16px" : "18px 40px", display:"flex", flexDirection:"column", alignItems:"center", gap:5 }}>
        <div style={{ fontSize:12, color:"#94a3b8" }}>© 2026 wise-etf.com · All rights reserved</div>
        <div style={{ fontSize:12, color:"#94a3b8" }}>仅提供信息参考，不构成任何投资建议</div>
      </div>
    </footer>
  );
}

// ─── Comparison Table ──────────────────────────────────────────────────────────

function ComparisonTable({ portfolios, onSelect }) {
  const [sortKey, setSortKey] = useState("cagr");
  const [sortDir, setSortDir] = useState("desc");

  const sorted = useMemo(() => [...portfolios].sort((a, b) => {
    const va = a[sortKey], vb = b[sortKey];
    return sortDir === "desc" ? vb - va : va - vb;
  }), [portfolios, sortKey, sortDir]);

  const handleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === "desc" ? "asc" : "desc");
    else { setSortKey(key); setSortDir("desc"); }
  };

  const cols = [
    { key:"name", label:"组合名称", sortable:false },
    { key:"cagr", label:"年化收益", sortable:true },
    { key:"maxDrawdown", label:"最大回撤", sortable:true },
    { key:"sharpe", label:"夏普", sortable:true },
    { key:"sortino", label:"索提诺", sortable:true },
    { key:"volatility", label:"波动率", sortable:true },
  ];

  return (
    <div style={{ borderRadius:14, overflow:"hidden", border:"1px solid #e2e8f0" }}>
      <div style={{ overflowX:"auto" }}>
        <table style={{ width:"100%", borderCollapse:"collapse", minWidth:600 }}>
          <thead>
            <tr style={{ background:"linear-gradient(135deg,#1a56db,#7c3aed)" }}>
              {cols.map((col) => (
                <th key={col.key} onClick={col.sortable ? () => handleSort(col.key) : undefined}
                  style={{
                    padding:"12px 16px", textAlign: col.key==="name" ? "left" : "center",
                    fontSize:12, fontWeight:600, color:"#fff",
                    cursor: col.sortable ? "pointer" : "default",
                    userSelect:"none", whiteSpace:"nowrap",
                  }}
                >
                  {col.label}
                  {col.sortable && sortKey===col.key && (
                    <span style={{ marginLeft:4, opacity:0.8 }}>{sortDir==="desc" ? "↓" : "↑"}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((p, i) => (
              <tr key={p.id} onClick={() => onSelect(p)}
                style={{ background: i%2===0 ? "#fff" : "#fafbfc", cursor:"pointer", transition:"background 0.15s" }}
                onMouseEnter={(e) => e.currentTarget.style.background="#f0f4ff"}
                onMouseLeave={(e) => e.currentTarget.style.background= i%2===0 ? "#fff" : "#fafbfc"}
              >
                <td style={{ padding:"11px 16px" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <div style={{ width:8, height:8, borderRadius:"50%", background:p.color, flexShrink:0 }} />
                    <div>
                      <div style={{ fontSize:13, fontWeight:600, color:"#1e293b" }}>{p.name}</div>
                      <div style={{ fontSize:11, color:"#94a3b8" }}>{p.author}</div>
                    </div>
                  </div>
                </td>
                <td style={{ padding:"11px 16px", textAlign:"center" }}>
                  <span style={{ fontSize:13, fontWeight:700, color:"#16a34a" }}>{p.cagr}%</span>
                </td>
                <td style={{ padding:"11px 16px", textAlign:"center" }}>
                  <span style={{ fontSize:13, fontWeight:700, color:"#dc2626" }}>{p.maxDrawdown}%</span>
                </td>
                <td style={{ padding:"11px 16px", textAlign:"center" }}>
                  <span style={{ fontSize:13, fontWeight:600, color:"#0284c7" }}>{p.sharpe}</span>
                </td>
                <td style={{ padding:"11px 16px", textAlign:"center" }}>
                  <span style={{ fontSize:13, fontWeight:600, color:"#7c3aed" }}>{p.sortino}</span>
                </td>
                <td style={{ padding:"11px 16px", textAlign:"center" }}>
                  <span style={{ fontSize:13, fontWeight:600, color:"#f59e0b" }}>{p.volatility}%</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Mini sparklines for header ───────────────────────────────────────────────

function MiniSparklines({ portfolios }) {
  const featured = [portfolios[8], portfolios[2], portfolios[1]];
  const allData = useMemo(() => featured.map(p => ({
    color: p.color, name: p.name,
    data: calcGrowth(p.returns),
  })), []);

  const chartData = YEARS.map((yr, i) => {
    const row = { year: yr };
    allData.forEach(p => { row[p.name] = p.data[i].value; });
    return row;
  });

  return (
    <ResponsiveContainer width="100%" height={80}>
      <LineChart data={chartData} margin={{ top:4, right:0, bottom:0, left:0 }}>
        {allData.map(p => (
          <Line key={p.name} type="monotone" dataKey={p.name}
            stroke={p.color} strokeWidth={1.8} dot={false} strokeOpacity={0.8} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

// ─── Portfolio Detail Page ────────────────────────────────────────────────────

function PortfolioDetailPage({ portfolio, onBack, isMobile }) {
  const growthData = useMemo(() => calcGrowth(portfolio.returns), [portfolio]);
  const barData = YEARS.map((yr, i) => ({ year: yr, return: portfolio.returns[i] }));
  const pieData = portfolio.allocs.map(([ticker, weight]) => ({
    name: ticker, label: portfolio.allocLabels[ticker] || ticker, value: weight,
  }));

  const finalValue = growthData[growthData.length - 1].value;
  const bestYear = Math.max(...portfolio.returns);
  const worstYear = Math.min(...portfolio.returns);
  const positiveYears = portfolio.returns.filter(r => r > 0).length;

  return (
    <div style={{ background:"#f8fafc", minHeight:"100vh" }}>

      {/* ── Hero banner ── */}
      <div style={{
        background: `linear-gradient(135deg, ${portfolio.color}, ${portfolio.color}cc)`,
        color: "#fff", position:"relative", overflow:"hidden",
      }}>
        {/* Decorative background circles */}
        <div style={{ position:"absolute", width:500, height:500, borderRadius:"50%", background:"rgba(255,255,255,0.04)", top:-150, right:-100, pointerEvents:"none" }} />
        <div style={{ position:"absolute", width:300, height:300, borderRadius:"50%", background:"rgba(255,255,255,0.05)", bottom:-80, left:80, pointerEvents:"none" }} />

        <div style={{ maxWidth:1440, margin:"0 auto", padding: isMobile ? "20px 16px 32px" : "28px 40px 40px", position:"relative" }}>

          {/* Back button */}
          <button onClick={onBack} style={{
            display:"inline-flex", alignItems:"center", gap:6,
            background:"rgba(255,255,255,0.15)", border:"1px solid rgba(255,255,255,0.25)",
            color:"#fff", borderRadius:8, padding:"7px 14px",
            fontSize:13, fontWeight:600, cursor:"pointer",
            marginBottom:24, backdropFilter:"blur(4px)",
          }}>
            ← 返回懒人组合
          </button>

          {/* Title row */}
          <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:24, flexWrap:"wrap" }}>
            <div style={{ flex:1, minWidth:280 }}>
              <div style={{
                display:"inline-flex", alignItems:"center", gap:6,
                background:"rgba(255,255,255,0.15)", borderRadius:20,
                padding:"4px 12px", fontSize:11, fontWeight:600,
                letterSpacing:"0.06em", marginBottom:10,
              }}>
                LAZY PORTFOLIO #{portfolio.id}
              </div>
              <h1 style={{ fontSize: isMobile ? 26 : 36, fontWeight:800, margin:"0 0 6px", letterSpacing:"-0.02em" }}>
                {portfolio.name}
              </h1>
              <div style={{ fontSize: isMobile ? 13 : 16, color:"rgba(255,255,255,0.92)", marginBottom:6 }}>
                {portfolio.nameEn}
              </div>
              <div style={{ fontSize:13, color:"rgba(255,255,255,0.82)" }}>by {portfolio.author}</div>
            </div>

            {/* Quick stats */}
            {!isMobile && (
              <div style={{
                display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:2,
                background:"#fff", borderRadius:14,
                overflow:"hidden",
                boxShadow:"0 8px 32px rgba(0,0,0,0.18)",
              }}>
                {[
                  { label:"年化收益 CAGR", value:`${portfolio.cagr}%`, sub:"2017—2025", color:"#16a34a" },
                  { label:"最大回撤", value:`${portfolio.maxDrawdown}%`, sub:"历史最差", color:"#dc2626" },
                  { label:"夏普比率", value:portfolio.sharpe, sub:"风险调整收益", color:"#0284c7" },
                  { label:"$100 累计增长", value:`$${finalValue}`, sub:"9年终值", color:"#7c3aed" },
                ].map((s, i, arr) => (
                  <div key={s.label} style={{
                    textAlign:"center", padding:"16px 12px",
                    borderRight: i < arr.length-1 ? "1px solid #f1f5f9" : "none",
                    background:"#fff",
                  }}>
                    <div style={{ fontSize:22, fontWeight:800, lineHeight:1, color:s.color }}>{s.value}</div>
                    <div style={{ fontSize:10, color:"#64748b", marginTop:5, lineHeight:1.4, fontWeight:500 }}>{s.label}</div>
                    <div style={{ fontSize:10, color:"#94a3b8", marginTop:2 }}>{s.sub}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Mobile quick stats */}
          {isMobile && (
            <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:8, marginTop:20 }}>
              {[
                { label:"年化收益", value:`${portfolio.cagr}%`, color:"#16a34a" },
                { label:"最大回撤", value:`${portfolio.maxDrawdown}%`, color:"#dc2626" },
                { label:"夏普比率", value:portfolio.sharpe, color:"#0284c7" },
                { label:"$100→", value:`$${finalValue}`, color:"#7c3aed" },
              ].map(s => (
                <div key={s.label} style={{ background:"#fff", borderRadius:10, padding:"12px", textAlign:"center", boxShadow:"0 2px 8px rgba(0,0,0,0.12)" }}>
                  <div style={{ fontSize:20, fontWeight:800, color:s.color }}>{s.value}</div>
                  <div style={{ fontSize:11, color:"#64748b", marginTop:3 }}>{s.label}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Metrics strip ── */}
      <div style={{ background:"#fff", borderBottom:"1px solid #f1f5f9" }}>
        <div style={{ maxWidth:1440, margin:"0 auto", padding: isMobile ? "16px" : "18px 40px" }}>
          <div style={{ display:"grid", gridTemplateColumns: isMobile ? "repeat(3,1fr)" : "repeat(7,1fr)", gap:12 }}>
            {[
              { label:"年化收益", value:`${portfolio.cagr}%`, color:"#16a34a" },
              { label:"最大回撤", value:`${portfolio.maxDrawdown}%`, color:"#dc2626" },
              { label:"夏普比率", value:portfolio.sharpe, color:"#0284c7" },
              { label:"索提诺比率", value:portfolio.sortino, color:"#7c3aed" },
              { label:"年化波动率", value:`${portfolio.volatility}%`, color:"#f59e0b" },
              { label:"最佳年份", value:`+${bestYear.toFixed(1)}%`, color:"#059669" },
              { label:"最差年份", value:`${worstYear.toFixed(1)}%`, color:"#dc2626" },
            ].map(m => (
              <div key={m.label} style={{ textAlign:"center", padding:"10px 8px", background:"#f8fafc", borderRadius:10, border:"1px solid #f1f5f9" }}>
                <div style={{ fontSize:16, fontWeight:700, color:m.color }}>{m.value}</div>
                <div style={{ fontSize:10, color:"#94a3b8", marginTop:3, lineHeight:1.4 }}>{m.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Main content ── */}
      <div style={{ maxWidth:1440, margin:"0 auto", padding: isMobile ? "24px 16px 48px" : "36px 40px 64px" }}>

        {/* Row 1: Description + Allocation */}
        <div style={{
          display:"grid",
          gridTemplateColumns: isMobile ? "1fr" : "1fr 400px",
          gap:28, marginBottom:32,
        }}>
          {/* Description */}
          <div style={{ background:"#fff", borderRadius:16, padding: isMobile ? "20px" : "28px 32px", border:"1px solid #f1f5f9", boxShadow:"0 1px 8px rgba(0,0,0,0.04)" }}>
            <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:20 }}>
              <div style={{ width:4, height:24, borderRadius:2, background:portfolio.color }} />
              <h2 style={{ margin:0, fontSize:17, fontWeight:700, color:"#1e293b" }}>策略详解</h2>
            </div>
            {portfolio.longDescription.map((para, i) => (
              <p key={i} style={{ fontSize:14, color:"#475569", lineHeight:1.85, margin: i === portfolio.longDescription.length-1 ? 0 : "0 0 16px" }}>
                {para}
              </p>
            ))}

            {/* Stat badges at bottom */}
            <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginTop:20, paddingTop:20, borderTop:"1px solid #f1f5f9" }}>
              {[
                { icon:"📅", text:`回测区间：2017—2025` },
                { icon:"💵", text:`美元口径，年度再平衡` },
                { icon:"✅", text:`正收益年份：${positiveYears}/9` },
              ].map(b => (
                <div key={b.text} style={{
                  display:"inline-flex", alignItems:"center", gap:5,
                  background:"#f8fafc", borderRadius:20, padding:"5px 12px",
                  fontSize:12, color:"#64748b", border:"1px solid #e2e8f0",
                }}>
                  {b.icon} {b.text}
                </div>
              ))}
            </div>
          </div>

          {/* Allocation pie + table */}
          <div style={{ background:"#fff", borderRadius:16, padding: isMobile ? "20px" : "28px 24px", border:"1px solid #f1f5f9", boxShadow:"0 1px 8px rgba(0,0,0,0.04)" }}>
            <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:20 }}>
              <div style={{ width:4, height:24, borderRadius:2, background:portfolio.color }} />
              <h2 style={{ margin:0, fontSize:17, fontWeight:700, color:"#1e293b" }}>资产配置</h2>
            </div>

            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" outerRadius={88} innerRadius={40}
                  dataKey="value" paddingAngle={2}>
                  {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip content={<PieTooltip />} />
              </PieChart>
            </ResponsiveContainer>

            <div style={{ marginTop:16 }}>
              {portfolio.allocs.map(([ticker, weight], i) => (
                <div key={ticker} style={{
                  display:"flex", alignItems:"center", gap:10,
                  padding:"8px 0",
                  borderBottom: i < portfolio.allocs.length-1 ? "1px solid #f8fafc" : "none",
                }}>
                  <div style={{ width:10, height:10, borderRadius:"50%", background:PIE_COLORS[i % PIE_COLORS.length], flexShrink:0 }} />
                  <div style={{
                    display:"inline-block",
                    background: portfolio.color + "15", color:portfolio.color,
                    fontWeight:700, fontSize:12, padding:"1px 7px", borderRadius:5,
                  }}>{ticker}</div>
                  <span style={{ fontSize:12, color:"#64748b", flex:1 }}>{portfolio.allocLabels[ticker] || "-"}</span>
                  <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                    <div style={{
                      height:5, borderRadius:3,
                      width: `${weight * 1.8}px`, minWidth:4,
                      background: PIE_COLORS[i % PIE_COLORS.length],
                    }} />
                    <span style={{ fontSize:13, fontWeight:700, color:"#1e293b", minWidth:36, textAlign:"right" }}>{weight}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Row 2: Cumulative growth chart */}
        <div style={{ background:"#fff", borderRadius:16, padding: isMobile ? "20px" : "28px 32px", border:"1px solid #f1f5f9", boxShadow:"0 1px 8px rgba(0,0,0,0.04)", marginBottom:28 }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:24, flexWrap:"wrap", gap:12 }}>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <div style={{ width:4, height:24, borderRadius:2, background:portfolio.color }} />
              <h2 style={{ margin:0, fontSize:17, fontWeight:700, color:"#1e293b" }}>累计净值增长</h2>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <div style={{ width:14, height:3, borderRadius:2, background:portfolio.color }} />
              <span style={{ fontSize:12, color:"#64748b" }}>初始 $100 投入，每年再平衡，最终增长至 <strong style={{ color:portfolio.color }}>${finalValue}</strong></span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={growthData} margin={{ top:8, right:16, bottom:0, left:-8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="year" tick={{ fontSize:12, fill:"#94a3b8" }} />
              <YAxis tick={{ fontSize:12, fill:"#94a3b8" }} tickFormatter={v => `$${v}`} />
              <Tooltip content={<GrowthTooltip />} />
              <Line type="monotone" dataKey="value" name="净值"
                stroke={portfolio.color} strokeWidth={3}
                dot={{ r:4, fill:portfolio.color, strokeWidth:0 }}
                activeDot={{ r:6, fill:portfolio.color }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Row 3: Annual returns bar chart */}
        <div style={{ background:"#fff", borderRadius:16, padding: isMobile ? "20px" : "28px 32px", border:"1px solid #f1f5f9", boxShadow:"0 1px 8px rgba(0,0,0,0.04)", marginBottom:28 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:24 }}>
            <div style={{ width:4, height:24, borderRadius:2, background:portfolio.color }} />
            <h2 style={{ margin:0, fontSize:17, fontWeight:700, color:"#1e293b" }}>历年年度收益率</h2>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={barData} margin={{ top:8, right:16, bottom:0, left:-8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="year" tick={{ fontSize:12, fill:"#94a3b8" }} />
              <YAxis tick={{ fontSize:12, fill:"#94a3b8" }} tickFormatter={v => `${v}%`} />
              <Tooltip content={<BarTooltip />} />
              <ReferenceLine y={0} stroke="#e2e8f0" strokeWidth={1.5} />
              <Bar dataKey="return" name="年度收益率" radius={[4,4,0,0]}>
                {barData.map((entry, i) => (
                  <Cell key={i} fill={entry.return >= 0 ? "#22c55e" : "#ef4444"} fillOpacity={0.85} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Row 4: Year-by-year table */}
        <div style={{ background:"#fff", borderRadius:16, padding: isMobile ? "20px" : "28px 32px", border:"1px solid #f1f5f9", boxShadow:"0 1px 8px rgba(0,0,0,0.04)", marginBottom:28 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:20 }}>
            <div style={{ width:4, height:24, borderRadius:2, background:portfolio.color }} />
            <h2 style={{ margin:0, fontSize:17, fontWeight:700, color:"#1e293b" }}>逐年回报明细</h2>
          </div>
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", minWidth:500 }}>
              <thead>
                <tr style={{ background:"#f8fafc" }}>
                  {["年份","年度收益率","累计净值","较上年变化"].map(h => (
                    <th key={h} style={{ padding:"10px 16px", textAlign: h==="年份" ? "left":"center", fontSize:12, fontWeight:600, color:"#64748b", borderBottom:"2px solid #f1f5f9" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {YEARS.map((yr, i) => {
                  const ret = portfolio.returns[i];
                  const nav = growthData[i].value;
                  const prevNav = i === 0 ? 100 : growthData[i-1].value;
                  const diff = nav - prevNav;
                  return (
                    <tr key={yr} style={{ background: i%2===0 ? "#fff" : "#fafbfc" }}>
                      <td style={{ padding:"10px 16px", fontSize:13, fontWeight:600, color:"#1e293b" }}>{yr}</td>
                      <td style={{ padding:"10px 16px", textAlign:"center" }}>
                        <span style={{
                          display:"inline-block",
                          background: ret >= 0 ? "#dcfce7" : "#fee2e2",
                          color: ret >= 0 ? "#16a34a" : "#dc2626",
                          fontWeight:700, fontSize:13,
                          padding:"2px 10px", borderRadius:20,
                        }}>
                          {ret > 0 ? "+" : ""}{ret.toFixed(2)}%
                        </span>
                      </td>
                      <td style={{ padding:"10px 16px", textAlign:"center", fontSize:13, fontWeight:600, color:"#1e293b" }}>
                        ${nav.toFixed(1)}
                      </td>
                      <td style={{ padding:"10px 16px", textAlign:"center" }}>
                        <span style={{ fontSize:12, color: diff >= 0 ? "#16a34a" : "#dc2626", fontWeight:600 }}>
                          {diff >= 0 ? "+" : ""}{diff.toFixed(1)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Disclaimer */}
        <div style={{ fontSize:12, color:"#94a3b8", lineHeight:1.8, textAlign:"center", padding:"0 16px" }}>
          数据来源：Portfolio Visualizer / lazyportfolioetf.com · 回测区间：2017–2025 · 口径：美元 · 年度再平衡<br />
          以上内容仅供参考，不构成投资建议。历史回测数据不代表未来表现。
        </div>
      </div>

      <SiteFooter isMobile={isMobile} />

      <style>{`* { box-sizing:border-box; } ::-webkit-scrollbar{width:6px;height:6px} ::-webkit-scrollbar-track{background:#f1f5f9} ::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:3px} ::-webkit-scrollbar-thumb:hover{background:#94a3b8}`}</style>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function LazyPage() {
  document.title = "懒人组合 | Wise ETF";

  const [selectedPortfolio, setSelectedPortfolio] = useState(null);
  const isMobile = typeof window !== "undefined" && window.innerWidth <= 768;

  // Show detail page
  if (selectedPortfolio) {
    return (
      <PortfolioDetailPage
        portfolio={selectedPortfolio}
        onBack={() => setSelectedPortfolio(null)}
        isMobile={isMobile}
      />
    );
  }

  return (
    <div style={{ background:"#f8fafc", minHeight:"100vh", fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" }}>

      {/* ── Header ── */}
      <div style={{ background:"linear-gradient(135deg,#1a56db,#7c3aed)", color:"#fff", position:"relative", overflow:"hidden" }}>
        <div style={{ position:"absolute", width:320, height:320, borderRadius:"50%", background:"rgba(255,255,255,0.04)", top:-80, right:-60, pointerEvents:"none" }} />
        <div style={{ position:"absolute", width:180, height:180, borderRadius:"50%", background:"rgba(255,255,255,0.05)", bottom:-40, left:120, pointerEvents:"none" }} />

        <div style={{ maxWidth:1440, margin:"0 auto", padding: isMobile ? "20px 16px 24px" : "28px 40px 32px" }}>
          <a href="/" style={{ display:"inline-flex", alignItems:"center", gap:6, color:"rgba(255,255,255,0.75)", fontSize:13, textDecoration:"none", marginBottom:20, padding:"4px 0" }}>
            <span style={{ fontSize:16 }}>←</span> 返回首页
          </a>

          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:20 }}>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ display:"inline-flex", alignItems:"center", gap:6, background:"rgba(255,255,255,0.15)", borderRadius:20, padding:"4px 12px", fontSize:11, fontWeight:600, letterSpacing:"0.05em", marginBottom:12 }}>
                LAZY PORTFOLIO
              </div>
              <h1 style={{ fontSize: isMobile ? 24 : 32, fontWeight:800, margin:"0 0 10px", letterSpacing:"-0.02em" }}>
                懒人组合指南
              </h1>
              <p style={{ fontSize: isMobile ? 13 : 15, opacity:0.85, margin:"0 0 16px", lineHeight:1.7, maxWidth:600 }}>
                世界顶级投资大师的资产配置智慧结晶。买入并持有，无需择时，定期再平衡，让时间复利发挥力量。
              </p>
              <div style={{ display:"flex", flexWrap:"wrap", gap:10 }}>
                {[
                  { icon:"📊", text:"15 款经典组合" },
                  { icon:"📅", text:"2017–2025 回测" },
                  { icon:"💰", text:"美元口径" },
                  { icon:"🔄", text:"年度再平衡" },
                ].map((tag) => (
                  <div key={tag.text} style={{ display:"flex", alignItems:"center", gap:6, background:"rgba(255,255,255,0.12)", borderRadius:20, padding:"5px 12px", fontSize:12 }}>
                    {tag.icon} {tag.text}
                  </div>
                ))}
              </div>
            </div>

            {!isMobile && (
              <div style={{ width:240, flexShrink:0, background:"rgba(255,255,255,0.08)", borderRadius:12, padding:"12px 12px 6px" }}>
                <div style={{ fontSize:10, color:"rgba(255,255,255,0.6)", marginBottom:4, textAlign:"center" }}>
                  代表组合净值曲线（$100 起）
                </div>
                <MiniSparklines portfolios={PORTFOLIOS} />
                <div style={{ display:"flex", justifyContent:"center", gap:14, marginTop:6 }}>
                  {[
                    { color:PORTFOLIOS[8].color, label:"巴菲特" },
                    { color:PORTFOLIOS[2].color, label:"60/40" },
                    { color:PORTFOLIOS[1].color, label:"永久" },
                  ].map(l => (
                    <div key={l.label} style={{ display:"flex", alignItems:"center", gap:4, fontSize:10, color:"rgba(255,255,255,0.7)" }}>
                      <div style={{ width:12, height:2, borderRadius:1, background:l.color }} />
                      {l.label}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Concept strip ── */}
      <div style={{ background:"#fff", borderBottom:"1px solid #f1f5f9" }}>
        <div style={{ maxWidth:1440, margin:"0 auto", padding: isMobile ? "16px" : "18px 40px" }}>
          <div style={{ display:"grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4,1fr)", gap: isMobile ? 12 : 24 }}>
            {[
              { icon:"🧘", title:"被动持有", desc:"买入后无需频繁操作，降低交易成本和情绪干扰" },
              { icon:"🌍", title:"广泛分散", desc:"覆盖股票、债券、大宗商品等多类资产，降低单一风险" },
              { icon:"🔄", title:"定期再平衡", desc:"每年或每半年恢复目标权重，低买高卖自动执行" },
              { icon:"⏳", title:"长期复利", desc:"无需预测市场，让时间和复利完成增长使命" },
            ].map((item) => (
              <div key={item.title} style={{ display:"flex", gap:12, alignItems:"flex-start" }}>
                <span style={{ fontSize:22, lineHeight:1, flexShrink:0 }}>{item.icon}</span>
                <div>
                  <div style={{ fontSize:13, fontWeight:700, color:"#1e293b", marginBottom:3 }}>{item.title}</div>
                  <div style={{ fontSize:11, color:"#64748b", lineHeight:1.5 }}>{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Portfolio Grid ── */}
      <div style={{ maxWidth:1440, margin:"0 auto", padding: isMobile ? "24px 16px" : "36px 40px" }}>
        <div style={{ marginBottom:24 }}>
          <h2 style={{ fontSize: isMobile ? 18 : 22, fontWeight:700, color:"#1e293b", margin:"0 0 6px" }}>
            15 款经典懒人组合
          </h2>
          <p style={{ fontSize:13, color:"#64748b", margin:0 }}>
            点击任意卡片查看完整策略分析、回测图表和逐年收益数据
          </p>
        </div>

        <div style={{
          display:"grid",
          gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(340px, 1fr))",
          gap:22,
        }}>
          {PORTFOLIOS.map((portfolio) => (
            <PortfolioCard key={portfolio.id} portfolio={portfolio} onClick={setSelectedPortfolio} />
          ))}
        </div>
      </div>

      {/* ── Growth Comparison Chart ── */}
      <div style={{ maxWidth:1440, margin:"0 auto", padding: isMobile ? "0 16px 32px" : "0 40px 40px" }}>
        <GrowthComparisonChart portfolios={PORTFOLIOS} onSelect={setSelectedPortfolio} />
      </div>

      {/* ── Comparison Table ── */}
      <div style={{ maxWidth:1440, margin:"0 auto", padding: isMobile ? "0 16px 48px" : "0 40px 56px" }}>
        <div style={{ marginBottom:16 }}>
          <h2 style={{ fontSize: isMobile ? 18 : 22, fontWeight:700, color:"#1e293b", margin:"0 0 6px" }}>
            组合横向对比
          </h2>
          <p style={{ fontSize:13, color:"#64748b", margin:0 }}>
            点击表头排序，点击行查看完整详情
          </p>
        </div>
        <ComparisonTable portfolios={PORTFOLIOS} onSelect={setSelectedPortfolio} />
        <div style={{ marginTop:16, fontSize:11, color:"#94a3b8", lineHeight:1.6, textAlign:"center" }}>
          数据来源：Portfolio Visualizer · 回测区间：2017–2025 · 口径：美元 · 年度再平衡 · 仅供参考，不构成投资建议
        </div>
      </div>

      <SiteFooter isMobile={isMobile} />

      <style>{`* { box-sizing:border-box; } ::-webkit-scrollbar{width:6px;height:6px} ::-webkit-scrollbar-track{background:#f1f5f9} ::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:3px} ::-webkit-scrollbar-thumb:hover{background:#94a3b8}`}</style>
    </div>
  );
}
