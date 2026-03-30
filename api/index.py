"""
Wise-ETF Serverless API  v3.0
==============================
缓存策略（三层递增容错）：
  1. 内存缓存    — Lambda 热实例复用，响应 < 1ms
  2. 文件缓存    — /tmp/wise_etf_last_good.json，当天数据持久化，次日备用
  3. 静态兜底    — 代码内嵌精准数据，永不返回空

数据分层（只刷新会变动的字段）：
  不变字段: code / name / fee_rate / scale / track_error / daily_limit / tracking_index
  日更字段: ytd_return / nav / nav_date / buy_status          → 缓存 TTL 6h
  实时字段: ETF market_price / nav / premium / volume / change_pct  → 缓存 TTL 5min

定时预热（vercel.json crons）：
  UTC 02:00 / 北京 10:00 — /api/cron/refresh 预热全部缓存
"""

import json, re, logging, time, xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, wait
from datetime import datetime
from email.utils import parsedate_to_datetime
from typing import Optional, Dict, List

import requests
from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

# ─── 缓存层 ────────────────────────────────────────────────────────────────────

_MEM_CACHE: Dict[str, dict] = {}        # 热实例内存缓存
_LAST_GOOD_FILE = "/tmp/wise_etf_last_good.json"

CACHE_TTL = {
    "funds":      6 * 3600,   # 基金净值深夜更新，6h 有效
    "etfs":       5 * 60,     # ETF 溢价率盘中实时，5min 有效
    "fx_history": 6 * 3600,   # 汇率/指数历史，6h 有效
    "news":       30 * 60,    # 市场新闻，30min 缓存
}

def _mem_get(key: str, kind: str) -> Optional[list]:
    entry = _MEM_CACHE.get(key)
    if entry and (time.time() - entry["ts"]) < CACHE_TTL[kind]:
        logger.info(f"[cache:mem] hit {key}")
        return entry["data"]
    return None

def _mem_set(key: str, data: list):
    _MEM_CACHE[key] = {"data": data, "ts": time.time()}

def _file_save(key: str, data: list):
    """成功数据写入 /tmp，作为次日冷启动备用"""
    try:
        store: dict = {}
        try:
            with open(_LAST_GOOD_FILE) as f:
                store = json.load(f)
        except Exception:
            pass
        store[key] = {"data": data, "saved_at": datetime.now().isoformat()}
        with open(_LAST_GOOD_FILE, "w") as f:
            json.dump(store, f, ensure_ascii=False)
    except Exception as e:
        logger.warning(f"[cache:file] write failed: {e}")

def _file_load(key: str) -> Optional[list]:
    try:
        with open(_LAST_GOOD_FILE) as f:
            store = json.load(f)
        entry = store.get(key, {})
        data = entry.get("data")
        if data:
            logger.info(f"[cache:file] hit {key} (saved {entry.get('saved_at','')})")
        return data
    except Exception:
        return None

def _cache_set(key: str, data: list):
    """同时写内存缓存 + 文件缓存"""
    _mem_set(key, data)
    _file_save(key, data)

# ─── 静态数据（与 App.jsx FALLBACK 严格同步）─────────────────────────────────
# 这些是不变字段：费率、规模、跟踪误差、每日限额
# 动态字段（ytd_return/nav/buy_status）会被实时数据覆盖，此处为保底值

STATIC_FUNDS: Dict[str, List[dict]] = {
    "nasdaq_passive": [
        {"code":"019524","name":"华泰柏瑞纳斯达克100ETF联接(QDII)A","fee_rate":0.65,"scale":6.77,"ytd_return":20.93,"track_error":1.65,"daily_limit":"100元","buy_status":"open"},
        {"code":"019547","name":"招商纳斯达克100ETF联接(QDII)A","fee_rate":0.65,"scale":15.79,"ytd_return":20.71,"track_error":1.72,"daily_limit":"100元","buy_status":"open"},
        {"code":"539001","name":"建信纳斯达克100指数QDIIA","fee_rate":1.00,"scale":13.23,"ytd_return":20.67,"track_error":2.17,"daily_limit":"100元","buy_status":"open"},
        {"code":"018966","name":"汇添富纳斯达克100ETF联接(QDII)A","fee_rate":0.65,"scale":11.33,"ytd_return":19.22,"track_error":2.08,"daily_limit":"100元","buy_status":"open"},
        {"code":"016452","name":"南方纳斯达克100指数(QDII)A","fee_rate":0.65,"scale":33.25,"ytd_return":21.86,"track_error":1.64,"daily_limit":"50元","buy_status":"open"},
        {"code":"000834","name":"大成纳斯达克100指数(QDII)A","fee_rate":1.00,"scale":38.85,"ytd_return":21.16,"track_error":1.51,"daily_limit":"50元","buy_status":"open"},
        {"code":"019172","name":"摩根纳斯达克100指数(QDII)A","fee_rate":0.60,"scale":26.14,"ytd_return":22.19,"track_error":2.15,"daily_limit":"10元","buy_status":"open"},
        {"code":"270042","name":"广发纳斯达克100ETF联接(QDII)","fee_rate":1.00,"scale":108.44,"ytd_return":21.75,"track_error":1.10,"daily_limit":"10元","buy_status":"open"},
        {"code":"019441","name":"万家纳斯达克100指数发起式(QDII)","fee_rate":0.65,"scale":4.98,"ytd_return":21.41,"track_error":1.75,"daily_limit":"10元","buy_status":"open"},
        {"code":"161130","name":"易方达纳斯达克100ETF联接(QDII-LOF)A","fee_rate":0.60,"scale":16.11,"ytd_return":21.07,"track_error":1.55,"daily_limit":"10元","buy_status":"open"},
        {"code":"040046","name":"华安纳斯达克100指数(QDII)","fee_rate":0.80,"scale":55.20,"ytd_return":20.19,"track_error":2.06,"daily_limit":"10元","buy_status":"open"},
        {"code":"160213","name":"国泰纳斯达克100指数(QDII)","fee_rate":1.00,"scale":18.55,"ytd_return":22.37,"track_error":1.03,"daily_limit":"暂停申购","buy_status":"suspended"},
        {"code":"016055","name":"博时纳斯达克100ETF联接(QDII)A","fee_rate":0.65,"scale":15.59,"ytd_return":22.10,"track_error":1.52,"daily_limit":"暂停申购","buy_status":"suspended"},
        {"code":"018043","name":"天弘纳斯达克100指数(QDII)A","fee_rate":0.60,"scale":26.20,"ytd_return":21.92,"track_error":1.55,"daily_limit":"暂停申购","buy_status":"suspended"},
        {"code":"019736","name":"宝盈纳斯达克100指数(QDII)A","fee_rate":0.65,"scale":6.80,"ytd_return":21.72,"track_error":1.55,"daily_limit":"暂停申购","buy_status":"suspended"},
        {"code":"016532","name":"嘉实纳斯达克100联接(QDII)A","fee_rate":0.60,"scale":21.10,"ytd_return":20.82,"track_error":1.60,"daily_limit":"暂停申购","buy_status":"suspended"},
        {"code":"015299","name":"华夏纳斯达克100ETF联接(QDII)A","fee_rate":0.80,"scale":3.83,"ytd_return":18.85,"track_error":2.69,"daily_limit":"暂停申购","buy_status":"suspended"},
        {"code":"017091","name":"景顺长城纳斯达克科技市值加权ETF联接A","fee_rate":1.00,"scale":25.78,"ytd_return":28.62,"track_error":3.11,"daily_limit":"100元","buy_status":"open"},
    ],
    "sp500_passive": [
        {"code":"017641","name":"摩根标普500指数(QDII)A","fee_rate":0.65,"scale":31.56,"ytd_return":15.31,"track_error":2.57,"daily_limit":"50元","buy_status":"open"},
        {"code":"161125","name":"易方达标普500指数(QDII-LOF)A","fee_rate":1.00,"scale":14.75,"ytd_return":15.48,"track_error":2.39,"daily_limit":"10元","buy_status":"open"},
        {"code":"017028","name":"国泰标普500ETF联接(QDII)A","fee_rate":0.75,"scale":1.57,"ytd_return":16.10,"track_error":1.87,"daily_limit":"暂停申购","buy_status":"suspended"},
        {"code":"050025","name":"博时标普500ETF联接(QDII)A","fee_rate":0.80,"scale":67.56,"ytd_return":15.90,"track_error":1.31,"daily_limit":"暂停申购","buy_status":"suspended"},
        {"code":"007721","name":"天弘标普500(QDII-FOF)A","fee_rate":0.80,"scale":26.47,"ytd_return":14.84,"track_error":None,"daily_limit":"暂停申购","buy_status":"suspended"},
        {"code":"018064","name":"华夏标普500ETF联接(QDII)A","fee_rate":0.75,"scale":4.09,"ytd_return":13.34,"track_error":1.10,"daily_limit":"暂停申购","buy_status":"suspended"},
        {"code":"096001","name":"大成标普500等权重指数(QDII)A","fee_rate":1.20,"scale":6.09,"ytd_return":9.06,"track_error":1.69,"daily_limit":"50元","buy_status":"open"},
        {"code":"161128","name":"易方达标普信息科技指数(QDII-FOF)A","fee_rate":1.00,"scale":36.79,"ytd_return":26.59,"track_error":10.85,"daily_limit":"10元","buy_status":"open"},
    ],
    "us_active": [
        {"code":"100055","name":"富国全球科技互联网股票(QDII)A","fee_rate":1.40,"scale":10.24,"ytd_return":39.34,"daily_limit":"不限额","buy_status":"open"},
        {"code":"016701","name":"银华海外数字经济量化选股混合(QDII)A","fee_rate":1.40,"scale":11.21,"ytd_return":33.64,"daily_limit":"50000元","buy_status":"open"},
        {"code":"005698","name":"华夏全球科技先锋混合(QDII)","fee_rate":1.40,"scale":26.32,"ytd_return":56.71,"daily_limit":"10000元","buy_status":"open"},
        {"code":"017144","name":"华宝海外新能源汽车股票(QDII)A","fee_rate":1.40,"scale":2.56,"ytd_return":29.45,"daily_limit":"10000元","buy_status":"open"},
        {"code":"270023","name":"广发全球精选股票(QDII)A","fee_rate":1.40,"scale":104.54,"ytd_return":38.08,"daily_limit":"5000元","buy_status":"open"},
        {"code":"008253","name":"华宝致远混合(QDII)A","fee_rate":1.40,"scale":1.74,"ytd_return":52.25,"daily_limit":"3000元","buy_status":"open"},
        {"code":"017436","name":"华宝纳斯达克精选股票(QDII)A","fee_rate":1.40,"scale":46.22,"ytd_return":32.08,"daily_limit":"3000元","buy_status":"open"},
        {"code":"501312","name":"华宝海外科技股票(QDII-FOF-LOF)A","fee_rate":1.20,"scale":8.05,"ytd_return":35.09,"daily_limit":"2000元","buy_status":"open"},
        {"code":"501226","name":"长城全球新能源汽车股票(QDII-LOF)A","fee_rate":1.40,"scale":4.69,"ytd_return":53.92,"daily_limit":"1000元","buy_status":"open"},
        {"code":"006555","name":"浦银安盛全球智能科技股票(QDII)A","fee_rate":1.40,"scale":8.74,"ytd_return":47.18,"daily_limit":"500元","buy_status":"open"},
        {"code":"017730","name":"嘉实全球产业升级股票(QDII)A","fee_rate":1.40,"scale":7.22,"ytd_return":74.89,"daily_limit":"100元","buy_status":"open"},
        {"code":"006373","name":"国富全球科技互联混合(QDII)人民币A","fee_rate":1.40,"scale":24.27,"ytd_return":60.52,"daily_limit":"100元","buy_status":"open"},
        {"code":"000043","name":"嘉实美国成长股票(QDII)","fee_rate":1.40,"scale":50.13,"ytd_return":25.11,"daily_limit":"100元","buy_status":"open"},
        {"code":"012920","name":"易方达全球成长精选混合(QDII)A","fee_rate":1.40,"scale":28.25,"ytd_return":100.44,"daily_limit":"50元","buy_status":"open"},
        {"code":"539002","name":"建信新兴市场优选混合(QDII)A","fee_rate":1.40,"scale":4.64,"ytd_return":94.75,"daily_limit":"50元","buy_status":"open"},
    ],
}

# 场内ETF — 名称/tracking_index/scale/ytd_return 为稳定字段（经 fundgz 实测验证）
# market_price/nav/premium/volume/change_pct 为实时字段，由 _build_etfs 每次回填
# 静态 nav/premium 基于 2026-03-27 fundgz 数据，是合理的兜底显示值
STATIC_ETFS: List[dict] = [
    # ── 纳斯达克100 ──
    {"code":"513100","name":"国泰纳斯达克100ETF",        "tracking_index":"纳斯达克100",        "scale":220.0,"ytd_return":21.0, "market_price":1.708,"nav":1.6276,"premium":4.94,"volume":3.6, "change_pct":0.0,"fee_rate":0.80,"track_error":1.07},
    {"code":"513110","name":"华泰柏瑞纳斯达克100ETF",     "tracking_index":"纳斯达克100",        "scale":85.0, "ytd_return":21.0, "market_price":1.933,"nav":1.8710,"premium":3.32,"volume":1.5, "change_pct":0.0,"fee_rate":1.00,"track_error":1.04},
    {"code":"159941","name":"广发纳斯达克100ETF",         "tracking_index":"纳斯达克100",        "scale":200.0,"ytd_return":21.1, "market_price":1.276,"nav":1.2228,"premium":4.35,"volume":7.8, "change_pct":0.0,"fee_rate":1.00,"track_error":1.03},
    {"code":"513300","name":"华夏纳斯达克100ETF(QDII)",   "tracking_index":"纳斯达克100",        "scale":45.0, "ytd_return":20.9, "market_price":2.106,"nav":2.0302,"premium":3.73,"volume":3.1, "change_pct":0.0,"fee_rate":0.80,"track_error":2.53},
    {"code":"159659","name":"招商纳斯达克100ETF(QDII)",   "tracking_index":"纳斯达克100",        "scale":120.0,"ytd_return":21.3, "market_price":1.815,"nav":1.7516,"premium":3.62,"volume":1.3, "change_pct":0.0,"fee_rate":0.65,"track_error":1.08},
    {"code":"159632","name":"华安纳斯达克100ETF(QDII)",   "tracking_index":"纳斯达克100",        "scale":85.0, "ytd_return":21.0, "market_price":1.907,"nav":1.8467,"premium":3.27,"volume":1.9, "change_pct":0.0,"fee_rate":0.80,"track_error":1.24},
    # ── 纳斯达克科技市值加权 ──
    {"code":"159509","name":"景顺长城纳斯达克科技ETF(QDII)","tracking_index":"纳斯达克科技市值加权","scale":160.0,"ytd_return":28.0,"market_price":1.962,"nav":1.6780,"premium":16.9,"volume":5.3, "change_pct":0.0,"fee_rate":1.00,"track_error":1.88},
    # ── 标普500 ──
    {"code":"513500","name":"博时标普500ETF",             "tracking_index":"标普500",            "scale":95.0, "ytd_return":15.8, "market_price":2.209,"nav":2.1132,"premium":4.54,"volume":2.3, "change_pct":0.0,"fee_rate":0.80,"track_error":1.07},
    {"code":"159612","name":"国泰标普500ETF(QDII)",       "tracking_index":"标普500",            "scale":55.0, "ytd_return":15.4, "market_price":1.735,"nav":1.6582,"premium":4.63,"volume":0.1, "change_pct":0.0,"fee_rate":0.75,"track_error":1.01},
    {"code":"513650","name":"南方标普500ETF(QDII)",       "tracking_index":"标普500",            "scale":45.0, "ytd_return":15.5, "market_price":1.661,"nav":1.6117,"premium":3.06,"volume":1.0, "change_pct":0.0,"fee_rate":0.75,"track_error":1.05},
]

# 汇率/指数月度静态数据（Yahoo Finance 被墙时的兜底，来源：Wind / Bloomberg 公开数据）
STATIC_FX_HISTORY = [
    {"month":"2015-01","usdcny":6.2078,"ndx_close":4100, "spx_close":2028},
    {"month":"2015-06","usdcny":6.2097,"ndx_close":4458, "spx_close":2063},
    {"month":"2015-12","usdcny":6.4936,"ndx_close":4593, "spx_close":2044},
    {"month":"2016-06","usdcny":6.6448,"ndx_close":4457, "spx_close":2099},
    {"month":"2016-12","usdcny":6.9448,"ndx_close":4863, "spx_close":2239},
    {"month":"2017-06","usdcny":6.7744,"ndx_close":5897, "spx_close":2423},
    {"month":"2017-12","usdcny":6.5063,"ndx_close":6455, "spx_close":2674},
    {"month":"2018-06","usdcny":6.6166,"ndx_close":7066, "spx_close":2718},
    {"month":"2018-12","usdcny":6.8775,"ndx_close":6192, "spx_close":2507},
    {"month":"2019-06","usdcny":6.8650,"ndx_close":7505, "spx_close":2942},
    {"month":"2019-12","usdcny":6.9762,"ndx_close":8733, "spx_close":3231},
    {"month":"2020-06","usdcny":7.0721,"ndx_close":9946, "spx_close":3100},
    {"month":"2020-12","usdcny":6.5249,"ndx_close":12888,"spx_close":3756},
    {"month":"2021-06","usdcny":6.4601,"ndx_close":14504,"spx_close":4298},
    {"month":"2021-12","usdcny":6.3726,"ndx_close":16320,"spx_close":4766},
    {"month":"2022-06","usdcny":6.6981,"ndx_close":11378,"spx_close":3785},
    {"month":"2022-12","usdcny":6.8972,"ndx_close":10939,"spx_close":3840},
    {"month":"2023-06","usdcny":7.2258,"ndx_close":14857,"spx_close":4450},
    {"month":"2023-12","usdcny":7.1001,"ndx_close":16825,"spx_close":4770},
    {"month":"2024-06","usdcny":7.2672,"ndx_close":19685,"spx_close":5460},
    {"month":"2024-12","usdcny":7.2996,"ndx_close":21204,"spx_close":5882},
    {"month":"2025-03","usdcny":7.2515,"ndx_close":19480,"spx_close":5612},
    {"month":"2025-06","usdcny":7.1680,"ndx_close":21900,"spx_close":5970},
    {"month":"2025-12","usdcny":7.0059,"ndx_close":21204,"spx_close":5882},
]

# ─── 请求头 ────────────────────────────────────────────────────────────────────

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Referer": "http://fund.eastmoney.com/",
}

YF_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json,text/plain,*/*",
}

# ─── HTTP 工具 ─────────────────────────────────────────────────────────────────

def _get(url, **kwargs) -> Optional[requests.Response]:
    """安全 GET：2s 建连超时 + 4s 读取超时，被墙时快速失败"""
    try:
        return requests.get(url, timeout=kwargs.pop("timeout", (2, 4)), **kwargs)
    except Exception as e:
        logger.warning(f"GET {url[:60]}: {e}")
        return None

# ─── 数据抓取 ──────────────────────────────────────────────────────────────────

def fetch_fund_realtime(code: str) -> dict:
    """天天基金实时估值（JSONP）"""
    resp = _get(f"http://fundgz.1234567.com.cn/js/{code}.js", headers=HEADERS)
    if resp and resp.ok:
        m = re.search(r"jsonpgz\((.+)\)", resp.text)
        if m:
            try:
                return json.loads(m.group(1))
            except Exception:
                pass
    return {}


def fetch_fund_performance(code: str) -> list:
    """东方财富基金近1年涨幅"""
    url = "https://fundmobapi.eastmoney.com/FundMNewApi/FundMNPeriodIncrease"
    resp = _get(url, params={"FCODE": code, "deviceid": "wise-etf",
                              "plat": "Wap", "product": "EFund", "version": "6.5.0"},
                headers=HEADERS)
    if resp and resp.ok:
        try:
            d = resp.json()
            if d.get("ErrCode") == 0:
                return d.get("Datas", [])
        except Exception:
            pass
    return []


# 只包含会变动的字段（静态字段 fee_rate/scale/track_error/daily_limit 由调用方保留）
_VOLATILE_FUND_FIELDS = {"nav", "nav_date", "buy_status", "ytd_return"}


def fetch_one_fund(code: str, category: str) -> Optional[dict]:
    realtime = fetch_fund_realtime(code)
    name     = realtime.get("name", "")
    if not name:
        return None

    perf = fetch_fund_performance(code)
    ytd_return = 0.0
    for p in (perf if isinstance(perf, list) else []):
        if p.get("title") == "近1年":
            try:
                ytd_return = float(p.get("syl", 0))
            except Exception:
                pass
            break

    gszzl      = realtime.get("gszzl", "")
    buy_status = "suspended" if gszzl == "-" else "open"

    result: dict = {
        "code":       code,
        "nav":        float(realtime.get("dwjz", 0)),
        "nav_date":   realtime.get("jzrq", ""),
        "buy_status": buy_status,
    }
    # ytd_return = 0 说明接口未返回，不覆盖静态保底值
    if ytd_return != 0:
        result["ytd_return"] = ytd_return
    return result


_SINA_HEADERS = {
    "User-Agent": HEADERS["User-Agent"],
    "Referer":    "http://finance.sina.com.cn/",
}

def fetch_etfs_sina_batch(codes: List[str]) -> Dict[str, dict]:
    """
    新浪财经批量行情（单次请求，GBK 编码）。
    返回 {code: {market_price, volume, change_pct}}
    字段定义：昨收[1], 今开[2], 现价[3], 最高[4], 最低[5],
              成交量(股)[8], 成交额(元)[9]
    """
    def _prefix(c: str) -> str:
        return "sh" if c.startswith("5") else "sz"

    symbols = ",".join(f"{_prefix(c)}{c}" for c in codes)
    resp    = _get(f"http://hq.sinajs.cn/list={symbols}",
                   headers=_SINA_HEADERS, timeout=(2, 6))
    if not (resp and resp.ok):
        return {}
    try:
        text = resp.content.decode("gbk", errors="ignore")
    except Exception:
        text = resp.text

    result: Dict[str, dict] = {}
    for line in text.split("\n"):
        m = re.search(r'hq_str_\w{2}(\d{6})="([^"]+)"', line)
        if not m:
            continue
        code, data = m.group(1), m.group(2)
        parts = data.split(",")
        if len(parts) < 10:
            continue
        try:
            prev_close = float(parts[1])
            curr_price = float(parts[3])
            volume_cny = float(parts[9])      # 成交额（元）
            if curr_price <= 0:
                continue
            change_pct = round((curr_price - prev_close) / prev_close * 100, 2) \
                         if prev_close > 0 else 0.0
            result[code] = {
                "market_price": curr_price,
                "volume":       round(volume_cny / 1e8, 2),   # 转换为亿
                "change_pct":   change_pct,
            }
        except Exception:
            continue
    logger.info(f"[sina] got {len(result)}/{len(codes)} ETFs")
    return result


def _yf_monthly(symbol: str) -> dict:
    url  = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
    resp = _get(url, params={"interval": "1mo", "range": "11y"},
                headers=YF_HEADERS, timeout=(4, 20))
    if not (resp and resp.ok):
        raise ConnectionError(f"Yahoo Finance unavailable for {symbol}")
    res    = resp.json()["chart"]["result"][0]
    closes = res["indicators"]["quote"][0]["close"]
    return {
        datetime.utcfromtimestamp(ts).strftime("%Y-%m"): close
        for ts, close in zip(res["timestamp"], closes)
        if close is not None
    }

# ─── 核心数据构建（可被 cron 直接调用）────────────────────────────────────────

def _build_funds(category: str) -> tuple:
    """并发抓取基金日更数据，返回 (results, source)"""
    static = STATIC_FUNDS.get(category, [])
    if not static:
        return [], "empty"

    codes = [f["code"] for f in static]
    live_map: Dict[str, dict] = {}

    with ThreadPoolExecutor(max_workers=10) as ex:
        fs = {ex.submit(fetch_one_fund, code, category): code for code in codes}
        done, _ = wait(fs, timeout=8)       # 整批最多等 8 秒
        for fut in done:
            try:
                item = fut.result()
                if item:
                    live_map[item["code"]] = item
            except Exception:
                pass

    success_rate = len(live_map) / len(codes)
    logger.info(f"[{category}] {len(live_map)}/{len(codes)} live ({success_rate:.0%})")

    # 静态字段打底，实时字段覆盖（只覆盖 _VOLATILE_FUND_FIELDS）
    results = []
    for fb in static:
        live = live_map.get(fb["code"]) or {}
        volatile_update = {k: v for k, v in live.items() if k in _VOLATILE_FUND_FIELDS}
        results.append({**fb, **volatile_update})

    results.sort(key=lambda x: x.get("ytd_return", 0), reverse=True)
    source = "live" if success_rate >= 0.5 else ("partial" if success_rate > 0 else "none")
    return results, source


def _build_etfs() -> tuple:
    """
    并发抓取 ETF 实时行情，返回 (results, source)。
    数据来源：
      - 新浪财经（批量，单次请求）→ market_price / volume / change_pct
      - 天天基金 fundgz（并发）    → nav（计算溢价率用）
    """
    codes = [etf["code"] for etf in STATIC_ETFS]

    sina_map: Dict[str, dict] = {}
    nav_map:  Dict[str, float] = {}

    with ThreadPoolExecutor(max_workers=12) as ex:
        sina_fut = ex.submit(fetch_etfs_sina_batch, codes)
        nav_futs: Dict = {ex.submit(fetch_fund_realtime, c): c for c in codes}

        all_futs = [sina_fut] + list(nav_futs.keys())
        done, _  = wait(all_futs, timeout=8)

        for fut in done:
            if fut is sina_fut:
                try:
                    sina_map = fut.result() or {}
                except Exception:
                    pass
            elif fut in nav_futs:
                code = nav_futs[fut]
                try:
                    rt  = fut.result() or {}
                    nav = float(rt.get("dwjz", 0))
                    if nav > 0:
                        nav_map[code] = nav
                except Exception:
                    pass

    live_count = 0
    results    = []
    for fb in STATIC_ETFS:
        code  = fb["code"]
        sina  = sina_map.get(code, {})
        nav   = nav_map.get(code, 0.0)
        mp    = sina.get("market_price", 0.0)
        premium = round((mp - nav) / nav * 100, 2) if nav > 0 and mp > 0 else 0.0

        if mp > 0:
            live_count += 1

        live_update = {**sina, "nav": nav, "premium": premium}
        # 只覆盖有效值（不用 0 覆盖静态兜底）
        merged = {**fb, **{k: v for k, v in live_update.items() if v != 0}}
        results.append(merged)

    success_rate = live_count / len(codes) if codes else 0
    logger.info(f"[etfs] sina={len(sina_map)}, nav={len(nav_map)}/{len(codes)} ({success_rate:.0%})")
    results.sort(key=lambda x: abs(x.get("premium", 0)), reverse=True)
    source = "live" if success_rate >= 0.5 else ("partial" if success_rate > 0 else "none")
    return results, source

# ─── FastAPI ──────────────────────────────────────────────────────────────────

app = FastAPI(title="Wise-ETF API", version="3.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def _cache_header(response: Response, seconds: int):
    response.headers["Cache-Control"] = \
        f"s-maxage={seconds}, stale-while-revalidate={seconds * 24}"


@app.get("/api/funds/{category}")
def get_funds(category: str, response: Response):
    """
    三层容错：内存缓存 → 实时抓取（静态字段不变，只更新日更字段）→ 文件缓存 → 静态兜底
    """
    cache_key = f"funds_{category}"

    # 1. 内存缓存
    cached = _mem_get(cache_key, "funds")
    if cached is not None:
        _cache_header(response, 3600)
        return {"data": cached, "count": len(cached), "source": "cache"}

    static = STATIC_FUNDS.get(category, [])
    if not static:
        return {"data": [], "count": 0, "source": "empty"}

    # 2. 实时抓取
    results, source = _build_funds(category)

    if source in ("live", "partial"):
        _cache_set(cache_key, results)
    else:
        # 3. 文件缓存（上次成功数据）
        file_data = _file_load(cache_key)
        if file_data:
            _mem_set(cache_key, file_data)
            results = file_data
            source  = "file_cache"
        else:
            # 4. 完全静态兜底
            results = static
            source  = "static"

    _cache_header(response, 3600)
    return {"data": results, "count": len(results), "source": source}


@app.get("/api/etfs")
def get_etfs(response: Response):
    """
    三层容错：内存缓存 → 实时抓取（不变字段保留）→ 文件缓存 → 静态兜底
    """
    cache_key = "etfs"

    cached = _mem_get(cache_key, "etfs")
    if cached is not None:
        _cache_header(response, 300)
        return {"data": cached, "count": len(cached), "source": "cache"}

    results, source = _build_etfs()

    if source in ("live", "partial"):
        _cache_set(cache_key, results)
    else:
        file_data = _file_load(cache_key)
        if file_data:
            _mem_set(cache_key, file_data)
            results = file_data
            source  = "file_cache"
        else:
            results = STATIC_ETFS
            source  = "static"

    _cache_header(response, 300)
    return {"data": results, "count": len(results), "source": source}


@app.get("/api/overview")
def get_overview(response: Response):
    _cache_header(response, 3600)
    return {
        "stats": {**{k: {"count": len(v)} for k, v in STATIC_FUNDS.items()},
                  **{"etf": {"count": len(STATIC_ETFS)}}},
        "last_update": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "total_funds": sum(len(v) for v in STATIC_FUNDS.values()) + len(STATIC_ETFS),
    }


@app.get("/api/fx-index-history")
def get_fx_index_history(response: Response):
    """
    优先 Yahoo Finance 月度数据（~130个点）；
    被墙/超时时返回静态关键月份数据（24个点）。
    """
    cache_key = "fx_history"

    cached = _mem_get(cache_key, "fx_history")
    if cached is not None:
        _cache_header(response, 21600)
        return {"data": cached, "source": "cache"}

    try:
        ndx = _yf_monthly("^NDX")
        spx = _yf_monthly("^GSPC")
        fx  = _yf_monthly("USDCNY=X")

        months = sorted(set(ndx) & set(spx) & set(fx))
        if not months:
            raise ValueError("Empty intersection")

        data   = [{"month": m, "usdcny": fx[m], "ndx_close": ndx[m], "spx_close": spx[m]}
                  for m in months]
        source = "live"
        logger.info(f"[fx-history] {len(data)} months from Yahoo Finance")
        _cache_set(cache_key, data)
    except Exception as e:
        logger.warning(f"[fx-history] Yahoo Finance fallback ({e})")
        file_data = _file_load(cache_key)
        if file_data:
            data   = file_data
            source = "file_cache"
        else:
            data   = STATIC_FX_HISTORY
            source = "static"

    _cache_header(response, 21600)
    return {"data": data, "source": source}


# ── 情感关键词（轻量级，针对纳指/科技股语境）──────────────────────────────────
_BEARISH = {
    "fall", "falls", "fell", "drop", "drops", "dropped", "decline", "declines", "declined",
    "correction", "sell-off", "selloff", "plunge", "plunges", "slump", "tumble", "tumbles",
    "recession", "tariff", "tariffs", "hike", "hikes", "hawkish", "miss", "misses", "missed",
    "weak", "weaker", "concern", "concerns", "fear", "fears", "warning", "warns", "worse",
    "loss", "losses", "crash", "lower", "down", "sinks", "sank", "retreat", "retreats",
    "inflation", "layoff", "layoffs",
}
_BULLISH = {
    "rally", "rallies", "surge", "surges", "gain", "gains", "rise", "rises", "rose",
    "beat", "beats", "strong", "stronger", "growth", "cut", "cuts", "dovish", "positive",
    "record", "high", "recover", "recovers", "rebound", "rebounds", "lift", "lifts",
    "outperform", "upgrade", "upgrades", "boost", "boosted", "jump", "jumps", "jumped",
    "soar", "soars", "optimism", "upside", "better",
}

def _sentiment(title: str) -> str:
    words = set(title.lower().replace("-", " ").replace("'s", "").split())
    bull  = len(words & _BULLISH)
    bear  = len(words & _BEARISH)
    if bull > bear:  return "bullish"
    if bear > bull:  return "bearish"
    return "neutral"

# 与纳指/科技相关的筛选词（必须含其一，避免无关新闻混入）
_NASDAQ_KEYWORDS = {
    "nasdaq", "qqq", "tech", "technology", "ai", "artificial intelligence",
    "semiconductor", "chip", "fed", "federal reserve", "rate", "inflation",
    "s&p", "s&p 500", "market", "stock", "equity", "equities", "etf",
    "earnings", "gdp", "tariff", "trade", "big tech", "apple", "nvidia",
    "microsoft", "google", "alphabet", "amazon", "meta", "tesla",
}

def _is_relevant(title: str) -> bool:
    t = title.lower()
    return any(kw in t for kw in _NASDAQ_KEYWORDS)


def _translate_zh(text: str) -> str:
    """Google Translate 非官方接口，无需 API Key，失败时返回原文"""
    try:
        import urllib.parse
        url  = "https://translate.googleapis.com/translate_a/single"
        resp = _get(url, params={
            "client": "gtx", "sl": "en", "tl": "zh-CN", "dt": "t", "q": text
        }, timeout=(2, 5))
        if resp and resp.ok:
            data = resp.json()
            translated = "".join(seg[0] for seg in data[0] if seg[0])
            if translated:
                return translated
    except Exception as e:
        logger.warning(f"[translate] {e}")
    return text


def fetch_market_news() -> list:
    """
    抓取影响纳指的市场新闻。
    数据源：Yahoo Finance RSS（QQQ + ^NDX）
    返回：[{title, link, age_hours, sentiment}]
    """
    sources = [
        "https://feeds.finance.yahoo.com/rss/2.0/headline?s=QQQ&region=US&lang=en-US",
        "https://feeds.finance.yahoo.com/rss/2.0/headline?s=%5ENDX&region=US&lang=en-US",
    ]
    seen, candidates = set(), []
    for url in sources:
        resp = _get(url, headers=YF_HEADERS, timeout=(3, 8))
        if not (resp and resp.ok):
            continue
        try:
            root = ET.fromstring(resp.content)
            for item in root.findall(".//item"):
                title = (item.findtext("title") or "").strip()
                link  = (item.findtext("link")  or "").strip()
                pub   = (item.findtext("pubDate") or "").strip()
                if not title or title in seen:
                    continue
                seen.add(title)
                age_h = None
                try:
                    dt    = parsedate_to_datetime(pub)
                    age_h = round((datetime.now(dt.tzinfo) - dt).total_seconds() / 3600, 1)
                except Exception:
                    pass
                candidates.append({
                    "title":      title,
                    "link":       link,
                    "age_hours":  age_h,
                    "sentiment":  _sentiment(title),
                    "_relevant":  _is_relevant(title),
                })
        except Exception as e:
            logger.warning(f"[news] parse {url[:50]}: {e}")

    # 相关新闻优先，再按时间排（age_hours 小的更新）
    candidates.sort(key=lambda x: (0 if x["_relevant"] else 1, x["age_hours"] or 999))
    top = candidates[:5]

    # 并发翻译标题
    with ThreadPoolExecutor(max_workers=5) as ex:
        futs = {ex.submit(_translate_zh, n["title"]): i for i, n in enumerate(top)}
        done, _ = wait(futs, timeout=6)
        for fut in done:
            idx = futs[fut]
            try:
                top[idx]["title"] = fut.result() or top[idx]["title"]
            except Exception:
                pass

    items = [{k: v for k, v in n.items() if k != "_relevant"} for n in top]
    logger.info(f"[news] fetched {len(items)} items (from {len(candidates)} candidates)")
    return items


@app.get("/api/news")
def get_news(response: Response):
    """市场新闻（Yahoo Finance RSS，30min 缓存）"""
    cache_key = "news"
    cached = _mem_get(cache_key, "news")
    if cached is not None:
        _cache_header(response, 1800)
        return {"data": cached, "source": "cache"}

    data = fetch_market_news()
    if data:
        _mem_set(cache_key, data)
    _cache_header(response, 1800)
    return {"data": data, "source": "live" if data else "empty"}


@app.get("/api/cron/refresh")
def cron_refresh():
    """
    Vercel Cron Job 调用（UTC 02:00 / 北京 10:00）。
    强制清除内存缓存，重新拉取全部数据并写入文件缓存。
    """
    results: dict = {}

    for category in STATIC_FUNDS:
        key = f"funds_{category}"
        _MEM_CACHE.pop(key, None)   # 清除旧缓存，强制重新拉取
        try:
            data, source = _build_funds(category)
            if source != "none":
                _cache_set(key, data)
            results[category] = {"count": len(data), "source": source}
        except Exception as e:
            results[category] = {"error": str(e)}

    _MEM_CACHE.pop("etfs", None)
    try:
        data, source = _build_etfs()
        if source != "none":
            _cache_set("etfs", data)
        results["etfs"] = {"count": len(data), "source": source}
    except Exception as e:
        results["etfs"] = {"error": str(e)}

    return {"ts": datetime.now().isoformat(), "results": results}


# ─── 实时行情：昨日涨跌 + 近1年滚动涨幅 ──────────────────────────────────────

_ALL_CODES = [
    f["code"] for cat in STATIC_FUNDS.values() for f in cat
] + [e["code"] for e in STATIC_ETFS]

_LIVE_CACHE: dict = {}
_LIVE_CACHE_TS: float = 0.0


_MOBILE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
    "Referer": "https://mpservice.com",
    "Origin": "https://mpservice.com",
    "Accept": "application/json, text/plain, */*",
}


def _fetch_live_one(code: str) -> tuple:
    """单次调用 FundMNBasicInformation 同时获取 RZDF（各基金实际日涨幅）和 SYL_1N（近1年）"""
    day_change, rolling_1y = None, None
    for attempt in range(2):
        try:
            resp = requests.get(
                "https://fundmobapi.eastmoney.com/FundMNewApi/FundMNBasicInformation",
                params={"FCODE": code, "deviceid": "wise-etf",
                        "plat": "Wap", "product": "EFund", "version": "6.5.0"},
                headers=_MOBILE_HEADERS, timeout=(6, 12), verify=False)
            if resp.ok:
                d = resp.json()
                if d.get("ErrCode") == 0:
                    data = d.get("Datas", {})
                    rzdf = data.get("RZDF", "")
                    if rzdf not in ("", "--", None):
                        day_change = float(rzdf)
                    syl1n = data.get("SYL_1N", "")
                    if syl1n not in ("", "--", None):
                        rolling_1y = float(syl1n)
            break
        except Exception:
            if attempt == 0:
                time.sleep(0.5)
    return code, {"day_change": day_change, "rolling_1y": rolling_1y}


@app.get("/api/debug_live/{code}")
def debug_live(code: str):
    """调试：单只基金实时行情"""
    import urllib3; urllib3.disable_warnings()
    rt_resp = None; perf_resp_json = None; err = None
    try:
        r = requests.get(f"http://fundgz.1234567.com.cn/js/{code}.js", headers=HEADERS, timeout=(4,8))
        m = re.search(r"jsonpgz\((.+)\)", r.text)
        rt_resp = json.loads(m.group(1)) if m else r.text[:200]
    except Exception as e:
        rt_resp = str(e)
    try:
        r2 = requests.get("https://fundmobapi.eastmoney.com/FundMNewApi/FundMNPeriodIncrease",
            params={"FCODE":code,"deviceid":"wise-etf","plat":"Wap","product":"EFund","version":"6.5.0"},
            headers={
                "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
                "Referer": "https://mpservice.com",
                "Origin": "https://mpservice.com",
                "Accept": "application/json, text/plain, */*",
            },
            timeout=(6,12), verify=False)
        perf_resp_json = r2.json()
    except Exception as e:
        err = str(e)
    return {"rt": rt_resp, "perf": perf_resp_json, "err": err}

@app.get("/api/live_data")
def get_live_data():
    """昨日涨跌(day_change) + 近1年滚动涨幅(rolling_1y)，5分钟缓存，并发拉取"""
    global _LIVE_CACHE, _LIVE_CACHE_TS
    if time.time() - _LIVE_CACHE_TS < 300 and _LIVE_CACHE:
        return {"data": _LIVE_CACHE, "cached": True}

    result = {}
    with ThreadPoolExecutor(max_workers=8) as ex:
        futures = {ex.submit(_fetch_live_one, code): code for code in _ALL_CODES}
        for f in futures:
            code, data = f.result()
            result[code] = data

    _LIVE_CACHE = result
    _LIVE_CACHE_TS = time.time()
    return {"data": result, "cached": False}
