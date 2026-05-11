// pages/watchlist/watchlist.js
const app = getApp();

const CAT_LABEL = {
  nasdaq: '纳指被动',
  sp500:  '标普500',
  etf:    '场内ETF',
  active: '美股主动',
};

Page({
  data: {
    favorites:   [],
    isLoggedIn:  false,
    grouped:     [],   // [{catLabel, items:[]}]
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
    const { favorites, isLoggedIn } = app.globalData;
    // 按类别分组
    const map = {};
    favorites.forEach(f => {
      const cat = f.category || 'nasdaq';
      if (!map[cat]) map[cat] = [];
      map[cat].push(f);
    });
    const order  = ['nasdaq', 'sp500', 'etf', 'active'];
    const grouped = order
      .filter(c => map[c])
      .map(c => ({ catId: c, catLabel: CAT_LABEL[c], items: map[c] }));

    this.setData({ favorites, isLoggedIn, grouped });
  },

  removeFavorite(e) {
    const fund = e.currentTarget.dataset.fund;
    wx.showModal({
      title:       '移除自选',
      content:     `从自选中移除「${fund.name}」？`,
      confirmText: '移除',
      confirmColor:'#d93025',
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
