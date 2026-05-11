// pages/mine/mine.js
const app = getApp();

Page({
  data: {
    isLoggedIn: false,
    loginState: 'idle',
    openid:     '',
    favCount:   0,
    avatarUrl:  '',
    nickName:   '',
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
    const avatarUrl = wx.getStorageSync('wise_avatar') || '';
    const nickName  = wx.getStorageSync('wise_nickname') || '';
    this.setData({
      isLoggedIn, loginState,
      openid:   openid ? openid.slice(0, 6) + '****' : '',
      favCount: favorites.length,
      avatarUrl, nickName,
    });
  },

  // 微信头像选择（需用户主动点击按钮）
  onChooseAvatar(e) {
    const avatarUrl = e.detail.avatarUrl;
    wx.setStorageSync('wise_avatar', avatarUrl);
    this.setData({ avatarUrl });
  },

  // 修改昵称
  onNickNameInput(e) {
    const nickName = e.detail.value;
    wx.setStorageSync('wise_nickname', nickName);
    this.setData({ nickName });
  },

  retryLogin() {
    app.doLogin();
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
