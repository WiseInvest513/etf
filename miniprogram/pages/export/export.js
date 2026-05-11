// pages/export/export.js
const api      = require('../../utils/api');
const FALLBACK = require('../../utils/fallback');

const F = '"PingFang SC","Microsoft YaHei",Helvetica,Arial,sans-serif';

// ── 颜色方案（亮色主题）──────────────────────────────────────────────────────
const C = {
  navy:    '#0d1a35',  // 深蓝 header/footer
  blue:    '#1d4ed8',  // 品牌蓝
  azure:   '#2563eb',  // 链接蓝
  white:   '#ffffff',
  bgAlt:   '#eef3ff',  // 交替行背景
  text:    '#111827',  // 主文字
  muted:   '#6b7280',  // 次要文字
  green:   '#16a34a',  // 正收益/可申购
  greenBg: '#dcfce7',
  red:     '#dc2626',  // 负收益/危险
  redBg:   '#fee2e2',
  orange:  '#ea580c',  // 限额
  gray:    '#9ca3af',  // 暂停
  grayBg:  '#f3f4f6',
  hdr:     '#1e3a5f',  // 表头背景
  border:  '#e5e7eb',
};

// ── 辅助：文字截断 ────────────────────────────────────────────────────────────
function fitText(ctx, text, maxW) {
  if (!text) return '—';
  var t = String(text);
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) {
    t = t.slice(0, -1);
  }
  return ctx.measureText(String(text)).width <= maxW ? String(text) : t + '…';
}

// ── 辅助：圆角矩形 ────────────────────────────────────────────────────────────
function roundRect(ctx, x, y, w, h, r) {
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

// ── 辅助：绘制状态徽章 ────────────────────────────────────────────────────────
function drawBadge(ctx, text, cx, cy, bgColor, textColor) {
  ctx.font = 'bold 9px ' + F;
  var tw = ctx.measureText(text).width;
  var bw = tw + 12, bh = 16;
  var bx = cx - bw / 2, by = cy - bh / 2;
  roundRect(ctx, bx, by, bw, bh, 8);
  ctx.fillStyle = bgColor;
  ctx.fill();
  ctx.fillStyle = textColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, cy);
  ctx.textAlign = 'left';
}

// ── 辅助：绘制迷你二维码占位（3×3 finder 格）────────────────────────────────
function drawQRPlaceholder(ctx, x, y, size) {
  var s = size;
  // 白底
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, x - 3, y - 3, s + 6, s + 6, 4);
  ctx.fill();

  var cell = s / 7;
  // Finder pattern: top-left
  function finder(ox, oy) {
    ctx.fillStyle = C.navy;
    ctx.fillRect(ox, oy, cell * 3, cell * 3);
    ctx.fillStyle = '#fff';
    ctx.fillRect(ox + cell * 0.7, oy + cell * 0.7, cell * 1.6, cell * 1.6);
    ctx.fillStyle = C.navy;
    ctx.fillRect(ox + cell * 1.1, oy + cell * 1.1, cell * 0.8, cell * 0.8);
  }
  finder(x, y);                              // top-left
  finder(x + cell * 4, y);                  // top-right
  finder(x, y + cell * 4);                  // bottom-left

  // Random data cells (center area)
  var pattern = [
    [3,0],[4,0],[3,2],[5,2],[3,3],[4,3],[6,3],
    [3,4],[5,4],[3,5],[4,5],[6,5],[3,6],[5,6],
  ];
  ctx.fillStyle = C.navy;
  for (var i = 0; i < pattern.length; i++) {
    ctx.fillRect(x + pattern[i][0]*cell, y + pattern[i][1]*cell, cell*0.85, cell*0.85);
  }
}

// ── 核心绘制函数 ──────────────────────────────────────────────────────────────
function drawExportCanvas(canvas, cfg) {
  var title = cfg.title;
  var date  = cfg.date;
  var cols  = cfg.cols;
  var rows  = cfg.rows;

  var SC      = 2;
  var W       = 750;
  var PAD     = 20;
  var BRAND_H = 46;
  var TITLE_H = 64;
  var COL_H   = 36;
  var ROW_H   = 42;
  var FOOT_H  = 68;
  var H       = BRAND_H + TITLE_H + COL_H + ROW_H * rows.length + FOOT_H;

  canvas.width  = W * SC;
  canvas.height = H * SC;

  var ctx = canvas.getContext('2d');
  ctx.scale(SC, SC);

  // ── 品牌顶栏（深蓝）──
  ctx.fillStyle = C.navy;
  ctx.fillRect(0, 0, W, BRAND_H);

  // 左上蓝色强调条
  ctx.fillStyle = '#3b82f6';
  ctx.fillRect(0, 0, 4, BRAND_H);

  ctx.textBaseline = 'middle';
  ctx.font = 'bold 16px ' + F;
  ctx.fillStyle = '#60a5fa';
  ctx.fillText('WiseETF', PAD + 6, BRAND_H / 2);

  ctx.font = '11px ' + F;
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillText('@WiseInvest 整理', PAD + 94, BRAND_H / 2);

  ctx.textAlign = 'right';
  ctx.font = '11px ' + F;
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fillText(date, W - PAD, BRAND_H / 2);
  ctx.textAlign = 'left';

  // ── 标题区（白色）──
  ctx.fillStyle = C.white;
  ctx.fillRect(0, BRAND_H, W, TITLE_H);

  // 左侧蓝色竖条
  ctx.fillStyle = '#2563eb';
  ctx.fillRect(PAD, BRAND_H + 14, 4, TITLE_H - 28);

  ctx.textBaseline = 'middle';
  ctx.font = 'bold 20px ' + F;
  ctx.fillStyle = C.text;
  ctx.fillText(title, PAD + 14, BRAND_H + TITLE_H * 0.42);

  ctx.font = '11px ' + F;
  ctx.fillStyle = C.muted;
  ctx.fillText(date + '  ·  数据仅供参考，不构成投资建议', PAD + 14, BRAND_H + TITLE_H * 0.74);

  // ── 表头（深蓝底）──
  var hy = BRAND_H + TITLE_H;
  ctx.fillStyle = C.hdr;
  ctx.fillRect(0, hy, W, COL_H);

  var hx = PAD;
  ctx.font = 'bold 10px ' + F;
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.textBaseline = 'middle';
  for (var ci = 0; ci < cols.length; ci++) {
    var col = cols[ci];
    if (col.align === 'right') {
      ctx.textAlign = 'right';
      ctx.fillText(col.label, hx + col.w - 6, hy + COL_H / 2);
    } else if (col.align === 'center') {
      ctx.textAlign = 'center';
      ctx.fillText(col.label, hx + col.w / 2, hy + COL_H / 2);
    } else {
      ctx.textAlign = 'left';
      ctx.fillText(col.label, hx + 4, hy + COL_H / 2);
    }
    hx += col.w;
  }
  ctx.textAlign = 'left';

  // ── 数据行 ──
  for (var ri = 0; ri < rows.length; ri++) {
    var row = rows[ri];
    var ry  = BRAND_H + TITLE_H + COL_H + ri * ROW_H;

    // 交替行背景
    ctx.fillStyle = ri % 2 === 0 ? C.white : C.bgAlt;
    ctx.fillRect(0, ry, W, ROW_H);

    // 底部分隔线
    ctx.fillStyle = C.border;
    ctx.fillRect(0, ry + ROW_H - 1, W, 1);

    var rx = PAD;
    for (var rci = 0; rci < row.length; rci++) {
      var cell = row[rci];
      var c    = cols[rci];
      var cy   = ry + ROW_H / 2;

      if (cell.badge) {
        // 绘制徽章
        var bcx = (c.align === 'right') ? rx + c.w - 6 - cell.badgeW / 2
                 :(c.align === 'center') ? rx + c.w / 2
                 : rx + 4 + cell.badgeW / 2;
        drawBadge(ctx, String(cell.v), bcx, cy, cell.badgeBg || C.grayBg, cell.badgeColor || C.gray);
      } else {
        var val = String(cell.v != null ? cell.v : '—');
        ctx.font = (cell.bold ? 'bold ' : '') + '11px ' + F;
        ctx.fillStyle = cell.color || C.text;
        ctx.textBaseline = 'middle';
        if (c.align === 'right') {
          ctx.textAlign = 'right';
          ctx.fillText(fitText(ctx, val, c.w - 8), rx + c.w - 6, cy);
        } else if (c.align === 'center') {
          ctx.textAlign = 'center';
          ctx.fillText(fitText(ctx, val, c.w - 8), rx + c.w / 2, cy);
        } else {
          ctx.textAlign = 'left';
          ctx.fillText(fitText(ctx, val, c.w - 8), rx + 4, cy);
        }
        ctx.textAlign = 'left';
      }
      rx += c.w;
    }
  }

  // ── Footer（深蓝）──
  var fy = BRAND_H + TITLE_H + COL_H + rows.length * ROW_H;
  ctx.fillStyle = C.navy;
  ctx.fillRect(0, fy, W, FOOT_H);

  // 左侧文字
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 13px ' + F;
  ctx.fillStyle = '#60a5fa';
  ctx.fillText('@WiseInvest', PAD, fy + FOOT_H * 0.38);

  ctx.font = '10px ' + F;
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fillText('WiseETF 小程序  · 数据仅供参考，不构成投资建议', PAD, fy + FOOT_H * 0.72);

  // 右侧二维码
  var QR_SIZE = 44;
  var qrX = W - PAD - QR_SIZE;
  var qrY = fy + (FOOT_H - QR_SIZE) / 2;
  drawQRPlaceholder(ctx, qrX, qrY, QR_SIZE);

  // 二维码下方说明
  ctx.font = '8px ' + F;
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.textAlign = 'center';
  ctx.fillText('扫码进入小程序', qrX + QR_SIZE / 2, fy + FOOT_H - 4);
  ctx.textAlign = 'left';

  return canvas;
}

// ── 各类型导出配置 ────────────────────────────────────────────────────────────
function buildNasdaqConfig(rows, date) {
  var cols = [
    { label: '代码',    w: 66,  align: 'left'   },
    { label: '基金名称', w: 200, align: 'left'   },
    { label: '费率',    w: 50,  align: 'right'  },
    { label: '规模(亿)', w: 58,  align: 'right'  },
    { label: '近一年',   w: 66,  align: 'right'  },
    { label: '跟踪差',   w: 58,  align: 'right'  },
    { label: '每日限额', w: 86,  align: 'right'  },
    { label: '申购',    w: 56,  align: 'center' },
  ];
  var dataRows = rows.map(function(f) {
    var ytd  = f.ytd_return;
    var open = f.buy_status === 'open';
    return [
      { v: f.code,     color: C.azure, bold: true },
      { v: f.name,     color: C.text,  bold: false },
      { v: f.fee_rate != null ? f.fee_rate + '%' : '—', color: C.muted },
      { v: f.scale    != null ? f.scale    + '' : '—',  color: C.muted },
      { v: ytd != null ? (ytd >= 0 ? '+' : '') + ytd.toFixed(2) + '%' : '—',
        color: ytd != null ? (ytd >= 0 ? C.green : C.red) : C.muted },
      { v: f.track_error != null ? f.track_error + '%' : '—', color: C.muted },
      { v: f.daily_limit || '—', color: C.orange },
      { v: open ? '可申购' : '暂停', badge: true, badgeW: open ? 44 : 38,
        badgeBg: open ? C.greenBg : C.grayBg,
        badgeColor: open ? C.green : C.gray },
    ];
  });
  return { title: '纳指被动基金对比', date: date, cols: cols, rows: dataRows };
}

function buildSp500Config(rows, date) {
  var cols = [
    { label: '代码',    w: 66,  align: 'left'   },
    { label: '基金名称', w: 200, align: 'left'   },
    { label: '费率',    w: 50,  align: 'right'  },
    { label: '规模(亿)', w: 58,  align: 'right'  },
    { label: '近一年',   w: 66,  align: 'right'  },
    { label: '跟踪差',   w: 58,  align: 'right'  },
    { label: '每日限额', w: 86,  align: 'right'  },
    { label: '申购',    w: 56,  align: 'center' },
  ];
  var dataRows = rows.map(function(f) {
    var ytd  = f.ytd_return;
    var open = f.buy_status === 'open';
    return [
      { v: f.code,     color: C.azure, bold: true },
      { v: f.name,     color: C.text,  bold: false },
      { v: f.fee_rate != null ? f.fee_rate + '%' : '—', color: C.muted },
      { v: f.scale    != null ? f.scale    + '' : '—',  color: C.muted },
      { v: ytd != null ? (ytd >= 0 ? '+' : '') + ytd.toFixed(2) + '%' : '—',
        color: ytd != null ? (ytd >= 0 ? C.green : C.red) : C.muted },
      { v: f.track_error != null ? f.track_error + '%' : '—', color: C.muted },
      { v: f.daily_limit || '—', color: C.orange },
      { v: open ? '可申购' : '暂停', badge: true, badgeW: open ? 44 : 38,
        badgeBg: open ? C.greenBg : C.grayBg,
        badgeColor: open ? C.green : C.gray },
    ];
  });
  return { title: '标普500被动基金对比', date: date, cols: cols, rows: dataRows };
}

function buildActiveConfig(rows, date) {
  var cols = [
    { label: '代码',    w: 66,  align: 'left'   },
    { label: '基金名称', w: 214, align: 'left'   },
    { label: '费率',    w: 50,  align: 'right'  },
    { label: '规模(亿)', w: 60,  align: 'right'  },
    { label: '近一年',   w: 66,  align: 'right'  },
    { label: '每日限额', w: 90,  align: 'right'  },
    { label: '申购',    w: 54,  align: 'center' },
  ];
  var dataRows = rows.map(function(f) {
    var ytd  = f.ytd_return;
    var open = f.buy_status === 'open';
    return [
      { v: f.code,     color: C.azure, bold: true },
      { v: f.name,     color: C.text,  bold: false },
      { v: f.fee_rate != null ? f.fee_rate + '%' : '—', color: C.muted },
      { v: f.scale    != null ? f.scale    + '' : '—',  color: C.muted },
      { v: ytd != null ? (ytd >= 0 ? '+' : '') + ytd.toFixed(2) + '%' : '—',
        color: ytd != null ? (ytd >= 0 ? C.green : C.red) : C.muted },
      { v: f.daily_limit || '—', color: C.orange },
      { v: open ? '可申购' : '暂停', badge: true, badgeW: open ? 44 : 38,
        badgeBg: open ? C.greenBg : C.grayBg,
        badgeColor: open ? C.green : C.gray },
    ];
  });
  return { title: '美股主动型基金对比', date: date, cols: cols, rows: dataRows };
}

function buildEtfConfig(rows, date) {
  var cols = [
    { label: '代码',    w: 68,  align: 'left'   },
    { label: 'ETF名称', w: 188, align: 'left'   },
    { label: '近一年',   w: 66,  align: 'right'  },
    { label: '溢价率',   w: 66,  align: 'right'  },
    { label: '费率',    w: 48,  align: 'right'  },
    { label: '规模(亿)', w: 60,  align: 'right'  },
    { label: '成交额(亿)',w: 62,  align: 'right'  },
    { label: '跟踪指数', w: 82,  align: 'left'   },
  ];
  var dataRows = rows.map(function(f) {
    var ytd  = f.ytd_return;
    var prem = f.premium;
    var premColor = prem != null ? (prem >= 5 ? C.red : prem >= 3 ? C.orange : C.green) : C.muted;
    return [
      { v: f.code,    color: C.azure, bold: true },
      { v: f.name,    color: C.text,  bold: false },
      { v: ytd  != null ? (ytd  >= 0 ? '+' : '') + ytd.toFixed(2)  + '%' : '—',
        color: ytd != null ? (ytd >= 0 ? C.green : C.red) : C.muted },
      { v: prem != null ? prem.toFixed(2) + '%' : '—', color: premColor },
      { v: f.fee_rate  != null ? f.fee_rate  + '%' : '—', color: C.muted },
      { v: f.scale     != null ? f.scale     + ''  : '—', color: C.muted },
      { v: f.volume    != null ? f.volume    + ''  : '—', color: C.muted },
      { v: f.tracking_index || '—', color: C.muted },
    ];
  });
  return { title: '场内ETF溢价对比', date: date, cols: cols, rows: dataRows };
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
        nasdaq: (nd.value  && nd.value.data  && nd.value.data.length  ? nd.value.data  : FALLBACK.nasdaq_passive),
        sp500:  (sp.value  && sp.value.data  && sp.value.data.length  ? sp.value.data  : FALLBACK.sp500_passive),
        active: (ac.value  && ac.value.data  && ac.value.data.length  ? ac.value.data  : FALLBACK.us_active),
        etfs:   (etf.value && etf.value.data && etf.value.data.length ? etf.value.data : FALLBACK.etfs),
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

  _byLimit(arr) {
    if (!arr || !arr.length) return [];
    var parse = function(s) {
      if (!s || s === '暂停申购') return 0;
      if (s === '不限额') return 9999999;
      return parseFloat(s) || 0;
    };
    return arr.slice().sort(function(a, b) { return parse(b.daily_limit) - parse(a.daily_limit); });
  },

  async generateAll() {
    if (!this._fundData || !this._fundData.nasdaq) {
      this._showToast('数据加载中，请稍后再试', false);
      return;
    }
    this.setData({ generating: true, images: [] });

    var d   = new Date();
    var mon = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    var date = d.getFullYear() + '.' + mon + '.' + day;

    var nasdaq = this._fundData.nasdaq || [];
    var sp500  = this._fundData.sp500  || [];
    var active = this._fundData.active || [];
    var etfs   = this._fundData.etfs   || [];

    var tasks = [
      { title: '纳指被动基金',   cfg: buildNasdaqConfig(this._byLimit(nasdaq), date), id: 'canvas-nasdaq' },
      { title: '标普500基金',    cfg: buildSp500Config(this._byLimit(sp500),   date), id: 'canvas-sp500'  },
      { title: '场内ETF对比',    cfg: buildEtfConfig(etfs.slice().sort(function(a,b){ return (b.scale||0)-(a.scale||0); }), date), id: 'canvas-etf' },
      { title: '美股主动型基金', cfg: buildActiveConfig(this._byLimit(active), date), id: 'canvas-active' },
    ];

    var images = [];
    for (var i = 0; i < tasks.length; i++) {
      var task = tasks[i];
      try {
        var tempFilePath = await this._drawAndExport(task.id, task.cfg);
        images.push({ title: task.title, tempFilePath: tempFilePath, color: CAT_COLORS[task.id] });
      } catch (e) {
        console.error('[export]', task.title, e);
      }
    }

    this.setData({ images: images, generating: false });
    if (images.length > 0) {
      this._showToast('已生成 ' + images.length + ' 张，点击保存', true);
    }
  },

  _drawAndExport(canvasId, cfg) {
    return new Promise(function(resolve, reject) {
      var query = wx.createSelectorQuery();
      query.select('#' + canvasId)
        .fields({ node: true, size: true })
        .exec(function(res) {
          if (!res[0] || !res[0].node) {
            return reject(new Error('canvas not found: ' + canvasId));
          }
          var canvas = res[0].node;
          drawExportCanvas(canvas, cfg);
          wx.canvasToTempFilePath({
            canvas:  canvas,
            success: function(r) { resolve(r.tempFilePath); },
            fail:    reject,
          });
        });
    });
  },

  saveImage(e) {
    var path = e.currentTarget.dataset.path;
    var self = this;
    wx.saveImageToPhotosAlbum({
      filePath: path,
      success: function() { self._showToast('已保存到相册', true); },
      fail: function(err) {
        if (err.errMsg && err.errMsg.indexOf('auth deny') !== -1) {
          wx.openSetting();
        } else {
          self._showToast('保存失败', false);
        }
      },
    });
  },

  saveAll() {
    var images = this.data.images;
    var saved  = 0;
    var self   = this;
    images.forEach(function(img) {
      wx.saveImageToPhotosAlbum({
        filePath: img.tempFilePath,
        success: function() {
          saved++;
          if (saved === images.length) self._showToast('全部保存到相册', true);
        },
        fail: function() { self._showToast('保存失败，请检查相册权限', false); },
      });
    });
  },

  _showToast(msg, ok) {
    this.setData({ toast: { msg: msg, ok: ok } });
    setTimeout(() => this.setData({ toast: null }), 2500);
  },
});
