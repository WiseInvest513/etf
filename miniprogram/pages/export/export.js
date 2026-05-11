// pages/export/export.js
const api      = require('../../utils/api');
const FALLBACK = require('../../utils/fallback');

// ── 设计 Token（与 Web 版 EC 对象对应）──────────────────────────────────────
const EC = {
  bg:     '#07090f', card:   '#0d1320', border: '#182033',
  blue:   '#3d82ff', green:  '#26c258', red:    '#ff3b30',
  orange: '#ff9a00', white:  '#edf0f9', muted:  '#5e6270',
  F: '"PingFang SC","Microsoft YaHei",Helvetica,Arial,sans-serif',
};

// ── 辅助：圆角矩形 ────────────────────────────────────────────────────────────
function rr(ctx, x, y, w, h, r = 8) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// ── 辅助：文字截断 ────────────────────────────────────────────────────────────
function fitText(ctx, text, maxW) {
  if (!text) return '—';
  let t = String(text);
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) {
    t = t.slice(0, -1);
  }
  return ctx.measureText(text).width <= maxW ? text : t + '…';
}

// ── 核心绘制函数 ──────────────────────────────────────────────────────────────
function drawExportCanvas(canvas, { titleParts, date, cols, rows }) {
  const SC   = 2;
  const W    = 750;
  const ROW  = 52;
  const HEAD = 80;
  const PAD  = 24;
  const BRAND= 70;
  const FOOT = 46;
  const H    = BRAND + HEAD + ROW * rows.length + FOOT;

  canvas.width  = W * SC;
  canvas.height = H * SC;

  const ctx = canvas.getContext('2d');
  ctx.scale(SC, SC);
  ctx.fillStyle = EC.bg;
  ctx.fillRect(0, 0, W, H);

  const F = EC.F;

  // ── 顶部渐变条 ──
  const grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, EC.blue);
  grad.addColorStop(1, '#7c3aed');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, 5);

  // ── 品牌 header ──
  ctx.fillStyle = EC.card;
  ctx.fillRect(0, 5, W, BRAND - 5);
  ctx.font = `bold 15px ${F}`;
  ctx.fillStyle = EC.blue;
  ctx.fillText('Wise ETF', PAD, 36);
  ctx.font = `bold 13px ${F}`;
  ctx.fillStyle = EC.white;
  ctx.fillText(titleParts[0] || '', PAD + 86, 36);
  ctx.font = `11px ${F}`;
  ctx.fillStyle = EC.muted;
  ctx.fillText(date, PAD, 56);

  // ── 表头 ──
  let y0 = BRAND;
  ctx.fillStyle = '#0b1524';
  ctx.fillRect(0, y0, W, HEAD);
  let x = PAD;
  cols.forEach(col => {
    ctx.font = `bold 11px ${F}`;
    ctx.fillStyle = EC.muted;
    ctx.fillText(col.label, x, y0 + 28);
    if (col.sub) {
      ctx.font = `10px ${F}`;
      ctx.fillStyle = '#3a4255';
      ctx.fillText(col.sub, x, y0 + 46);
    }
    x += col.w;
  });

  // ── 数据行 ──
  rows.forEach((row, i) => {
    const ry = BRAND + HEAD + i * ROW;
    ctx.fillStyle = i % 2 === 0 ? EC.card : '#0f1825';
    ctx.fillRect(0, ry, W, ROW);

    let rx = PAD;
    row.forEach((cell, ci) => {
      const col = cols[ci];
      const val = String(cell.v ?? '—');

      ctx.font = cell.bold ? `bold 11px ${F}` : `11px ${F}`;
      ctx.fillStyle = cell.color || EC.white;
      ctx.textBaseline = 'middle';
      ctx.fillText(fitText(ctx, val, col.w - 10), rx, ry + ROW / 2);
      rx += col.w;
    });
  });

  // ── 底部 footer ──
  const fy = BRAND + HEAD + rows.length * ROW;
  ctx.fillStyle = '#06080d';
  ctx.fillRect(0, fy, W, FOOT);
  ctx.font = `10px ${F}`;
  ctx.fillStyle = EC.muted;
  ctx.textBaseline = 'middle';
  ctx.fillText('仅供参考，不构成投资建议 · WiseETF 小程序', PAD, fy + FOOT / 2);

  return canvas;
}

// ── 各类型导出配置 ────────────────────────────────────────────────────────────
function buildNasdaqConfig(rows, date) {
  const cols = [
    { label: '基金名称', sub: 'Nasdaq 100',  w: 220 },
    { label: '近一年',   sub: 'ytd %',       w: 80  },
    { label: '费率',     sub: '年管理费',     w: 60  },
    { label: '规模',     sub: '(亿元)',       w: 70  },
    { label: '跟踪差',   sub: 'Error %',     w: 70  },
    { label: '限额',     sub: '每日',         w: 100 },
    { label: '状态',     sub: '',             w: 70  },
  ];
  const dataRows = rows.map(f => [
    { v: f.name, bold: true, color: EC.white },
    { v: f.ytd_return != null ? (f.ytd_return >= 0 ? '+' : '') + f.ytd_return.toFixed(2) + '%' : '—',
      color: f.ytd_return >= 0 ? EC.green : EC.red },
    { v: f.fee_rate != null ? f.fee_rate + '%' : '—', color: EC.muted },
    { v: f.scale != null ? f.scale + '亿' : '—', color: EC.muted },
    { v: f.track_error != null ? f.track_error + '%' : '—', color: EC.muted },
    { v: f.daily_limit || '—', color: EC.orange },
    { v: f.buy_status === 'open' ? '可申购' : '暂停',
      color: f.buy_status === 'open' ? EC.green : EC.red },
  ]);
  return { titleParts: ['纳指被动基金对比'], date, cols, rows: dataRows };
}

function buildSp500Config(rows, date) {
  return buildNasdaqConfig(rows, date); // 相同结构
}

function buildActiveConfig(rows, date) {
  const cols = [
    { label: '基金名称', sub: '美股主动',  w: 250 },
    { label: '近一年',   sub: 'ytd %',    w: 90  },
    { label: '费率',     sub: '年管理费',  w: 70  },
    { label: '规模',     sub: '(亿元)',    w: 80  },
    { label: '限额',     sub: '每日',      w: 110 },
    { label: '状态',     sub: '',          w: 80  },
  ];
  const dataRows = rows.map(f => [
    { v: f.name, bold: true, color: EC.white },
    { v: f.ytd_return != null ? (f.ytd_return >= 0 ? '+' : '') + f.ytd_return.toFixed(2) + '%' : '—',
      color: f.ytd_return >= 0 ? EC.green : EC.red },
    { v: f.fee_rate != null ? f.fee_rate + '%' : '—', color: EC.muted },
    { v: f.scale != null ? f.scale + '亿' : '—', color: EC.muted },
    { v: f.daily_limit || '—', color: EC.orange },
    { v: f.buy_status === 'open' ? '可申购' : '暂停',
      color: f.buy_status === 'open' ? EC.green : EC.red },
  ]);
  return { titleParts: ['美股主动型基金对比'], date, cols, rows: dataRows };
}

function buildEtfConfig(rows, date) {
  const cols = [
    { label: 'ETF名称', sub: '场内',     w: 210 },
    { label: '近一年',  sub: 'ytd %',   w: 80  },
    { label: '溢价率',  sub: 'Premium', w: 80  },
    { label: '费率',    sub: '年管理费', w: 60  },
    { label: '规模',    sub: '(亿元)',   w: 70  },
    { label: '成交额',  sub: '(亿元)',   w: 70  },
    { label: '指数',    sub: '',         w: 130 },
  ];
  const dataRows = rows.map(f => {
    const prem = f.premium;
    const premCol = prem >= 5 ? EC.red : prem >= 3 ? EC.orange : EC.green;
    return [
      { v: f.name, bold: true, color: EC.white },
      { v: f.ytd_return != null ? (f.ytd_return >= 0 ? '+' : '') + f.ytd_return.toFixed(2) + '%' : '—',
        color: f.ytd_return >= 0 ? EC.green : EC.red },
      { v: prem != null ? prem.toFixed(2) + '%' : '—', color: premCol },
      { v: f.fee_rate != null ? f.fee_rate + '%' : '—', color: EC.muted },
      { v: f.scale != null ? f.scale + '亿' : '—', color: EC.muted },
      { v: f.volume != null ? f.volume + '亿' : '—', color: EC.muted },
      { v: f.tracking_index || '—', color: EC.muted },
    ];
  });
  return { titleParts: ['场内ETF溢价对比'], date, cols, rows: dataRows };
}

// ── Page ─────────────────────────────────────────────────────────────────────
const CAT_COLORS = {
  'canvas-nasdaq': '#3d82ff',
  'canvas-sp500':  '#26c258',
  'canvas-etf':    '#ff9a00',
  'canvas-active': '#a855f7',
};

Page({
  data: {
    generating: false,
    images:     [],
    toast:      null,
    categories: [
      { id: 'canvas-nasdaq', name: '纳指被动', color: '#3d82ff' },
      { id: 'canvas-sp500',  name: '标普500',  color: '#26c258' },
      { id: 'canvas-etf',    name: '场内ETF',  color: '#ff9a00' },
      { id: 'canvas-active', name: '美股主动', color: '#a855f7' },
    ],
  },

  onLoad() {
    this._loadData();
  },

  _fundData: {},

  async _loadData() {
    try {
      const [nd, sp, ac, etf] = await Promise.allSettled([
        api.getFunds('nasdaq_passive'),
        api.getFunds('sp500_passive'),
        api.getFunds('us_active'),
        api.getEtfs(),
      ]);
      this._fundData = {
        nasdaq: (nd.value?.data?.length ? nd.value.data : FALLBACK.nasdaq_passive),
        sp500:  (sp.value?.data?.length ? sp.value.data : FALLBACK.sp500_passive),
        active: (ac.value?.data?.length ? ac.value.data : FALLBACK.us_active),
        etfs:   (etf.value?.data?.length ? etf.value.data : FALLBACK.etfs),
      };
    } catch (_) {
      this._fundData = {
        nasdaq: FALLBACK.nasdaq_passive,
        sp500:  FALLBACK.sp500_passive,
        active: FALLBACK.us_active,
        etfs:   FALLBACK.etfs,
      };
    }
  },

  // 按限额排序（模仿 web byLimit）
  _byLimit(arr) {
    if (!arr || !arr.length) return [];
    const parse = s => {
      if (!s || s === '暂停申购') return 0;
      if (s === '不限额') return 9999999;
      return parseFloat(s) || 0;
    };
    return arr.slice().sort((a, b) => parse(b.daily_limit) - parse(a.daily_limit));
  },

  async generateAll() {
    if (!this._fundData || !this._fundData.nasdaq) {
      this._showToast('数据加载中，请稍后再试', false);
      return;
    }
    this.setData({ generating: true, images: [] });
    const date = new Date().toLocaleDateString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).replace(/\//g, '-');

    const nasdaq = this._fundData.nasdaq || [];
    const sp500  = this._fundData.sp500  || [];
    const active = this._fundData.active || [];
    const etfs   = this._fundData.etfs   || [];
    const tasks = [
      { title: '纳指被动基金',   cfg: buildNasdaqConfig(this._byLimit(nasdaq), date), id: 'canvas-nasdaq' },
      { title: '标普500基金',    cfg: buildSp500Config(this._byLimit(sp500), date),   id: 'canvas-sp500'  },
      { title: '场内ETF对比',    cfg: buildEtfConfig(etfs.slice().sort((a,b)=>(b.scale||0)-(a.scale||0)), date), id: 'canvas-etf' },
      { title: '美股主动型基金', cfg: buildActiveConfig(this._byLimit(active), date), id: 'canvas-active' },
    ];

    const images = [];
    for (const task of tasks) {
      try {
        const tempFilePath = await this._drawAndExport(task.id, task.cfg);
        images.push({ title: task.title, tempFilePath, color: CAT_COLORS[task.id] });
      } catch (e) {
        console.error(`[export] ${task.title} failed:`, e);
      }
    }

    this.setData({ images, generating: false });
    if (images.length > 0) {
      this._showToast(`已生成 ${images.length} 张，点击保存`, true);
    }
  },

  _drawAndExport(canvasId, cfg) {
    return new Promise((resolve, reject) => {
      const query = wx.createSelectorQuery().in(this);
      query.select(`#${canvasId}`)
        .fields({ node: true, size: true })
        .exec((res) => {
          if (!res[0] || !res[0].node) {
            return reject(new Error(`canvas not found: ${canvasId}`));
          }
          const canvas = res[0].node;
          drawExportCanvas(canvas, cfg);
          wx.canvasToTempFilePath({
            canvas,
            success: r => resolve(r.tempFilePath),
            fail:    reject,
          });
        });
    });
  },

  saveImage(e) {
    const path = e.currentTarget.dataset.path;
    wx.saveImageToPhotosAlbum({
      filePath: path,
      success: () => this._showToast('已保存到相册', true),
      fail: (err) => {
        if (err.errMsg && err.errMsg.includes('auth deny')) {
          wx.openSetting();
        } else {
          this._showToast('保存失败', false);
        }
      },
    });
  },

  saveAll() {
    const { images } = this.data;
    let saved = 0;
    images.forEach(img => {
      wx.saveImageToPhotosAlbum({
        filePath: img.tempFilePath,
        success: () => {
          saved++;
          if (saved === images.length) this._showToast('全部保存到相册', true);
        },
        fail: () => this._showToast('保存失败，请检查相册权限', false),
      });
    });
  },

  _showToast(msg, ok) {
    this.setData({ toast: { msg, ok } });
    setTimeout(() => this.setData({ toast: null }), 2500);
  },
});
