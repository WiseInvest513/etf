export const NAV_GROUPS = [
  { key: "guide", label: "核心介绍", tab: "guide" },
  { key: "funds", label: "基金数据", children: [
    { id: "nasdaq", label: "纳指被动", description: "纳斯达克 100 场外基金" },
    { id: "sp500", label: "标普 500", description: "标普 500 场外基金" },
    { id: "etf", label: "场内 ETF", description: "行情、溢价与成交" },
    { id: "active", label: "美股主动", description: "主动型 QDII 产品" },
  ]},
  { key: "onchain", label: "链上美股", tab: "onchain", featured: true, badge: "新" },
  { key: "tools", label: "投资工具", children: [
    { id: "lazy", label: "懒人组合", description: "经典资产配置组合", href: "/lazy" },
    { id: "qdii", label: "QDII 估值", description: "盘中估值内部测试", href: "/qdii" },
    { id: "export", label: "导出数据", description: "生成数据快照", href: "/export" },
  ]},
];

export const FOOTER_NAV_ITEMS = [
  { id: "nasdaq", label: "纳指被动" }, { id: "sp500", label: "标普 500" },
  { id: "etf", label: "场内 ETF" }, { id: "active", label: "美股主动" },
  { id: "onchain", label: "链上美股" },
  { id: "lazy", label: "懒人组合", href: "/lazy" }, { id: "qdii", label: "估值", href: "/qdii" },
  { id: "export", label: "导出数据", href: "/export" },
];
