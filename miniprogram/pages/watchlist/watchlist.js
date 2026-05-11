// pages/watchlist/watchlist.js
const app      = getApp();
const FALLBACK = require('../../utils/fallback');

const CAT_LABEL = {
  nasdaq: '纳指被动',
  sp500:  '标普500',
  etf:    '场内ETF',
  active: '美股主动',
};

// 用 fallback 数据建立 code → fund 索引，用于补全缺失字段
const FB_MAP = {};
['nasdaq_passive', 'sp500_passive', 'us_active'].forEach(function(key) {
  (FALLBACK[key] || []).forEach(function(f) { FB_MAP[f.code] = f; });
});
(FALLBACK.etfs || []).forEach(function(f) { FB_MAP[f.code] = f; });

// 展示字段：这些字段不从收藏数据取，始终由原始数值重新计算
var SKIP_DISPLAY = { ytd_display:1, ytd_positive:1, prem_display:1, prem_warn:1, prem_danger:1, daily_limit_num:1, isFavorite:1 };

// 补全缺失字段：fallback 作为底层，收藏数据中的有效值优先
function enrichFund(f) {
  var fb  = FB_MAP[f.code] || {};
  var out = {};
  // 先铺 fallback
  var fbKeys = Object.keys(fb);
  for (var i = 0; i < fbKeys.length; i++) { out[fbKeys[i]] = fb[fbKeys[i]]; }
  // 再用收藏数据覆盖（跳过展示字段、null、空字符串、占位符 '--'）
  var fKeys = Object.keys(f);
  for (var j = 0; j < fKeys.length; j++) {
    var k = fKeys[j], v = f[k];
    if (SKIP_DISPLAY[k]) continue;
    if (v === null || v === undefined || v === '' || v === '--') continue;
    out[k] = v;
  }
  // 始终从原始数值重新计算展示字段
  var ytd  = out.ytd_return;
  var prem = out.premium;
  out.ytd_display  = ytd  != null ? (ytd  >= 0 ? '+' : '') + ytd.toFixed(2)  + '%' : '--';
  out.ytd_positive = (ytd || 0) >= 0;
  out.prem_display = prem != null ? prem.toFixed(2) + '%' : '--';
  out.prem_warn    = prem != null && prem >= 3;
  out.prem_danger  = prem != null && prem >= 5;
  return out;
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
    favorites.forEach(function(f) {
      const cat = f.category || 'nasdaq';
      if (!map[cat]) map[cat] = [];
      map[cat].push(enrichFund(f));
    });
    const order   = ['nasdaq', 'sp500', 'etf', 'active'];
    const grouped = order
      .filter(function(c) { return !!map[c]; })
      .map(function(c) { return { catId: c, catLabel: CAT_LABEL[c], items: map[c] }; });

    this.setData({ favorites: favorites, grouped: grouped });
  },

  removeFavorite(e) {
    const fund = e.currentTarget.dataset.fund;
    wx.showModal({
      title:        '移除自选',
      content:      '从自选中移除「' + fund.name + '」？',
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
