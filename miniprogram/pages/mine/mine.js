// pages/mine/mine.js
const app = getApp();

Page({
  data: {
    isLoggedIn: false,
    loginState: 'idle',   // idle | loading | ok | fail
    openid:     '',
    favCount:   0,
  },

  onLoad()  { this._refresh(); },
  onShow()  {
    this._refresh();
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 3 });
    }
  },

  onFavoritesChange() { this._refresh(); },

  _refresh() {
    const { isLoggedIn, openid, favorites, loginState } = app.globalData;
    this.setData({
      isLoggedIn,
      loginState,
      openid:   openid ? openid.slice(0, 6) + '****' : '',
      favCount: favorites.length,
    });
  },

  retryLogin() {
    app.doLogin();
    // 轮询等待登录完成后刷新
    const self = this;
    var count = 0;
    var timer = setInterval(function() {
      self._refresh();
      count++;
      if (app.globalData.loginState !== 'loading' || count > 10) {
        clearInterval(timer);
      }
    }, 600);
  },

  goWatchlist() { wx.switchTab({ url: '/pages/watchlist/watchlist' }); },
  goExport()    { wx.navigateTo({ url: '/pages/export/export' }); },
});
