const api      = require('../../utils/api');
const FALLBACK = require('../../utils/fallback');
const app      = getApp();

const TABS = [
  { id: 'nasdaq', label: '纳指被动', cat: 'nasdaq_passive' },
  { id: 'sp500',  label: '标普500',  cat: 'sp500_passive'  },
  { id: 'etf',    label: '场内ETF',  cat: 'etfs'           },
  { id: 'active', label: '美股主动', cat: 'us_active'       },
];

// 排序选项（key_dir 格式）
const SORT_OPTS_FUND = [
  { val: 'ytd_return_desc', label: '近一年收益 高→低' },
  { val: 'ytd_return_asc',  label: '近一年收益 低→高' },
  { val: 'fee_rate_asc',    label: '费率 低→高'        },
  { val: 'fee_rate_desc',   label: '费率 高→低'        },
  { val: 'scale_desc',      label: '规模 大→小'        },
  { val: 'scale_asc',       label: '规模 小→大'        },
  { val: 'track_error_asc', label: '跟踪误差 低→高'    },
];
const SORT_OPTS_ETF = [
  { val: 'ytd_return_desc', label: '近一年收益 高→低' },
  { val: 'ytd_return_asc',  label: '近一年收益 低→高' },
  { val: 'premium_asc',     label: '溢价率 低→高'     },
  { val: 'premium_desc',    label: '溢价率 高→低'     },
  { val: 'scale_desc',      label: '规模 大→小'       },
  { val: 'volume_desc',     label: '成交额 大→小'     },
  { val: 'fee_rate_asc',    label: '费率 低→高'       },
];

const DEFAULT_FILTERS = {
  sort:       'ytd_return_desc',
  status:     'all',   // all | open | suspended
  feeRate:    'all',   // all | low(≤0.65) | mid(0.66-0.99) | high(≥1)
  scale:      'all',   // all | large(>50) | mid(10-50) | small(<10)
  premium:    'all',   // ETF: all | safe(<1.5) | warn(1.5-3) | danger(>3)
  trackIndex: 'all',   // ETF: all | nasdaq100 | sp500 | tech
};

Page({
  data: {
    tabs:        TABS,
    activeTab:   'nasdaq',
    loading:     true,
    rawData:     [],
    displayData: [],
    searchQuery: '',

    // 筛选面板
    sheetOpen:   false,
    filters:     { ...DEFAULT_FILTERS },
    draftFilters:{ ...DEFAULT_FILTERS },  // 面板内编辑中的值（未确认）
    sortOpts:    SORT_OPTS_FUND,

    // 活跃筛选数量（显示角标）
    activeFilterCount: 0,
  },

  onLoad()  { this._loadTab('nasdaq'); },
  onShow()  {
    this._refresh();
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 });
    }
  },
  onPullDownRefresh() { this._loadTab(this.data.activeTab, true); },
  onFavoritesChange() { this._refresh(); },

  // ── Tab 切换 ──────────────────────────────────────────────────────────────
  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    if (tab === this.data.activeTab) return;
    const isEtf = tab === 'etf';
    const newFilters = { ...DEFAULT_FILTERS };
    this.setData({
      activeTab: tab, loading: true, displayData: [], rawData: [],
      searchQuery: '', filters: newFilters, draftFilters: { ...newFilters },
      activeFilterCount: 0,
      sortOpts: isEtf ? SORT_OPTS_ETF : SORT_OPTS_FUND,
    });
    this._loadTab(tab);
  },

  // ── 数据加载 ──────────────────────────────────────────────────────────────
  async _loadTab(tab, pullRefresh = false) {
    const { cat } = TABS.find(t => t.id === tab);
    try {
      const res  = cat === 'etfs' ? await api.getEtfs() : await api.getFunds(cat);
      const data = (res && res.data && res.data.length) ? res.data : FALLBACK[cat];
      this.setData({ rawData: data, loading: false });
    } catch (_) {
      this.setData({ rawData: FALLBACK[cat] || [], loading: false });
    } finally {
      if (pullRefresh) wx.stopPullDownRefresh();
      this._refresh();
    }
  },

  // ── 计算 displayData ──────────────────────────────────────────────────────
  _refresh() {
    const { rawData, searchQuery, filters, activeTab } = this.data;
    const isEtf  = activeTab === 'etf';
    const favSet = new Set(app.globalData.favorites.map(f => f.code));
    const [sortKey, sortDir] = filters.sort.split('_').reduce((acc, cur, i, arr) => {
      // 最后一段是 asc/desc，其余是 key
      if (i === arr.length - 1) return [arr.slice(0, -1).join('_'), cur];
      return acc;
    }, ['ytd_return', 'desc']);

    let result = rawData.slice();

    // 搜索
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(f => f.name.toLowerCase().indexOf(q) !== -1 || f.code.indexOf(q) !== -1);
    }

    // 状态筛选
    if (!isEtf && filters.status !== 'all') {
      result = result.filter(f => f.buy_status === filters.status);
    }

    // 费率筛选
    if (filters.feeRate !== 'all') {
      result = result.filter(f => {
        const r = f.fee_rate;
        if (filters.feeRate === 'low')  return r != null && r <= 0.65;
        if (filters.feeRate === 'mid')  return r != null && r > 0.65 && r < 1;
        if (filters.feeRate === 'high') return r != null && r >= 1;
        return true;
      });
    }

    // 规模筛选
    if (filters.scale !== 'all') {
      result = result.filter(f => {
        const s = f.scale;
        if (filters.scale === 'large')  return s != null && s > 50;
        if (filters.scale === 'mid')    return s != null && s >= 10 && s <= 50;
        if (filters.scale === 'small')  return s != null && s < 10;
        return true;
      });
    }

    // ETF 溢价率筛选
    if (isEtf && filters.premium !== 'all') {
      result = result.filter(f => {
        const p = f.premium;
        if (filters.premium === 'safe')   return p != null && p < 1.5;
        if (filters.premium === 'warn')   return p != null && p >= 1.5 && p <= 3;
        if (filters.premium === 'danger') return p != null && p > 3;
        return true;
      });
    }

    // ETF 跟踪指数筛选
    if (isEtf && filters.trackIndex !== 'all') {
      result = result.filter(f => {
        const idx = (f.tracking_index || '').toLowerCase();
        if (filters.trackIndex === 'nasdaq100') return idx.indexOf('纳斯达克100') !== -1 || idx.indexOf('nasdaq100') !== -1;
        if (filters.trackIndex === 'sp500')     return idx.indexOf('标普500') !== -1 || idx.indexOf('s&p') !== -1;
        if (filters.trackIndex === 'tech')      return idx.indexOf('科技') !== -1;
        return true;
      });
    }

    // 排序
    const nullVal = sortDir === 'desc' ? -Infinity : Infinity;
    result.sort((a, b) => {
      const av = a[sortKey] != null ? a[sortKey] : nullVal;
      const bv = b[sortKey] != null ? b[sortKey] : nullVal;
      return sortDir === 'desc' ? bv - av : av - bv;
    });

    // 附加展示字段
    result = result.map(f => {
      const ytd = f.ytd_return, prem = f.premium;
      return {
        ...f,
        category:     activeTab,
        isFavorite:   favSet.has(f.code),
        ytd_display:  ytd  != null ? (ytd  >= 0 ? '+' : '') + ytd.toFixed(2)  + '%' : '--',
        ytd_positive: (ytd  || 0) >= 0,
        prem_display: prem != null ? prem.toFixed(2) + '%' : '--',
        prem_warn:    prem != null && prem >= 3,
        prem_danger:  prem != null && prem >= 5,
      };
    });

    // 计算活跃筛选数量
    const activeFilterCount = Object.keys(filters)
      .filter(k => k !== 'sort' && filters[k] !== 'all').length;

    this.setData({ displayData: result, activeFilterCount });
  },

  // ── 搜索 ──────────────────────────────────────────────────────────────────
  onSearch(e)   { this.setData({ searchQuery: e.detail.value }); this._refresh(); },
  clearSearch() { this.setData({ searchQuery: '' }); this._refresh(); },

  // ── 筛选面板 ─────────────────────────────────────────────────────────────
  openSheet() {
    this.setData({ sheetOpen: true, draftFilters: { ...this.data.filters } });
  },
  closeSheet()  { this.setData({ sheetOpen: false }); },
  stopProp(e)   {},   // 防止遮罩点击穿透

  setDraftFilter(e) {
    const { key, val } = e.currentTarget.dataset;
    this.setData({ [`draftFilters.${key}`]: val });
  },

  applyFilters() {
    this.setData({ filters: { ...this.data.draftFilters }, sheetOpen: false });
    this._refresh();
  },

  resetFilters() {
    const isEtf  = this.data.activeTab === 'etf';
    const reset  = { ...DEFAULT_FILTERS };
    this.setData({ draftFilters: reset });
  },

  // ── 基金详情 ──────────────────────────────────────────────────────────────
  goDetail(e) {
    const fund = e.currentTarget.dataset.fund;
    app.globalData.selectedFund = fund;
    wx.navigateTo({ url: '/pages/fund-detail/fund-detail' });
  },

  toggleFavorite(e) {
    const fund = e.currentTarget.dataset.fund;
    app.toggleFavorite(fund);
    this._refresh();
  },
});
