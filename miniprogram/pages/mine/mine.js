// pages/mine/mine.js
const app = getApp();

Page({
  data: {
    avatarUrl: '',
    nickName:  '',
    favCount:  0,
  },

  onLoad() { this._refresh(); },
  onShow() {
    this._refresh();
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 3 });
    }
  },

  _refresh() {
    this.setData({
      avatarUrl: wx.getStorageSync('wise_avatar')   || '',
      nickName:  wx.getStorageSync('wise_nickname') || '',
      favCount:  app.globalData.favorites.length,
    });
  },

  // 微信头像（用户点击后系统自动提供）
  onChooseAvatar(e) {
    const url = e.detail.avatarUrl;
    wx.setStorageSync('wise_avatar', url);
    this.setData({ avatarUrl: url });
  },

  // 微信昵称（type="nickname" 输入框会自动填充）
  onNickNameInput(e) {
    const name = e.detail.value;
    wx.setStorageSync('wise_nickname', name);
    this.setData({ nickName: name });
  },

  goWatchlist() { wx.switchTab({ url: '/pages/watchlist/watchlist' }); },
  goExport()    { wx.navigateTo({ url: '/pages/export/export' }); },
});
