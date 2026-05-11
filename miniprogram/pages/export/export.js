// pages/export/export.js — 对标 web _drawFundExportCanvas 设计
const api      = require('../../utils/api');
const FALLBACK = require('../../utils/fallback');

const F = '"PingFang SC","Microsoft YaHei",Helvetica,Arial,sans-serif';

// ── 辅助：圆角矩形 ────────────────────────────────────────────────────────────
function _rr(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x+r,y); c.lineTo(x+w-r,y); c.arcTo(x+w,y,x+w,y+r,r);
  c.lineTo(x+w,y+h-r); c.arcTo(x+w,y+h,x+w-r,y+h,r);
  c.lineTo(x+r,y+h); c.arcTo(x,y+h,x,y+h-r,r);
  c.lineTo(x,y+r); c.arcTo(x,y,x+r,y,r);
  c.closePath();
}

// ── 辅助：文字截断 ────────────────────────────────────────────────────────────
function _fit(c, v, maxW) {
  if (v == null) return '—';
  var s = String(v);
  if (c.measureText(s).width <= maxW) return s;
  var t = s;
  while (t.length > 1 && c.measureText(t+'…').width > maxW) t = t.slice(0,-1);
  return t + '…';
}

// ── 核心绘制函数（直接移植 web _drawFundExportCanvas）────────────────────────
function drawExportCanvas(canvas, cfg) {
  var titleParts = cfg.titleParts;
  var colors     = cfg.colors;
  var cols       = cfg.cols;
  var rows       = cfg.rows;
  var date       = cfg.date;

  var W = 750, SC = 2, PX = 22;
  var BRAND_H = 54, TITLE_H = 88, COL_H = 42, FOOT_H = 96;
  var FIXED = BRAND_H + TITLE_H + COL_H + FOOT_H;
  // 动态行高：确保所有行填满合理高度（对标 web 固定 H=1600 的 RH 计算）
  var RH = Math.floor(Math.max(38, Math.min(60, (1100 - FIXED) / Math.max(rows.length, 1))));
  var FS = RH / 54;
  function fs(n) { return Math.round(n * FS) + 'px'; }
  var H = FIXED + RH * rows.length;

  canvas.width  = W * SC;
  canvas.height = H * SC;
  var c = canvas.getContext('2d');
  c.scale(SC, SC);

  // ── 背景 (#f0f4ff) + 点阵 ──
  c.fillStyle = '#f0f4ff';
  c.fillRect(0, 0, W, H);
  c.fillStyle = 'rgba(29,78,216,0.05)';
  for (var dy = 7; dy < H; dy += 14) {
    for (var dx = 7; dx < W; dx += 14) {
      c.beginPath(); c.arc(dx, dy, 1.1, 0, Math.PI*2); c.fill();
    }
  }

  // ── 顶部渐变条（10px）──
  var ag = c.createLinearGradient(0, 0, W, 0);
  for (var i=0; i<colors.topBar.length; i++) ag.addColorStop(colors.topBar[i][0], colors.topBar[i][1]);
  c.fillStyle = ag; c.fillRect(0, 0, W, 10);

  // ── 品牌 header（#e8eeff）──
  c.fillStyle = '#e8eeff'; c.fillRect(0, 10, W, BRAND_H-10);
  var brandY = Math.round(BRAND_H/2 + 5);
  c.textBaseline = 'middle';
  c.font = 'bold '+fs(28)+' '+F; c.fillStyle = colors.primary;
  c.fillText('Wise', PX, brandY);
  var wW = c.measureText('Wise').width;
  c.fillStyle = colors.secondary; c.fillText('ETF', PX+wW, brandY);
  var eW = c.measureText('ETF').width;
  c.font = fs(15)+' '+F; c.fillStyle = '#475569';
  c.fillText('  @WiseInvest 整理', PX+wW+eW, brandY);

  // ── 标题区（白底）──
  c.fillStyle = '#ffffff'; c.fillRect(0, BRAND_H, W, TITLE_H);
  // 左侧竖条渐变
  var lsg = c.createLinearGradient(0, BRAND_H, 0, BRAND_H+TITLE_H);
  lsg.addColorStop(0, colors.primary); lsg.addColorStop(1, colors.accent);
  c.fillStyle = lsg; c.fillRect(0, BRAND_H, 6, TITLE_H);
  // 大标题（多色分段）
  var ttx = PX+14;
  var TY  = BRAND_H + Math.round(TITLE_H*0.52);
  c.textBaseline = 'middle';
  c.font = 'bold '+fs(44)+' '+F;
  for (var pi=0; pi<titleParts.length; pi++) {
    c.fillStyle = titleParts[pi].color;
    c.fillText(titleParts[pi].text, ttx, TY);
    ttx += c.measureText(titleParts[pi].text).width;
  }
  // 日期（品牌蓝）
  c.font = 'bold '+fs(30)+' '+F; c.fillStyle = colors.primary;
  c.fillText('  '+date, ttx, TY);
  // 副标题
  c.font = fs(14)+' '+F; c.fillStyle = '#64748b';
  c.fillText('数据仅供参考，不构成投资建议', PX+14, BRAND_H+Math.round(TITLE_H*0.82));

  // ── 列宽缩放（对标 web colSc=(W-PX*2)/totalColW）──
  var totalColW = 0;
  for (var ci=0; ci<cols.length; ci++) totalColW += cols[ci].w;
  var colSc = (W - PX*2) / totalColW;
  var sCols = [], xp = [], cx = PX;
  for (var ci2=0; ci2<cols.length; ci2++) {
    sCols.push({ key: cols[ci2].key, label: cols[ci2].label, w: cols[ci2].w*colSc, align: cols[ci2].align });
    xp.push(cx); cx += cols[ci2].w*colSc;
  }

  // ── 表头（渐变）──
  var tableY = BRAND_H + TITLE_H;
  var hg = c.createLinearGradient(0, tableY, W, tableY);
  hg.addColorStop(0, colors.headerDark); hg.addColorStop(1, colors.primary);
  c.fillStyle = hg; c.fillRect(0, tableY, W, COL_H);
  c.font = 'bold '+fs(16)+' '+F; c.textBaseline = 'middle';
  for (var chi=0; chi<sCols.length; chi++) {
    var col = sCols[chi];
    c.fillStyle = '#e8f0ff';
    c.textAlign = col.align;
    var tx = col.align==='right' ? xp[chi]+col.w-10
           : col.align==='center' ? xp[chi]+col.w/2
           : xp[chi]+10;
    c.fillText(col.label, tx, tableY+COL_H/2);
  }
  c.textAlign = 'left';

  // ── 数据行 ──
  for (var ri=0; ri<rows.length; ri++) {
    var row = rows[ri];
    var ry  = tableY + COL_H + ri*RH;
    // 交替行背景
    c.fillStyle = ri%2===0 ? '#ffffff' : colors.rowAlt;
    c.fillRect(0, ry, W, RH);
    // 左侧彩条（偶数行/奇数行两种色）
    c.fillStyle = ri%2===0 ? colors.rowAccent1 : colors.rowAccent2;
    c.fillRect(0, ry, 4, RH);
    // 分隔线
    c.strokeStyle = colors.rowBorder; c.lineWidth = 0.6;
    c.beginPath(); c.moveTo(0,ry+RH); c.lineTo(W,ry+RH); c.stroke();

    var tyR = ry + RH/2;
    for (var rci=0; rci<sCols.length; rci++) {
      var rcol = sCols[rci];
      var v    = row[rcol.key];
      var rtx  = rcol.align==='right' ? xp[rci]+rcol.w-10
               : rcol.align==='center' ? xp[rci]+rcol.w/2
               : xp[rci]+10;
      c.textBaseline = 'middle'; c.textAlign = rcol.align;

      switch (rcol.key) {
        case 'code':
          c.font='bold '+fs(18)+' '+F; c.fillStyle=colors.primary;
          c.fillText(v||'—', rtx, tyR); break;
        case 'name': case 'etf_name':
          c.font=fs(16)+' '+F; c.fillStyle='#111827';
          c.fillText(_fit(c, v||'—', rcol.w-14), rtx, tyR); break;
        case 'fee_rate':
          c.font='bold '+fs(16)+' '+F;
          c.fillStyle = v>1 ? '#c2410c' : '#1e3a5f';
          c.fillText(v!=null ? v+'%' : '—', rtx, tyR); break;
        case 'scale':
          c.font='bold '+fs(16)+' '+F; c.fillStyle='#1e3a5f';
          c.fillText(v!=null ? String(v) : '—', rtx, tyR); break;
        case 'rolling_1y': {
          var n = v!=null ? parseFloat(v) : null;
          c.font='bold '+fs(17)+' '+F;
          c.fillStyle = n!=null ? (n>0?'#15803d':'#b91c1c') : '#9ca3af';
          c.fillText(n!=null ? (n>0?'+':'')+n.toFixed(1)+'%' : '—', rtx, tyR); break;
        }
        case 'daily_limit':
          c.font=fs(15)+' '+F; c.fillStyle='#334155';
          c.fillText(_fit(c, v||'—', rcol.w-12), rtx, tyR); break;
        case 'buy_status': {
          var isOpen = v==='open';
          var pW=Math.round(56*FS), pH=Math.round(26*FS);
          var px2=xp[rci]+(rcol.w-pW)/2, py2=ry+(RH-pH)/2;
          _rr(c,px2,py2,pW,pH,pH/2);
          c.fillStyle=isOpen?'#dcfce7':'#f1f5f9'; c.fill();
          c.strokeStyle=isOpen?'#16a34a':'#d1d5db'; c.lineWidth=1.2;
          _rr(c,px2,py2,pW,pH,pH/2); c.stroke();
          c.font='bold '+fs(13)+' '+F;
          c.fillStyle=isOpen?'#15803d':'#6b7280';
          c.textAlign='center';
          c.fillText(isOpen?'✓ 可申购':'暂停', px2+pW/2, ry+RH/2); break;
        }
        case 'track_error':
          c.font=fs(15)+' '+F;
          c.fillStyle = v>2?'#c2410c':v>1?'#b45309':'#475569';
          c.fillText(v!=null ? v+'%' : '—', rtx, tyR); break;
        case 'premium': {
          var pv = v!=null ? parseFloat(v) : null;
          c.font='bold '+fs(16)+' '+F;
          c.fillStyle = pv==null?'#9ca3af':pv>3?'#b91c1c':pv>1.5?'#c2410c':pv>0?'#475569':'#15803d';
          c.fillText(pv!=null ? pv.toFixed(2)+'%' : '—', rtx, tyR); break;
        }
        case 'tracking_index':
          c.font=fs(13)+' '+F; c.fillStyle='#475569';
          c.fillText(_fit(c, v||'—', rcol.w-12), rtx, tyR); break;
        case 'volume':
          c.font='bold '+fs(15)+' '+F; c.fillStyle='#1e3a5f';
          c.fillText(v!=null?String(v):'—', rtx, tyR); break;
        default:
          c.font=fs(14)+' '+F; c.fillStyle='#374151';
          c.fillText(v!=null?String(v):'—', rtx, tyR);
      }
      c.textAlign = 'left';
    }
  }

  // ── Footer（渐变，对标 web footerBar）──
  var fy = tableY + COL_H + rows.length*RH;
  var fg2 = c.createLinearGradient(0, 0, W, 0);
  for (var fbi=0; fbi<colors.footerBar.length; fbi++) fg2.addColorStop(colors.footerBar[fbi][0], colors.footerBar[fbi][1]);
  c.fillStyle = fg2; c.fillRect(0, fy, W, FOOT_H);

  var midY = fy + FOOT_H/2;
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.font = 'bold '+fs(22)+' '+F; c.fillStyle = '#ffffff';
  c.fillText('@WiseInvest', W/2, midY - 14);
  c.font = fs(13)+' '+F; c.fillStyle = 'rgba(255,255,255,0.75)';
  c.fillText('以上平台同名  ·  WiseETF 小程序', W/2, midY + 6);
  c.font = fs(11)+' '+F; c.fillStyle = 'rgba(255,255,255,0.45)';
  c.fillText('数据仅供参考，不构成投资建议', W/2, midY + 24);
  // 右侧日期
  c.textAlign = 'right';
  c.font = 'bold '+fs(18)+' '+F; c.fillStyle = '#ffffff';
  c.fillText(date, W-PX, midY);
  c.textAlign = 'left';

  return canvas;
}

// ── 各类型配置（对标 web drawNasdaqExportCanvas 等）────────────────────────
function buildNasdaqConfig(rows, date) {
  return {
    titleParts: [
      {text:'场外 ',color:'#111827'},
      {text:'纳斯达克100',color:'#d44f00'},
      {text:' 被动型基金',color:'#111827'},
    ],
    colors: {
      topBar:    [[0,'#1533cc'],[0.5,'#7c22d4'],[1,'#d44f00']],
      primary:   '#1533cc', secondary:'#7c22d4', accent:'#d44f00',
      headerDark:'#0f2499',
      rowAlt:'#dde8ff', rowAccent1:'#c5d8ff', rowAccent2:'#a8c4f8', rowBorder:'#b8c8f0',
      footerBar: [[0,'#1533cc'],[1,'#7c22d4']],
    },
    cols: [
      {key:'code',        label:'代码',    w:70,  align:'left'},
      {key:'name',        label:'基金名称',w:220, align:'left'},
      {key:'fee_rate',    label:'费率',    w:66,  align:'right'},
      {key:'scale',       label:'规模(亿)',w:68,  align:'right'},
      {key:'rolling_1y',  label:'近1年',   w:80,  align:'right'},
      {key:'track_error', label:'跟踪差',  w:68,  align:'right'},
      {key:'daily_limit', label:'申购上限',w:88,  align:'right'},
      {key:'buy_status',  label:'申购状态',w:76,  align:'center'},
    ],
    rows: rows.map(function(f) {
      return { code:f.code, name:f.name, fee_rate:f.fee_rate, scale:f.scale,
               rolling_1y:f.ytd_return, track_error:f.track_error,
               daily_limit:f.daily_limit, buy_status:f.buy_status };
    }),
    date: date,
  };
}

function buildSp500Config(rows, date) {
  var cfg = buildNasdaqConfig(rows, date);
  cfg.titleParts = [
    {text:'场外 ',color:'#111827'},
    {text:'标普500',color:'#0284c7'},
    {text:' 被动型基金',color:'#111827'},
  ];
  cfg.colors = {
    topBar:    [[0,'#0369a1'],[0.5,'#0891b2'],[1,'#059669']],
    primary:   '#0369a1', secondary:'#0891b2', accent:'#059669',
    headerDark:'#024d7d',
    rowAlt:'#e0f2fe', rowAccent1:'#bae6fd', rowAccent2:'#7dd3fc', rowBorder:'#a5d8f5',
    footerBar: [[0,'#0369a1'],[1,'#0891b2']],
  };
  return cfg;
}

function buildActiveConfig(rows, date) {
  return {
    titleParts: [
      {text:'美股 ',color:'#111827'},
      {text:'主动型基金',color:'#7c3aed'},
      {text:' 对比',color:'#111827'},
    ],
    colors: {
      topBar:    [[0,'#6d28d9'],[0.5,'#a855f7'],[1,'#ec4899']],
      primary:   '#6d28d9', secondary:'#a855f7', accent:'#ec4899',
      headerDark:'#4c1d95',
      rowAlt:'#f3e8ff', rowAccent1:'#ddd6fe', rowAccent2:'#c4b5fd', rowBorder:'#d8b4fe',
      footerBar: [[0,'#6d28d9'],[1,'#a855f7']],
    },
    cols: [
      {key:'code',       label:'代码',    w:70,  align:'left'},
      {key:'name',       label:'基金名称',w:240, align:'left'},
      {key:'fee_rate',   label:'费率',    w:66,  align:'right'},
      {key:'scale',      label:'规模(亿)',w:72,  align:'right'},
      {key:'rolling_1y', label:'近1年',   w:82,  align:'right'},
      {key:'daily_limit',label:'申购上限',w:96,  align:'right'},
      {key:'buy_status', label:'申购状态',w:80,  align:'center'},
    ],
    rows: rows.map(function(f) {
      return { code:f.code, name:f.name, fee_rate:f.fee_rate, scale:f.scale,
               rolling_1y:f.ytd_return, daily_limit:f.daily_limit, buy_status:f.buy_status };
    }),
    date: date,
  };
}

function buildEtfConfig(rows, date) {
  return {
    titleParts: [
      {text:'场内 ',color:'#111827'},
      {text:'ETF 溢价',color:'#d97706'},
      {text:' 对比',color:'#111827'},
    ],
    colors: {
      topBar:    [[0,'#b45309'],[0.5,'#d97706'],[1,'#f59e0b']],
      primary:   '#b45309', secondary:'#d97706', accent:'#f59e0b',
      headerDark:'#92400e',
      rowAlt:'#fef3c7', rowAccent1:'#fde68a', rowAccent2:'#fcd34d', rowBorder:'#fde68a',
      footerBar: [[0,'#b45309'],[1,'#d97706']],
    },
    cols: [
      {key:'code',          label:'代码',    w:70,  align:'left'},
      {key:'etf_name',      label:'ETF名称', w:196, align:'left'},
      {key:'rolling_1y',    label:'近1年',   w:72,  align:'right'},
      {key:'premium',       label:'溢价率',  w:72,  align:'right'},
      {key:'fee_rate',      label:'费率',    w:54,  align:'right'},
      {key:'scale',         label:'规模(亿)',w:64,  align:'right'},
      {key:'volume',        label:'成交(亿)',w:64,  align:'right'},
      {key:'tracking_index',label:'跟踪指数',w:94,  align:'left'},
    ],
    rows: rows.map(function(f) {
      return { code:f.code, etf_name:f.name, rolling_1y:f.ytd_return,
               premium:f.premium, fee_rate:f.fee_rate, scale:f.scale,
               volume:f.volume, tracking_index:f.tracking_index };
    }),
    date: date,
  };
}

// ── Page ─────────────────────────────────────────────────────────────────────
const CAT_COLORS = {
  'canvas-nasdaq': '#1533cc',
  'canvas-sp500':  '#0369a1',
  'canvas-etf':    '#d97706',
  'canvas-active': '#7c3aed',
};

Page({
  data: {
    generating: false,
    images:     [],
    toast:      null,
    categories: [
      { id:'canvas-nasdaq', name:'纳指被动', color:'#1533cc' },
      { id:'canvas-sp500',  name:'标普500',  color:'#0369a1' },
      { id:'canvas-etf',    name:'场内ETF',  color:'#d97706' },
      { id:'canvas-active', name:'美股主动', color:'#7c3aed' },
    ],
  },

  onLoad() { this._loadData(); },

  _fundData: {},

  async _loadData() {
    try {
      var results = await Promise.allSettled([
        api.getFunds('nasdaq_passive'),
        api.getFunds('sp500_passive'),
        api.getFunds('us_active'),
        api.getEtfs(),
      ]);
      var nd=results[0], sp=results[1], ac=results[2], etf=results[3];
      this._fundData = {
        nasdaq: (nd.value  && nd.value.data  && nd.value.data.length  ? nd.value.data  : FALLBACK.nasdaq_passive),
        sp500:  (sp.value  && sp.value.data  && sp.value.data.length  ? sp.value.data  : FALLBACK.sp500_passive),
        active: (ac.value  && ac.value.data  && ac.value.data.length  ? ac.value.data  : FALLBACK.us_active),
        etfs:   (etf.value && etf.value.data && etf.value.data.length ? etf.value.data : FALLBACK.etfs),
      };
    } catch (_) {
      this._fundData = {
        nasdaq: FALLBACK.nasdaq_passive, sp500: FALLBACK.sp500_passive,
        active: FALLBACK.us_active,      etfs:  FALLBACK.etfs,
      };
    }
  },

  _byLimit(arr) {
    if (!arr || !arr.length) return [];
    var parse = function(s) {
      if (!s || s==='暂停申购') return 0;
      if (s==='不限额') return 9999999;
      return parseFloat(s) || 0;
    };
    return arr.slice().sort(function(a,b){ return parse(b.daily_limit)-parse(a.daily_limit); });
  },

  async generateAll() {
    if (!this._fundData || !this._fundData.nasdaq) {
      this._showToast('数据加载中，请稍后再试', false); return;
    }
    this.setData({ generating:true, images:[] });

    var d = new Date();
    var date = d.getFullYear() + '.' + String(d.getMonth()+1).padStart(2,'0') + '.' + String(d.getDate()).padStart(2,'0');

    var nasdaq = this._fundData.nasdaq || [];
    var sp500  = this._fundData.sp500  || [];
    var active = this._fundData.active || [];
    var etfs   = this._fundData.etfs   || [];

    var tasks = [
      { title:'纳指被动基金',   cfg:buildNasdaqConfig(this._byLimit(nasdaq), date), id:'canvas-nasdaq' },
      { title:'标普500基金',    cfg:buildSp500Config(this._byLimit(sp500),   date), id:'canvas-sp500'  },
      { title:'场内ETF对比',    cfg:buildEtfConfig(etfs.slice().sort(function(a,b){return(b.scale||0)-(a.scale||0);}), date), id:'canvas-etf' },
      { title:'美股主动型基金', cfg:buildActiveConfig(this._byLimit(active), date), id:'canvas-active' },
    ];

    var images = [];
    for (var i=0; i<tasks.length; i++) {
      var task = tasks[i];
      try {
        var tempFilePath = await this._drawAndExport(task.id, task.cfg);
        images.push({ title:task.title, tempFilePath:tempFilePath, color:CAT_COLORS[task.id] });
      } catch(e) { console.error('[export]', task.title, e); }
    }

    this.setData({ images:images, generating:false });
    if (images.length > 0) this._showToast('已生成 '+images.length+' 张，点击保存', true);
  },

  _drawAndExport(canvasId, cfg) {
    return new Promise(function(resolve, reject) {
      wx.createSelectorQuery().select('#'+canvasId)
        .fields({ node:true, size:true })
        .exec(function(res) {
          if (!res[0] || !res[0].node) return reject(new Error('canvas not found: '+canvasId));
          var canvas = res[0].node;
          drawExportCanvas(canvas, cfg);
          wx.canvasToTempFilePath({
            canvas: canvas,
            success: function(r){ resolve(r.tempFilePath); },
            fail: reject,
          });
        });
    });
  },

  saveImage(e) {
    var path = e.currentTarget.dataset.path;
    var self = this;
    wx.saveImageToPhotosAlbum({
      filePath: path,
      success: function(){ self._showToast('已保存到相册', true); },
      fail: function(err){
        if (err.errMsg && err.errMsg.indexOf('auth deny')!==-1) wx.openSetting();
        else self._showToast('保存失败', false);
      },
    });
  },

  saveAll() {
    var images = this.data.images, saved=0, self=this;
    images.forEach(function(img){
      wx.saveImageToPhotosAlbum({
        filePath: img.tempFilePath,
        success: function(){ saved++; if(saved===images.length) self._showToast('全部保存到相册',true); },
        fail: function(){ self._showToast('保存失败，请检查相册权限',false); },
      });
    });
  },

  _showToast(msg, ok) {
    this.setData({ toast:{ msg:msg, ok:ok } });
    setTimeout(()=>this.setData({ toast:null }), 2500);
  },
});
