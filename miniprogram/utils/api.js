// utils/api.js — 统一 API 请求封装
const BASE = 'https://www.wise-etf.com/api';

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${BASE}${path}`,
      method: options.method || 'GET',
      data: options.data,
      header: { 'Content-Type': 'application/json', ...(options.header || {}) },
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      },
      fail: (err) => reject(err),
    });
  });
}

module.exports = {
  // 基金数据
  getFunds:          (cat)  => request(`/funds/${cat}`),
  getEtfs:           ()     => request('/etfs'),
  getLiveData:       ()     => request('/live_data'),
  getSentiment:      ()     => request('/market-sentiment'),
  getPremiumHistory: (code) => request(`/premium_history/${code}`),

  // 微信登录
  wxLogin:           (code) => request('/wx/login', { method: 'POST', data: { code } }),

  // 用户收藏
  getFavorites:  (openid)           => request(`/user/favorites?openid=${openid}`),
  saveFavorites: (openid, favorites) => request('/user/favorites', {
    method: 'POST',
    data: { openid, favorites },
  }),
};
