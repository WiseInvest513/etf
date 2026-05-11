// app.js
const API_BASE = 'https://www.wise-etf.com/api';

App({
  globalData: {
    openid:     null,
    isLoggedIn: false,
    loginState: 'idle',   // idle | loading | ok | fail
    favorites:  [],
    API_BASE,
  },

  onLaunch() {
    this._loadLocalFavorites();
    this._doLogin();
  },

  // ── 本地缓存 ────────────────────────────────────────────────────────────────
  _loadLocalFavorites() {
    try {
      const favs = wx.getStorageSync('wise_favorites') || [];
      this.globalData.favorites = favs;
    } catch (e) {}
  },

  // ── 微信登录（可重试）───────────────────────────────────────────────────────
  doLogin() {
    this._doLogin();
  },

  _doLogin() {
    if (this.globalData.loginState === 'loading') return;
    this.globalData.loginState = 'loading';
    this._notifyPages();

    const self = this;
    wx.login({
      success: function(res) {
        if (!res.code) {
          self.globalData.loginState = 'fail';
          self._notifyPages();
          return;
        }
        wx.request({
          url: API_BASE + '/wx/login',
          method: 'POST',
          data: { code: res.code },
          header: { 'Content-Type': 'application/json' },
          success: function(r) {
            if (r.data && r.data.openid) {
              self.globalData.openid     = r.data.openid;
              self.globalData.isLoggedIn = true;
              self.globalData.loginState = 'ok';
              wx.setStorageSync('wise_openid', r.data.openid);
              self._syncRemoteFavorites();
            } else {
              self.globalData.loginState = 'fail';
            }
            self._notifyPages();
          },
          fail: function() {
            // 网络失败：用本地缓存的 openid 继续使用
            const cachedOpenid = wx.getStorageSync('wise_openid');
            if (cachedOpenid) {
              self.globalData.openid     = cachedOpenid;
              self.globalData.isLoggedIn = true;
              self.globalData.loginState = 'ok';
            } else {
              self.globalData.loginState = 'fail';
            }
            self._notifyPages();
          },
        });
      },
      fail: function() {
        self.globalData.loginState = 'fail';
        self._notifyPages();
      },
    });
  },

  // ── 从服务端拉取收藏 ─────────────────────────────────────────────────────────
  _syncRemoteFavorites() {
    const openid = this.globalData.openid;
    if (!openid) return;
    const self = this;
    wx.request({
      url: API_BASE + '/user/favorites?openid=' + openid,
      success: function(r) {
        if (r.data && Array.isArray(r.data.favorites) && r.data.favorites.length > 0) {
          self.globalData.favorites = r.data.favorites;
          wx.setStorageSync('wise_favorites', r.data.favorites);
          self._notifyPages();
        }
      },
    });
  },

  // ── 收藏切换 ─────────────────────────────────────────────────────────────────
  toggleFavorite(fund) {
    const favs = this.globalData.favorites;
    let found = -1;
    for (var i = 0; i < favs.length; i++) {
      if (favs[i].code === fund.code) { found = i; break; }
    }

    var newFavs;
    if (found >= 0) {
      newFavs = favs.filter(function(f) { return f.code !== fund.code; });
    } else {
      newFavs = favs.concat([{
        code:     fund.code,
        name:     fund.name,
        category: fund.category || 'nasdaq',
      }]);
    }
    this.globalData.favorites = newFavs;
    wx.setStorageSync('wise_favorites', newFavs);

    const openid = this.globalData.openid;
    if (openid) {
      wx.request({
        url: API_BASE + '/user/favorites',
        method: 'POST',
        data: { openid: openid, favorites: newFavs },
        header: { 'Content-Type': 'application/json' },
      });
    }

    this._notifyPages();
    return found < 0;
  },

  isFavorite(code) {
    const favs = this.globalData.favorites;
    for (var i = 0; i < favs.length; i++) {
      if (favs[i].code === code) return true;
    }
    return false;
  },

  // ── 通知所有页面刷新 ──────────────────────────────────────────────────────────
  _notifyPages() {
    const pages = getCurrentPages();
    for (var i = 0; i < pages.length; i++) {
      if (typeof pages[i].onFavoritesChange === 'function') {
        pages[i].onFavoritesChange(this.globalData.favorites);
      }
    }
  },
});
