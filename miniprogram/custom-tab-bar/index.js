Component({
  data: {
    selected: 0,
    list: [
      { icon: '📊', iconSel: '📊', label: '行情',    path: '/pages/market/market'       },
      { icon: '⭐', iconSel: '⭐', label: '自选',    path: '/pages/watchlist/watchlist'  },
      { icon: '🌱', iconSel: '🌱', label: '懒人组合', path: '/pages/lazy/lazy'            },
      { icon: '👤', iconSel: '👤', label: '我的',    path: '/pages/mine/mine'            },
    ],
  },
  methods: {
    onSwitch(e) {
      const { path, index } = e.currentTarget.dataset;
      this.setData({ selected: index });
      wx.switchTab({ url: path });
    },
  },
});
