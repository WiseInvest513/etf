// pages/lazy/lazy.js
const PORTFOLIOS = require('../../utils/lazy-data');

Page({
  data: {
    portfolios: PORTFOLIOS,
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 });
    }
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/lazy-detail/lazy-detail?id=${id}` });
  },
});
