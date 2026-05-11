// pages/watchlist/watchlist.js
const app = getApp();
const api = require('../../utils/api');

const CAT_LABEL = {
  nasdaq: '纳指被动',
  sp500:  '标普500',
  etf:    '场内ETF',
  active: '美股主动',
};

function buildDisplay(f) {
  var ytd  = f.ytd_return;
  var prem = f.premium;
  return Object.assign({}, f, {
    ytd_display:  ytd  != null ? (ytd  >= 0 ? '+' : '') + ytd.toFixed(2)  + '%' : '--',
    ytd_positive: (ytd  || 0) >= 0,
    prem_display: prem != null ? prem.toFixed(2) + '%' : '--',
    prem_warn:    prem != null && prem >= 3,
    prem_danger:  prem != null && prem >= 5,
  });
}

const CAT_API = {
  nasdaq: function() { return api.getFunds('nasdaq_passive'); },
  sp500:  function() { return api.getFunds('sp500_passive');  },
  active: function() { return api.getFunds('us_active');      },
  etf:    function() { return api.getEtfs();                  },
};

Page({
  data: {
    favorites: [],
    grouped:   [],
    loading:   true,
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
    var storedFavs = app.globalData.favorites;
    if (!storedFavs.length) {
      this.setData({ favorites: [], grouped: [], loading: false });
      return;
    }

    this.setData({ loading: true });

    // 收集需要拉取的类别
    var needed = {};
    storedFavs.forEach(function(f) { needed[f.category || 'nasdaq'] = true; });

    var self = this;
    var promises = Object.keys(needed).map(function(cat) {
      return CAT_API[cat]().then(function(res) {
        return { cat: cat, data: (res && res.data) || [] };
      }).catch(function() {
        return { cat: cat, data: [] };
      });
    });

    Promise.all(promises).then(function(results) {
      // 建立 code → fund 索引（全量 API 数据）
      var liveMap = {};
      results.forEach(function(r) {
        r.data.forEach(function(f) {
          liveMap[f.code] = Object.assign({}, f, { category: r.cat });
        });
      });

      // 按类别分组
      var map = {};
      storedFavs.forEach(function(stored) {
        var cat  = stored.category || 'nasdaq';
        var live = liveMap[stored.code];
        if (!live) return; // API 中找不到该基金，跳过
        if (!map[cat]) map[cat] = [];
        map[cat].push(buildDisplay(live));
      });

      var order   = ['nasdaq', 'sp500', 'etf', 'active'];
      var grouped = order
        .filter(function(c) { return !!map[c]; })
        .map(function(c) { return { catId: c, catLabel: CAT_LABEL[c], items: map[c] }; });

      self.setData({ favorites: storedFavs, grouped: grouped, loading: false });
    });
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
