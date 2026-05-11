// pages/watchlist/watchlist.js
const app = getApp();

const CAT_LABEL = {
  nasdaq: '纳指被动',
  sp500:  '标普500',
  etf:    '场内ETF',
  active: '美股主动',
};

// 补全可能缺失的展示字段（兼容旧版本保存的数据）
function ensureDisplay(f) {
  const ytd  = f.ytd_return;
  const prem = f.premium;
  return Object.assign({}, f, {
    ytd_display:  f.ytd_display  || (ytd  != null ? (ytd  >= 0 ? '+' : '') + ytd.toFixed(2)  + '%' : '--'),
    ytd_positive: f.ytd_positive != null ? f.ytd_positive : (ytd || 0) >= 0,
    prem_display: f.prem_display || (prem != null ? prem.toFixed(2) + '%' : '--'),
    prem_warn:    f.prem_warn    != null ? f.prem_warn    : (prem != null && prem >= 3),
    prem_danger:  f.prem_danger  != null ? f.prem_danger  : (prem != null && prem >= 5),
  });
}

Page({
  data: {
    favorites: [],
    grouped:   [],
  },

  onLoad() { this._refresh(); },
  onShow()  {
    this._refresh();
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 });
    }
  },

  onFavoritesChange() { this._refresh(); },

  _refresh() {
    const favorites = app.globalData.favorites;
    const map = {};
    favorites.forEach(f => {
      const cat = f.category || 'nasdaq';
      if (!map[cat]) map[cat] = [];
      map[cat].push(ensureDisplay(f));
    });
    const order   = ['nasdaq', 'sp500', 'etf', 'active'];
    const grouped = order
      .filter(c => map[c])
      .map(c => ({ catId: c, catLabel: CAT_LABEL[c], items: map[c] }));

    this.setData({ favorites, grouped });
  },

  removeFavorite(e) {
    const fund = e.currentTarget.dataset.fund;
    wx.showModal({
      title:        '移除自选',
      content:      `从自选中移除「${fund.name}」？`,
      confirmText:  '移除',
      confirmColor: '#d93025',
      success: (res) => {
        if (res.confirm) {
          app.toggleFavorite(fund);
          this._refresh();
        }
      },
    });
  },

  goToMarket() {
    wx.switchTab({ url: '/pages/market/market' });
  },
});
