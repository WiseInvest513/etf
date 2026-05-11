const app = getApp();

Page({
  data: { fund: null, isEtf: false },

  onLoad() {
    const fund = app.globalData.selectedFund;
    if (!fund) { wx.navigateBack(); return; }
    wx.setNavigationBarTitle({ title: fund.code || '基金详情' });
    this.setData({ fund, isEtf: fund.category === 'etf' });
  },

  onShow() {
    // 刷新收藏状态
    const fund = this.data.fund;
    if (!fund) return;
    this.setData({
      'fund.isFavorite': app.isFavorite(fund.code),
    });
  },

  toggleFavorite() {
    const { fund } = this.data;
    app.toggleFavorite(fund);
    this.setData({ 'fund.isFavorite': app.isFavorite(fund.code) });
  },
});
