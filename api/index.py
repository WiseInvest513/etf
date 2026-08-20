"""Wise-ETF Serverless API v5.

数据分层：
  - 产品目录：代码、名称、费率、规模、2025 自然年度收益等低频元数据。
  - 场外日更：昨日涨跌、滚动一年、跟踪误差、申购状态与额度。
  - 场内日更：收盘价、场内涨跌、成交额、滚动一年、跟踪误差与溢价率。

缓存分层：带 TTL 的 Redis 热缓存 + 独立永久 Last-Known-Good。部分抓取只
进入热缓存，不覆盖完整 LKG；前端会收到 fresh/partial/stale/reference 状态。

定时任务（UTC）：01:10/01:20/01:30 分类别刷新场外基金；07:30 工作日
ETF 收盘快照；23:30 工作日补齐历史溢价。所有 cron/admin 路由默认要求
CRON_SECRET。
"""

import json, os, re, logging, time, xml.etree.ElementTree as ET
import hmac, hashlib, secrets, base64
from threading import BoundedSemaphore, Lock, local

# 加载 .env.local（本地开发环境）
def _load_env_local():
    env_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env.local")
    if not os.path.exists(env_path):
        return
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
_load_env_local()
from concurrent.futures import ThreadPoolExecutor, wait
from datetime import date, datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from typing import Optional, Dict, List

import requests
from fastapi import FastAPI, Header, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from upstash_redis import Redis

from api.wise_etf import (
    calculate_etf_premium,
    normalize_purchase,
    normalize_yahoo_monthly_returns,
    parse_number,
    rolling_nav_return,
    safe_sort,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)
_CHINA_TZ = timezone(timedelta(hours=8))

# ─── Redis 缓存层 ───────────────────────────────────────────────────────────────

_redis: Optional[Redis] = None

def _get_redis() -> Optional[Redis]:
    global _redis
    if _redis is None:
        url   = os.environ.get("KV3_KV_REST_API_URL") or os.environ.get("KV_REST_API_URL")
        token = os.environ.get("KV3_KV_REST_API_TOKEN") or os.environ.get("KV_REST_API_TOKEN")
        if url and token:
            try:
                _redis = Redis(url=url, token=token)
            except Exception as e:
                logger.warning(f"[redis] init failed: {e}")
    return _redis

CACHE_TTL = {
    "funds":           36 * 3600,  # 日更字段；跨过一次失败的 cron 仍可读取热缓存
    "etfs":            36 * 3600,  # 每个 A 股交易日收盘后固化，不再做 5 分钟轮询
    "fx_history":      24 * 3600,  # 汇率历史，24h 有效
    "news":            30 * 60,    # 市场新闻，30min 缓存
    "premium_history": 12 * 3600,  # 溢价率历史，cron 每日更新
    "live_data":       36 * 3600,
    "monthly_returns": 36 * 3600,
    "market_sentiment": 20 * 3600,
    "fx_current":       20 * 3600,
}
# 不完整/过期热快照只用于短暂兜底，必须尽快给下一次请求恢复机会。
RECOVERY_CACHE_TTL = 5 * 60
RECOVERY_GATE_PREFIX = "recovery_gate:"

# A partial cache deliberately bypasses the normal hot-cache fast path.  Keep
# that recovery from becoming a thundering herd when several tabs request the
# same key at once: one request refreshes, followers serve the existing partial
# snapshot immediately.
_RECOVERY_REFRESH_LOCKS: dict = {}
_RECOVERY_REFRESH_LOCKS_GUARD = Lock()


def _try_recovery_refresh(cache_key: str):
    with _RECOVERY_REFRESH_LOCKS_GUARD:
        lock = _RECOVERY_REFRESH_LOCKS.setdefault(cache_key, Lock())
    return lock if lock.acquire(blocking=False) else None

LKG_PREFIX = "lkg:"
DATA_CACHE_NAMESPACE = "wise:data:v2:"
_VERSIONED_DATA_KEYS = {
    "etfs", "live_data", "live_data:meta", "monthly_returns_v1",
    "market_sentiment", "market_sentiment_v2", "pe_history_v3", "fx_history", "fx_usdcny",
    "news", "market_ai_insight_v2",
}
_VERSIONED_DATA_PREFIXES = ("funds_", "prem_hist_", RECOVERY_GATE_PREFIX)


def _storage_key(key: str) -> str:
    """Version market-data keys without moving users, favorites or QDII state."""
    core = key[len(LKG_PREFIX):] if key.startswith(LKG_PREFIX) else key
    if core in _VERSIONED_DATA_KEYS or core.startswith(_VERSIONED_DATA_PREFIXES):
        return f"{DATA_CACHE_NAMESPACE}{key}"
    return key

def _cache_get(key: str) -> Optional[any]:
    r = _get_redis()
    if not r:
        return None
    try:
        val = r.get(_storage_key(key))
        if val:
            logger.info(f"[redis] hit {key}")
            return json.loads(val) if isinstance(val, str) else val
    except Exception as e:
        logger.warning(f"[redis:get] {key}: {e}")
    return None

def _cache_set(key: str, data: any, ttl: int) -> bool:
    r = _get_redis()
    if not r:
        return False
    try:
        r.set(_storage_key(key), json.dumps(data, ensure_ascii=False), ex=ttl)
        logger.info(f"[redis] set {key} ttl={ttl}s")
        return True
    except Exception as e:
        logger.warning(f"[redis:set] {key}: {e}")
        return False


def _lkg_get(key: str) -> Optional[any]:
    """读取永久 Last-Known-Good；它和热缓存使用不同 Redis key。"""
    return _cache_get(f"{LKG_PREFIX}{key}")


def _lkg_set(key: str, data: any) -> bool:
    """只在候选数据通过校验后写入，不设置 TTL。"""
    r = _get_redis()
    if not r:
        return False
    try:
        r.set(_storage_key(f"{LKG_PREFIX}{key}"), json.dumps(data, ensure_ascii=False))
        logger.info(f"[redis] lkg set {key}")
        return True
    except Exception as e:
        logger.warning(f"[redis:lkg:set] {key}: {e}")
        return False


def _publish_cache(key: str, data: any, ttl: int) -> bool:
    """先保存永久好数据，再发布热缓存；不会预删当前可读数据。"""
    lkg_ok = _lkg_set(key, data)
    hot_ok = _cache_set(key, data, ttl)
    if not (lkg_ok and hot_ok):
        logger.error(f"[redis:publish] {key}: lkg_ok={lkg_ok} hot_ok={hot_ok}")
        return False
    _cache_delete(f"{RECOVERY_GATE_PREFIX}{key}")
    return True

def _cache_delete(key: str):
    r = _get_redis()
    if not r:
        return
    try:
        r.delete(_storage_key(key))
        logger.info(f"[redis] del {key}")
    except Exception as e:
        logger.warning(f"[redis:del] {key}: {e}")


def _acquire_job_lock(job_key: str, ttl_seconds: int = 45) -> Optional[str]:
    """Cross-instance cron lock; token ownership prevents unsafe unlocks."""
    r = _get_redis()
    if not r:
        return None
    token = secrets.token_urlsafe(18)
    try:
        acquired = r.set(f"wise:job-lock:{job_key}", token, nx=True, px=ttl_seconds * 1000)
        return token if acquired else None
    except Exception as exc:
        logger.error(f"[redis:lock] {job_key}: {exc}")
        return None


def _release_job_lock(job_key: str, token: str) -> None:
    r = _get_redis()
    if not r or not token:
        return
    script = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end"
    try:
        r.eval(script, keys=[f"wise:job-lock:{job_key}"], args=[token])
    except Exception as exc:
        logger.warning(f"[redis:unlock] {job_key}: {exc}")


def _recovery_gate_active(cache_key: str) -> bool:
    return bool(_cache_get(f"{RECOVERY_GATE_PREFIX}{cache_key}"))


def _cache_recovery_snapshot(cache_key: str, data: any) -> None:
    """Publish a short-lived fallback and a same-length retry backoff marker."""
    _cache_set(cache_key, data, RECOVERY_CACHE_TTL)
    _cache_set(
        f"{RECOVERY_GATE_PREFIX}{cache_key}",
        {"active": True},
        RECOVERY_CACHE_TTL,
    )

def _cache_mget(keys: List[str]) -> Dict[str, any]:
    """批量 MGET，返回 {key: value} 字典（缺失的 key 不在字典里）"""
    if not keys:
        return {}
    r = _get_redis()
    if not r:
        return {}
    try:
        vals = r.mget(*keys)
        result = {}
        for k, v in zip(keys, vals):
            if v is not None:
                try:
                    result[k] = json.loads(v) if isinstance(v, str) else v
                except Exception:
                    pass
        return result
    except Exception as e:
        logger.warning(f"[redis:mget] {e}")
        return {}

def _cache_mset(items: Dict[str, any], ttl: int):
    """批量 SET，通过 pipeline 一次 RTT 写入所有 key（代替 N 次串行 SET）"""
    if not items:
        return
    r = _get_redis()
    if not r:
        return
    try:
        pipe = r.pipeline()
        for k, v in items.items():
            pipe.set(k, json.dumps(v, ensure_ascii=False), ex=ttl)
        pipe.exec()
        logger.info(f"[redis] mset {len(items)} keys ttl={ttl}s")
    except Exception as e:
        logger.warning(f"[redis:mset] {e}")

def _mem_get(key: str, kind: str) -> Optional[any]:
    return _cache_get(key)

def _mem_set(key: str, data: any):
    ttl = CACHE_TTL.get(kind_of(key), 12 * 3600)
    _cache_set(key, data, ttl)

def _file_save(key: str, data: any):
    _lkg_set(key, data)

def _file_load(key: str) -> Optional[any]:
    return _lkg_get(key)

def kind_of(key: str) -> str:
    """根据 key 推断缓存类型"""
    if key.startswith("funds_"):        return "funds"
    if key.startswith("prem_hist_"):    return "premium_history"
    if key == "etfs":                   return "etfs"
    if key == "live_data":              return "live_data"
    if key == "monthly_returns_v1":     return "monthly_returns"
    if key == "fx_history":             return "fx_history"
    if key == "fx_usdcny":              return "fx_current"
    if key == "news":                   return "news"
    if key in ("market_sentiment", "market_sentiment_v2"):
        return "market_sentiment"
    return "funds"

# ─── 迁移期旧字面量 ──────────────────────────────────────────────────────────
# 仅供离线 catalog bootstrap 和显式灾备；正常 API 启动后会被产品目录替换。
# 这些 2026-04 旧值不参与生产数据展示，也不得作为动态字段的静默兜底。
STATIC_FUNDS: Dict[str, List[dict]] = {
    "nasdaq_passive": [
        {"code":"019524","name":"华泰柏瑞纳斯达克100ETF联接(QDII)A","fee_rate":0.65,"scale":6.8,"ytd_return":16.66,"track_error":1.65,"daily_limit":"10元", "buy_status":"open",  "code_c":"019525"},
        {"code":"019547","name":"招商纳斯达克100ETF联接(QDII)A",      "fee_rate":0.65,"scale":15.8,"ytd_return":16.22,"track_error":1.72,"daily_limit":"100元","buy_status":"open",  "code_c":"019548"},
        {"code":"539001","name":"建信纳斯达克100指数QDIIA",            "fee_rate":1.00,"scale":13.2,"ytd_return":16.21,"track_error":2.17,"daily_limit":"100元",  "buy_status":"open",  "code_c":"012752"},
        {"code":"018966","name":"汇添富纳斯达克100ETF联接(QDII)A",    "fee_rate":0.65,"scale":11.3,"ytd_return":15.49,"track_error":2.08,"daily_limit":"100元", "buy_status":"open",  "code_c":"018967"},
        {"code":"016452","name":"南方纳斯达克100指数(QDII)A",          "fee_rate":0.65,"scale":33.3,"ytd_return":17.26,"track_error":1.64,"daily_limit":"200元", "buy_status":"open",  "code_c":"016453"},
        {"code":"000834","name":"大成纳斯达克100指数(QDII)A",          "fee_rate":1.00,"scale":38.8,"ytd_return":16.76,"track_error":1.51,"daily_limit":"100元",  "buy_status":"open",  "code_c":"008971"},
        {"code":"019172","name":"摩根纳斯达克100指数(QDII)A",          "fee_rate":0.60,"scale":26.1,"ytd_return":17.66,"track_error":2.15,"daily_limit":"100元", "buy_status":"open",  "code_c":"019173"},
        {"code":"270042","name":"广发纳斯达克100ETF联接(QDII)",        "fee_rate":1.00,"scale":108.4,"ytd_return":17.04,"track_error":1.10,"daily_limit":"10元",  "buy_status":"open",  "code_c":"006479"},
        {"code":"019441","name":"万家纳斯达克100指数发起式(QDII)",     "fee_rate":0.65,"scale":5.0, "ytd_return":16.86,"track_error":1.75,"daily_limit":"50元",  "buy_status":"open",  "code_c":"019442"},
        {"code":"161130","name":"易方达纳斯达克100ETF联接(QDII-LOF)A","fee_rate":0.60,"scale":16.1,"ytd_return":16.58,"track_error":1.55,"daily_limit":"暂停申购","buy_status":"suspended","code_c":"012870"},
        {"code":"040046","name":"华安纳斯达克100指数(QDII)",           "fee_rate":0.80,"scale":55.2,"ytd_return":15.37,"track_error":2.06,"daily_limit":"10元",  "buy_status":"open",  "code_c":"014978"},
        {"code":"160213","name":"国泰纳斯达克100指数(QDII)",           "fee_rate":1.00,"scale":18.6,"ytd_return":17.58,"track_error":1.03,"daily_limit":"暂停申购","buy_status":"suspended","code_c":None},
        {"code":"016055","name":"博时纳斯达克100ETF联接(QDII)A",       "fee_rate":0.65,"scale":15.6,"ytd_return":17.32,"track_error":1.52,"daily_limit":"暂停申购","buy_status":"suspended","code_c":"016057"},
        {"code":"018043","name":"天弘纳斯达克100指数(QDII)A",          "fee_rate":0.60,"scale":26.2,"ytd_return":17.49,"track_error":1.55,"daily_limit":"暂停申购","buy_status":"suspended","code_c":"018044"},
        {"code":"019736","name":"宝盈纳斯达克100指数(QDII)A",          "fee_rate":0.65,"scale":6.8, "ytd_return":17.19,"track_error":1.55,"daily_limit":"100元",  "buy_status":"open",  "code_c":"019737"},
        {"code":"016532","name":"嘉实纳斯达克100联接(QDII)A",          "fee_rate":0.60,"scale":21.1,"ytd_return":16.4, "track_error":1.60,"daily_limit":"暂停申购","buy_status":"suspended","code_c":"016533"},
        {"code":"015299","name":"华夏纳斯达克100ETF联接(QDII)A",       "fee_rate":0.80,"scale":3.8, "ytd_return":15.74,"track_error":2.69,"daily_limit":"暂停申购","buy_status":"suspended","code_c":"015300"},
        {"code":"017091","name":"景顺长城纳斯达克科技市值加权ETF联接A","fee_rate":1.00,"scale":25.8,"ytd_return":24.22,"track_error":3.11,"daily_limit":"暂停申购","buy_status":"suspended","code_c":"017093"},
    ],
    "sp500_passive": [
        {"code":"017641","name":"摩根标普500指数(QDII)A",           "fee_rate":0.65,"scale":31.6,"ytd_return":11.75,"track_error":2.57, "daily_limit":"100元",  "buy_status":"open",     "code_c":"019305"},
        {"code":"161125","name":"易方达标普500指数(QDII-LOF)A",     "fee_rate":1.00,"scale":14.7,"ytd_return":11.74,"track_error":2.39, "daily_limit":"暂停申购","buy_status":"suspended","code_c":"012860"},
        {"code":"017028","name":"国泰标普500ETF联接(QDII)A",        "fee_rate":0.75,"scale":1.6, "ytd_return":11.71,"track_error":1.87, "daily_limit":"暂停申购","buy_status":"suspended","code_c":"017030"},
        {"code":"050025","name":"博时标普500ETF联接(QDII)A",        "fee_rate":0.80,"scale":67.6,"ytd_return":12.14,"track_error":1.31, "daily_limit":"暂停申购","buy_status":"suspended","code_c":"006075"},
        {"code":"007721","name":"天弘标普500(QDII-FOF)A",           "fee_rate":0.80,"scale":26.5,"ytd_return":11.16,"track_error":None,"daily_limit":"暂停申购","buy_status":"suspended","code_c":"007722"},
        {"code":"018064","name":"华夏标普500ETF联接(QDII)A",        "fee_rate":0.75,"scale":4.1, "ytd_return":10.38,"track_error":1.10, "daily_limit":"暂停申购","buy_status":"suspended","code_c":"018065"},
        {"code":"096001","name":"大成标普500等权重指数(QDII)A",     "fee_rate":1.20,"scale":6.1, "ytd_return":7.17, "track_error":1.69, "daily_limit":"50元",    "buy_status":"open",     "code_c":"008401"},
        {"code":"161128","name":"易方达标普信息科技指数(QDII-FOF)A","fee_rate":1.00,"scale":36.8,"ytd_return":22.13,"track_error":10.85,"daily_limit":"暂停申购","buy_status":"suspended","code_c":None},
    ],
    "us_active": [
        {"code":"100055","name":"富国全球科技互联网股票(QDII)A","fee_rate":1.40,"scale":10.2,"ytd_return":37.81,"daily_limit":"不限额","buy_status":"open"},
        {"code":"016701","name":"银华海外数字经济量化选股混合(QDII)A","fee_rate":1.40,"scale":11.2,"ytd_return":27.21,"daily_limit":"100000元","buy_status":"open"},
        {"code":"005698","name":"华夏全球科技先锋混合(QDII)","fee_rate":1.40,"scale":26.3,"ytd_return":52.49,"daily_limit":"5000元","buy_status":"open"},
        {"code":"017144","name":"华宝海外新能源汽车股票(QDII)A","fee_rate":1.40,"scale":2.6,"ytd_return":24.08,"daily_limit":"10000元","buy_status":"open"},
        {"code":"270023","name":"广发全球精选股票(QDII)A","fee_rate":1.40,"scale":104.5,"ytd_return":32.39,"daily_limit":"2000元","buy_status":"open"},
        {"code":"008253","name":"华宝致远混合(QDII)A","fee_rate":1.40,"scale":1.7,"ytd_return":47.82,"daily_limit":"5000元","buy_status":"open"},
        {"code":"017436","name":"华宝纳斯达克精选股票(QDII)A","fee_rate":1.40,"scale":46.2,"ytd_return":26.08,"daily_limit":"5000元","buy_status":"open"},
        {"code":"501226","name":"长城全球新能源汽车股票(QDII-LOF)A","fee_rate":1.40,"scale":4.7,"ytd_return":48.21,"daily_limit":"100元","buy_status":"open"},
        {"code":"006555","name":"浦银安盛全球智能科技股票(QDII)A","fee_rate":1.40,"scale":8.7,"ytd_return":43.81,"daily_limit":"暂停申购","buy_status":"suspended"},
        {"code":"017730","name":"嘉实全球产业升级股票(QDII)A","fee_rate":1.40,"scale":7.2,"ytd_return":75.36,"daily_limit":"100元","buy_status":"open"},
        {"code":"006373","name":"国富全球科技互联混合(QDII)人民币A","fee_rate":1.40,"scale":24.3,"ytd_return":53.48,"daily_limit":"100元","buy_status":"open"},
        {"code":"012920","name":"易方达全球成长精选混合(QDII)A","fee_rate":1.40,"scale":28.3,"ytd_return":107.95,"daily_limit":"20元","buy_status":"open"},
        {"code":"539002","name":"建信新兴市场优选混合(QDII)A","fee_rate":1.40,"scale":4.6,"ytd_return":92.11,"daily_limit":"20元","buy_status":"open"},
        {"code":"001668","name":"汇添富全球移动互联混合(QDII)A","fee_rate":1.40,"scale":0.0,"ytd_return":43.29,"daily_limit":"5000元","buy_status":"open"},
        {"code":"002891","name":"华夏移动互联灵活配置混合(QDII)A","fee_rate":1.40,"scale":0.0,"ytd_return":120.50,"daily_limit":"1000元","buy_status":"open"},
        {"code":"457001","name":"国富亚洲机会股票(QDII)A","fee_rate":1.40,"scale":0.0,"ytd_return":143.79,"daily_limit":"200元","buy_status":"open"},
        # ── 新增主题型主动 QDII ──
        {"code":"004877","name":"汇添富全球医疗混合(QDII)人民币","fee_rate":1.40,"scale":0.0,"ytd_return":27.85,"daily_limit":"10000元","buy_status":"open"},
        {"code":"006308","name":"汇添富全球消费混合(QDII)人民币A","fee_rate":1.40,"scale":0.0,"ytd_return":11.6,"daily_limit":"1000元","buy_status":"open"},
        {"code":"006309","name":"汇添富全球消费混合(QDII)人民币C","fee_rate":1.40,"scale":0.0,"ytd_return":10.5,"daily_limit":"1000元","buy_status":"open"},
        {"code":"018155","name":"创金合信全球医药生物股票发起式(QDII)A","fee_rate":1.40,"scale":0.0,"ytd_return":89.49,"daily_limit":"不限额","buy_status":"open"},
        {"code":"018156","name":"创金合信全球医药生物股票发起式(QDII)C","fee_rate":1.40,"scale":0.0,"ytd_return":88.8,"daily_limit":"不限额","buy_status":"open"},
        # ── C 类份额补全 ──
        {"code":"017437","name":"华宝纳斯达克精选股票发起式(QDII)C","fee_rate":1.40,"scale":0.0,"ytd_return":16.7,"daily_limit":"5000元","buy_status":"open"},
        {"code":"017731","name":"嘉实全球产业升级股票发起式(QDII)C","fee_rate":1.40,"scale":0.0,"ytd_return":53.78,"daily_limit":"100元","buy_status":"open"},
        {"code":"022184","name":"富国全球科技互联网股票(QDII)C","fee_rate":1.40,"scale":0.0,"ytd_return":43.99,"daily_limit":"不限额","buy_status":"open"},
        {"code":"016702","name":"银华海外数字经济量化选股混合(QDII)C","fee_rate":1.40,"scale":0.0,"ytd_return":23.74,"daily_limit":"100000元","buy_status":"open"},
        {"code":"016823","name":"天弘全球新能源汽车股票(QDII-LOF)C","fee_rate":1.40,"scale":0.0,"ytd_return":35.54,"daily_limit":"10000元","buy_status":"open"},
        {"code":"018036","name":"长城全球新能源车股票发起式(QDII)C","fee_rate":1.40,"scale":0.0,"ytd_return":29.8,"daily_limit":"100元","buy_status":"open"},
        {"code":"017145","name":"华宝海外新能源汽车股票发起式(QDII)C","fee_rate":1.40,"scale":0.0,"ytd_return":26.14,"daily_limit":"10000元","buy_status":"open"},
    ],
}

# 以下字面量仅供初次 catalog bootstrap 和显式 ALLOW_LEGACY_CATALOG 灾备。
# 正常运行会由 catalog/products.v1.json 完整替换；其中旧行情绝不作为展示兜底。
STATIC_ETFS: List[dict] = [
    # ── 纳斯达克100 ──  scale/ytd_return/fee_rate 基于 2026-04-02 实测数据
    {"code":"513100","name":"国泰纳斯达克100ETF",        "tracking_index":"纳斯达克100",        "scale":167.9,"ytd_return":16.99,"market_price":1.708,"nav":1.6276,"premium":4.94,"volume":3.6, "change_pct":0.0,"fee_rate":0.80,"track_error":1.07},
    {"code":"513110","name":"华泰柏瑞纳斯达克100ETF",     "tracking_index":"纳斯达克100",        "scale":41.6, "ytd_return":16.60,"market_price":1.933,"nav":1.8710,"premium":3.32,"volume":1.5, "change_pct":0.0,"fee_rate":1.00,"track_error":1.04},
    {"code":"159941","name":"广发纳斯达克100ETF",         "tracking_index":"纳斯达克100",        "scale":297.8,"ytd_return":16.41,"market_price":1.276,"nav":1.2228,"premium":4.35,"volume":7.8, "change_pct":0.0,"fee_rate":1.00,"track_error":1.03},
    {"code":"513300","name":"华夏纳斯达克100ETF(QDII)",   "tracking_index":"纳斯达克100",        "scale":112.5,"ytd_return":14.72,"market_price":2.106,"nav":2.0302,"premium":3.73,"volume":3.1, "change_pct":0.0,"fee_rate":0.80,"track_error":2.53},
    {"code":"159659","name":"招商纳斯达克100ETF(QDII)",   "tracking_index":"纳斯达克100",        "scale":79.3, "ytd_return":17.42,"market_price":1.815,"nav":1.7516,"premium":3.62,"volume":1.3, "change_pct":0.0,"fee_rate":0.65,"track_error":1.08},
    {"code":"159632","name":"华安纳斯达克100ETF(QDII)",   "tracking_index":"纳斯达克100",        "scale":97.8, "ytd_return":16.28,"market_price":1.907,"nav":1.8467,"premium":3.27,"volume":1.9, "change_pct":0.0,"fee_rate":0.80,"track_error":1.24},
    {"code":"513870","name":"富国纳斯达克100ETF(QDII)",   "tracking_index":"纳斯达克100",        "scale":20.2, "ytd_return":17.41,"market_price":1.776,"nav":1.7178,"premium":3.39,"volume":0.3, "change_pct":0.0,"fee_rate":0.63,"track_error":0.86},
    {"code":"159696","name":"易方达纳斯达克100ETF(QDII)", "tracking_index":"纳斯达克100",        "scale":39.7, "ytd_return":17.37,"market_price":1.742,"nav":1.6784,"premium":3.79,"volume":0.5, "change_pct":0.0,"fee_rate":0.63,"track_error":0.86},
    {"code":"159660","name":"汇添富纳斯达克100ETF(QDII)", "tracking_index":"纳斯达克100",        "scale":37.7, "ytd_return":17.24,"market_price":2.039,"nav":1.9707,"premium":3.52,"volume":0.4, "change_pct":0.0,"fee_rate":0.66,"track_error":0.88},
    {"code":"159501","name":"嘉实纳斯达克100ETF(QDII)",   "tracking_index":"纳斯达克100",        "scale":100.7,"ytd_return":17.14,"market_price":1.753,"nav":1.6939,"premium":3.52,"volume":1.2, "change_pct":0.0,"fee_rate":0.61,"track_error":0.86},
    {"code":"513390","name":"博时纳斯达克100ETF(QDII)",   "tracking_index":"纳斯达克100",        "scale":35.6, "ytd_return":17.12,"market_price":2.094,"nav":2.0228,"premium":3.52,"volume":0.4, "change_pct":0.0,"fee_rate":0.69,"track_error":0.91},
    {"code":"159513","name":"大成纳斯达克100ETF(QDII)",   "tracking_index":"纳斯达克100",        "scale":59.7, "ytd_return":16.50,"market_price":1.566,"nav":1.5136,"premium":3.52,"volume":0.8, "change_pct":0.0,"fee_rate":1.01,"track_error":0.88},
    # ── 纳斯达克科技市值加权 ──
    {"code":"159509","name":"景顺长城纳斯达克科技ETF(QDII)","tracking_index":"纳斯达克科技市值加权","scale":123.3,"ytd_return":27.55,"market_price":1.962,"nav":1.6780,"premium":16.9,"volume":5.3, "change_pct":0.0,"fee_rate":1.00,"track_error":1.88},
    # ── 标普500 ──
    {"code":"513500","name":"博时标普500ETF",             "tracking_index":"标普500",            "scale":223.2,"ytd_return":13.89,"market_price":2.209,"nav":2.1132,"premium":4.54,"volume":2.3, "change_pct":0.0,"fee_rate":0.80,"track_error":1.07},
    {"code":"159612","name":"国泰标普500ETF(QDII)",       "tracking_index":"标普500",            "scale":7.9,  "ytd_return":13.74,"market_price":1.735,"nav":1.6582,"premium":4.63,"volume":0.1, "change_pct":0.0,"fee_rate":0.75,"track_error":1.01},
    {"code":"513650","name":"南方标普500ETF(QDII)",       "tracking_index":"标普500",            "scale":46.8, "ytd_return":13.82,"market_price":1.661,"nav":1.6117,"premium":3.06,"volume":1.0, "change_pct":0.0,"fee_rate":0.75,"track_error":1.05},
]

# QDII 估值模块本轮不改，保留它原先使用的主动基金集合。
_LEGACY_QDII_CODES = [row["code"] for row in STATIC_FUNDS["us_active"]]


def _load_product_catalog() -> Optional[tuple]:
    """从唯一产品目录生成 API 运行时静态元数据；生产环境失败即停止启动。"""
    path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "catalog", "products.v1.json")
    try:
        with open(path, encoding="utf-8") as handle:
            catalog = json.load(handle)
        funds = {"nasdaq_passive": [], "sp500_passive": [], "us_active": []}
        etfs = []
        for product in catalog.get("products", []):
            # 产品目录是 Web/API 的唯一清单；QDII 估值仍使用上方冻结的旧集合。
            code = str(product["code"])
            snapshot = product.get("static_snapshot") or {}
            metadata_as_of = product.get("metadata_as_of")
            annual = snapshot.get("annual_return_2025")
            common = {
                "code": code,
                "name": product.get("name") or code,
                "fee_rate": snapshot.get("fee"),
                "scale": snapshot.get("scale"),
                "scale_as_of": snapshot.get("scale_as_of") or metadata_as_of,
                "ytd_return": annual,                  # legacy v1 alias
                "annual_return_2025": annual,
                "annual_return_2025_as_of": snapshot.get("annual_return_2025_as_of") or (
                    "2025-12-31" if annual is not None else None
                ),
                # 没有独立上游披露日的旧误差值不可作为产品真值。
                "track_error": snapshot.get("track_error") if snapshot.get("track_error_as_of") else None,
                # 跟踪误差的日期不能借用规模报告期；没有独立日期就明确为空。
                "track_error_as_of": snapshot.get("track_error_as_of"),
                "metadata_source": "catalog/products.v1.json",
                "share_class": product.get("share_class"),
                "master_code": product.get("master_code") or code,
            }
            if product.get("product_type") == "etf":
                etfs.append({
                    **common,
                    "tracking_index": product.get("tracking_index"),
                    # 行情字段只允许由每日快照写入。
                    "market_price": None,
                    "nav": None,
                    "premium": None,
                    "volume": None,
                    "change_pct": None,
                })
                continue

            related = product.get("related_share_codes") or []
            row = {
                **common,
                "code_c": related[0] if related else None,
                # 申购状态/额度是日更字段；目录中的迁移旧值只保留审计，不作冷启动真值。
                "daily_limit": "待确认",
                "buy_status": "unknown",
                "subscription_status": "unknown",
            }
            for category in product.get("categories") or []:
                if category in funds:
                    funds[category].append(dict(row))

        if not all(funds.values()) or not etfs:
            raise ValueError("catalog is missing a required product category")
        return funds, etfs
    except Exception as exc:
        if os.environ.get("ALLOW_LEGACY_CATALOG", "").lower() in {"1", "true", "yes"}:
            logger.error(f"[catalog] explicitly using legacy literals after catalog failure: {exc}")
            return None
        raise RuntimeError(f"required product catalog could not be loaded: {exc}") from exc


_catalog_runtime = _load_product_catalog()
if _catalog_runtime:
    STATIC_FUNDS, STATIC_ETFS = _catalog_runtime

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
    "Referer": "https://fund.eastmoney.com/",
}

YF_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json,text/plain,*/*",
}

# ─── Yahoo Finance crumb 认证 ────────────────────────────────────────────────
# Yahoo Finance 2024 起强制要求 cookie+crumb，不带则返回 429
_YF_CRUMB: dict = {"crumb": None, "cookies": None, "ts": 0.0}
_YF_CRUMB_LOCK = Lock()


def _yf_invalidate_crumb(expected_crumb: Optional[str] = None):
    """Invalidate only the credential that actually failed.

    The expected value prevents a late 401 from deleting a credential another
    request has already refreshed.
    """
    with _YF_CRUMB_LOCK:
        current = _YF_CRUMB.get("crumb")
        if expected_crumb is not None and current not in (None, expected_crumb):
            return
        _YF_CRUMB.update({"crumb": None, "cookies": None, "ts": 0.0})
        _cache_delete("yf_crumb")

def _yf_get_crumb() -> tuple:
    """
    返回 (crumb, cookies)。
    内存缓存 12h；过期后从 Redis 取；再取不到才重新走认证流程。
    """
    now = time.time()
    if _YF_CRUMB["crumb"] and now - _YF_CRUMB["ts"] < 12 * 3600:
        return _YF_CRUMB["crumb"], _YF_CRUMB["cookies"] or {}

    # A cold page starts several Yahoo consumers concurrently.  Serialize the
    # cookie/crumb handshake and re-check state after acquiring the lock.
    with _YF_CRUMB_LOCK:
        now = time.time()
        if _YF_CRUMB["crumb"] and now - _YF_CRUMB["ts"] < 12 * 3600:
            return _YF_CRUMB["crumb"], _YF_CRUMB["cookies"] or {}

        cached = _cache_get("yf_crumb")
        if cached and cached.get("crumb"):
            _YF_CRUMB.update({**cached, "ts": now})
            return cached["crumb"], cached.get("cookies") or {}

        try:
            import requests as _req
            # fc.yahoo.com returns the A3 cookie even though the page itself is
            # 404.  finance.yahoo.com can return a cookie-less regional page.
            sess = _req.Session()
            sess.get("https://fc.yahoo.com", headers=YF_HEADERS, timeout=(5, 15))
            resp = sess.get(
                "https://query1.finance.yahoo.com/v1/test/getcrumb",
                headers=YF_HEADERS, timeout=(4, 10),
            )
            crumb = resp.text.strip() if resp.ok else ""
            if crumb and not crumb.startswith(("{", "<")):
                cookies = dict(sess.cookies)
                _YF_CRUMB.update({"crumb": crumb, "cookies": cookies, "ts": now})
                _cache_set("yf_crumb", {"crumb": crumb, "cookies": cookies}, 12 * 3600)
                logger.info(f"[yf_crumb] obtained crumb={crumb[:8]}…")
                return crumb, cookies
        except Exception as e:
            logger.warning(f"[yf_crumb] failed: {e}")
        return None, {}


def _yf_chart(symbol: str, interval: str = "1d", range_: str = "5d") -> Optional[dict]:
    """
    带 crumb 认证的 Yahoo Finance chart 请求。
    自动重试一次（crumb 失效时重新获取）。
    """
    for attempt in range(2):
        crumb, cookies = _yf_get_crumb()
        params = {"interval": interval, "range": range_}
        if crumb:
            params["crumb"] = crumb
        try:
            resp = _get(
                f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}",
                params=params,
                headers=YF_HEADERS,
                cookies=cookies or {},
                timeout=(4, 10),
            )
            if resp is not None and resp.status_code in (401, 429) and attempt == 0:
                # crumb 可能过期，重置后重试
                _yf_invalidate_crumb(crumb)
                logger.warning(
                    f"[yf_chart] {resp.status_code} for {symbol}, resetting crumb and retrying"
                )
                continue
            if resp and resp.ok:
                return resp.json()["chart"]["result"][0]
        except Exception as e:
            logger.warning(f"[yf_chart] {symbol} attempt {attempt}: {e}")
    return None





_NASDAQ_UA_POOL = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
]

def _nasdaq_fetch(symbol: str) -> dict:
    """
    Nasdaq.com API：返回 {pct}，primaryData.percentageChange 直接字段（相对昨收的涨跌幅%）。
    盘前/盘后/盘中均有效，不需要手算。失败时自动重试一次。
    """
    url = f"https://api.nasdaq.com/api/quote/{symbol}/info?assetclass=stocks"
    for attempt in range(2):
        try:
            if attempt > 0:
                time.sleep(_random.uniform(0.5, 1.2))
            headers = {
                "User-Agent": _random.choice(_NASDAQ_UA_POOL),
                "Accept": "application/json, text/plain, */*",
                "Accept-Language": "en-US,en;q=0.9",
                "Accept-Encoding": "gzip, deflate, br",
                "Referer": "https://www.nasdaq.com/",
                "Origin": "https://www.nasdaq.com",
            }
            resp = _get(url, headers=headers, timeout=(5, 12))
            if not (resp and resp.ok):
                continue
            primary = (resp.json().get("data") or {}).get("primaryData") or {}
            raw = primary.get("percentageChange", "").replace("%", "").replace("+", "").strip()
            if raw and raw not in ("--", "N/A"):
                try:
                    return {"pct": round(float(raw), 2)}
                except (ValueError, TypeError):
                    pass
        except Exception as e:
            logger.debug(f"[nasdaq_api] {symbol} attempt={attempt}: {e}")
    return {}

# ─── HTTP 工具 ─────────────────────────────────────────────────────────────────

try:
    _PROVIDER_MAX_CONCURRENCY = max(2, min(20, int(os.environ.get("PROVIDER_MAX_CONCURRENCY", "12"))))
except ValueError:
    _PROVIDER_MAX_CONCURRENCY = 12
_PROVIDER_SEMAPHORE = BoundedSemaphore(_PROVIDER_MAX_CONCURRENCY)
_HTTP_LOCAL = local()


def _thread_http_session() -> requests.Session:
    session = getattr(_HTTP_LOCAL, "session", None)
    if session is None:
        session = requests.Session()
        _HTTP_LOCAL.session = session
    return session

def _get(url, **kwargs) -> Optional[requests.Response]:
    """有全局并发上限的安全 GET；避免一次 cron 对上游产生请求风暴。"""
    # Builders never create more workers than this semaphore, but independent
    # routes can briefly overlap during a cold page load.  Queue briefly rather
    # than dropping an otherwise valid provider request after only two seconds.
    if not _PROVIDER_SEMAPHORE.acquire(timeout=8):
        logger.warning(f"GET skipped (provider concurrency limit) {url[:60]}")
        return None
    try:
        return _thread_http_session().get(url, timeout=kwargs.pop("timeout", (2, 4)), **kwargs)
    except Exception as e:
        logger.warning(f"GET {url[:60]}: {e}")
        return None
    finally:
        _PROVIDER_SEMAPHORE.release()

# ─── 数据抓取 ──────────────────────────────────────────────────────────────────

def fetch_fund_realtime(code: str) -> dict:
    """天天基金实时估值（JSONP）"""
    resp = _get(f"https://fundgz.1234567.com.cn/js/{code}.js", headers=HEADERS)
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


def _fetch_basic_information(code: str) -> Optional[dict]:
    """获取东方财富基金基础行情；空 ``Datas`` 不计为成功。"""
    # 每个分类由独立 cron 执行。单次请求必须有界，避免重试把 Vercel
    # 30 秒预算全部耗尽；失败后由 pingzhongdata/LKG 明确降级。
    for attempt in range(1):
        try:
            resp = _get(
                "https://fundmobapi.eastmoney.com/FundMNewApi/FundMNBasicInformation",
                params={
                    "FCODE": code,
                    "deviceid": "wise-etf",
                    "plat": "Wap",
                    "product": "EFund",
                    "version": "6.5.0",
                },
                headers=_MOBILE_HEADERS,
                timeout=(2, 4),
            )
            if not (resp and resp.ok):
                continue
            payload = resp.json()
            data = payload.get("Datas") if payload.get("ErrCode") == 0 else None
            if isinstance(data, dict) and data:
                return data
        except Exception as exc:
            logger.warning(f"[fund_basic] {code} attempt={attempt + 1}: {exc}")
    return None


_TRACK_ERROR_RE = re.compile(r"年化跟踪误差\s+同类平均跟踪误差[\s\S]{0,160}?([0-9]+(?:\.[0-9]+)?)%")
_TRACK_ERROR_DATE_RE = re.compile(r"年化跟踪误差[\s\S]{0,1200}?截止至[：:]\s*(\d{4}-\d{2}-\d{2})")


def _fetch_tracking_error(code: str) -> Optional[dict]:
    """从基金特色数据页读取披露值与披露日；失败不返回伪默认值。"""
    try:
        resp = _get(
            f"https://fundf10.eastmoney.com/tsdata_{code}.html",
            headers=HEADERS,
            timeout=(2, 4),
        )
        if not (resp and resp.ok):
            return None
        import html as _html
        plain = _html.unescape(re.sub(r"<[^>]+>", " ", resp.text))
        plain = re.sub(r"\s+", " ", plain)
        match = _TRACK_ERROR_RE.search(plain)
        date_match = _TRACK_ERROR_DATE_RE.search(plain)
        value = parse_number(match.group(1)) if match else None
        disclosed_as_of = date_match.group(1) if date_match else None
        if value is None or value < 0 or not disclosed_as_of:
            return None
        return {
            "track_error": round(value, 2),
            "track_error_as_of": disclosed_as_of,
            "track_error_source": "eastmoney_tsdata",
            "track_error_fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }
    except Exception as exc:
        logger.warning(f"[track_error] {code}: {exc}")
        return None


def _format_daily_limit(status: str, limit_cny: Optional[float]) -> str:
    if status == "suspended":
        return "暂停申购"
    if status == "limited" and limit_cny is not None:
        value = int(limit_cny) if float(limit_cny).is_integer() else round(limit_cny, 2)
        return f"{value}元"
    if status == "open":
        return "不限额"
    return "待确认"


def _normalize_basic_information(code: str, data: dict) -> dict:
    """把东方财富字段投影成清晰字段，同时保留旧客户端所需字段。"""
    nav = parse_number(data.get("DWJZ"))
    day_change = parse_number(data.get("RZDF"))
    rolling_1y = parse_number(data.get("SYL_1N"))
    return_ytd = parse_number(data.get("SYL_JN"))
    nav_date = str(data.get("FSRQ") or "").strip() or None
    purchase = normalize_purchase(data.get("SGZT"), data.get("MAXSG"))
    status = purchase.status
    # legacy v1 中 limited 仍视为可申购，避免旧小程序把它误画成暂停。
    legacy_status = "open" if status in ("open", "limited") else status
    fetched_at = datetime.now(timezone.utc).isoformat(timespec="seconds")

    return {
        "code": code,
        "nav": nav,
        "nav_date": nav_date,
        "rolling_1y_as_of": nav_date,
        "day_change_as_of": nav_date,
        "day_change": day_change,
        "rolling_1y": rolling_1y,
        "return_ytd": return_ytd,
        "buy_status": legacy_status,
        "subscription_status": status,
        "subscription_status_status": "fresh" if status != "unknown" else "unavailable",
        "daily_limit": _format_daily_limit(status, purchase.daily_limit_cny),
        "daily_limit_cny": purchase.daily_limit_cny,
        "subscription_as_of": datetime.now(_CHINA_TZ).date().isoformat(),
        "source": "eastmoney_basic",
        "daily_source_status": "full",
        "fetched_at": fetched_at,
    }


_NET_WORTH_TREND_RE = re.compile(r"Data_netWorthTrend\s*=\s*(\[.*?\]);", re.DOTALL)
_AC_WORTH_TREND_RE = re.compile(r"Data_ACWorthTrend\s*=\s*(\[.*?\]);", re.DOTALL)


def _valid_iso_date(value: object) -> bool:
    if not isinstance(value, str) or not value.strip():
        return False
    try:
        date.fromisoformat(value.strip())
        return True
    except ValueError:
        return False


def _valid_iso_datetime(value: object) -> bool:
    if not isinstance(value, str) or "T" not in value:
        return False
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.tzinfo is not None
    except ValueError:
        return False


def _china_now() -> datetime:
    return datetime.now(_CHINA_TZ)


def _as_of_instant(value: object) -> Optional[datetime]:
    """Normalize an ISO date/datetime for monotonic snapshot comparisons."""
    if not isinstance(value, str) or not value.strip():
        return None
    raw = value.strip()
    try:
        if "T" in raw:
            parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                return None
            return parsed.astimezone(timezone.utc)
        parsed_date = date.fromisoformat(raw)
        return datetime.combine(parsed_date, datetime.min.time(), tzinfo=timezone.utc)
    except ValueError:
        return None


def _candidate_not_older(candidate_as_of: object, previous_as_of: object) -> bool:
    candidate = _as_of_instant(candidate_as_of)
    if candidate is None:
        return False
    previous = _as_of_instant(previous_as_of)
    return previous is None or candidate >= previous


def _apply_monotonic_group(
    target: dict,
    candidate: dict,
    previous: dict,
    fields: tuple,
    as_of_field: str,
    required_field: str,
) -> bool:
    """Copy one value/date group only when complete and non-regressing."""
    if candidate.get(required_field) is None:
        return False
    if not _candidate_not_older(candidate.get(as_of_field), previous.get(as_of_field)):
        return False
    for field in fields:
        if candidate.get(field) is not None:
            target[field] = candidate[field]
    return True


def _is_publishable_cn_close_quote(value: object, now: Optional[datetime] = None) -> bool:
    """Only a same-day A-share close observation may enter the daily ETF LKG."""
    quote = _as_of_instant(value)
    if quote is None:
        return False
    current = (now or _china_now()).astimezone(_CHINA_TZ)
    quote_cn = quote.astimezone(_CHINA_TZ)
    if current.weekday() >= 5 or quote_cn.weekday() >= 5:
        return False
    if current.date() != quote_cn.date():
        return False
    if (current.hour, current.minute) < (15, 5):
        return False
    return (quote_cn.hour, quote_cn.minute) >= (14, 55)


def _expected_cn_close_date(now: Optional[datetime] = None) -> str:
    """Latest expected completed weekday session; weekday holidays stay stale."""
    current = (now or _china_now()).astimezone(_CHINA_TZ)
    candidate = current.date()
    if current.weekday() >= 5 or (current.hour, current.minute) < (15, 5):
        candidate -= timedelta(days=1)
    while candidate.weekday() >= 5:
        candidate -= timedelta(days=1)
    return candidate.isoformat()


def _china_date_from_timestamp_ms(value: object) -> Optional[str]:
    timestamp_ms = parse_number(value)
    if timestamp_ms is None or timestamp_ms <= 0:
        return None
    try:
        return datetime.fromtimestamp(timestamp_ms / 1000, _CHINA_TZ).date().isoformat()
    except (ValueError, OSError, OverflowError):
        return None


def _latest_ac_nav_date(points: list) -> Optional[str]:
    for point in reversed(points or []):
        if isinstance(point, dict):
            timestamp, nav = point.get("x"), point.get("y")
        elif isinstance(point, (list, tuple)) and len(point) >= 2:
            timestamp, nav = point[0], point[1]
        else:
            continue
        if (parse_number(nav) or 0) > 0:
            as_of = _china_date_from_timestamp_ms(timestamp)
            if as_of:
                return as_of
    return None


def _parse_pingzhong_daily(code: str, script: str) -> Optional[dict]:
    """Parse Eastmoney's public NAV script without inferring purchase state."""
    try:
        trend_match = _NET_WORTH_TREND_RE.search(script or "")
        trend = json.loads(trend_match.group(1)) if trend_match else []
        latest = next(
            (
                point for point in reversed(trend)
                if isinstance(point, dict)
                and parse_number(point.get("x")) is not None
                and (parse_number(point.get("y")) or 0) > 0
            ),
            None,
        )
        if not latest:
            return None

        timestamp_ms = parse_number(latest.get("x"))
        nav = parse_number(latest.get("y"))
        if timestamp_ms is None or nav is None or timestamp_ms <= 0 or nav <= 0:
            return None
        # Eastmoney serializes a China-local midnight as epoch milliseconds.
        # Interpreting it as a UTC calendar date shifts the observation back
        # one day, so convert the instant to UTC+8 before extracting the date.
        nav_date = _china_date_from_timestamp_ms(timestamp_ms)
        if not nav_date:
            return None

        ac_match = _AC_WORTH_TREND_RE.search(script or "")
        ac_trend = json.loads(ac_match.group(1)) if ac_match else []
        rolling_1y = rolling_nav_return(ac_trend)
        rolling_as_of = _latest_ac_nav_date(ac_trend) if rolling_1y is not None else None
        return {
            "code": code,
            "nav": nav,
            "nav_date": nav_date,
            "rolling_1y_as_of": rolling_as_of,
            "day_change_as_of": nav_date,
            "day_change": parse_number(latest.get("equityReturn")),
            "rolling_1y": rolling_1y,
            "source": "eastmoney_pingzhongdata",
            # This source has current NAV history, but deliberately has no
            # authoritative purchase status or limit.
            "daily_source_status": "partial",
            "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }
    except (TypeError, ValueError, json.JSONDecodeError, OSError) as exc:
        logger.warning(f"[pingzhong_parse] {code}: {exc}")
        return None


def _fetch_pingzhong_daily(code: str) -> Optional[dict]:
    """Fallback for daily NAV fields when BasicInformation is unavailable."""
    try:
        resp = _get(
            f"https://fund.eastmoney.com/pingzhongdata/{code}.js",
            headers=HEADERS,
            timeout=(2, 4),
        )
        if not (resp and resp.ok):
            return None
        return _parse_pingzhong_daily(code, resp.text)
    except Exception as exc:
        logger.warning(f"[pingzhong_daily] {code}: {exc}")
        return None


def _fetch_daily_snapshot(code: str) -> Optional[dict]:
    """Fetch a daily product snapshot with a same-provider NAV fallback.

    BasicInformation remains the only source for purchase status and limits.
    The fallback is allowed to fill NAV-derived fields, never subscription
    fields, so a stale limit cannot be presented as current.
    """
    basic = _fetch_basic_information(code)
    if basic:
        snapshot = _normalize_basic_information(code, basic)
        daily_groups = (
            ("nav", "nav_date"),
            ("day_change", "day_change_as_of"),
            ("rolling_1y", "rolling_1y_as_of"),
        )
        if any(snapshot.get(value) is None or not _valid_iso_date(snapshot.get(as_of)) for value, as_of in daily_groups):
            fallback = _fetch_pingzhong_daily(code)
        else:
            fallback = None
        if fallback:
            # Each value/date pair is indivisible.  Never attach a fallback
            # value to BasicInformation's date (or vice versa), and never let
            # an older fallback replace a complete BasicInformation group.
            for value, as_of in daily_groups:
                basic_group_complete = (
                    snapshot.get(value) is not None
                    and _valid_iso_date(snapshot.get(as_of))
                )
                if (
                    not basic_group_complete
                    and fallback.get(value) is not None
                    and _valid_iso_date(fallback.get(as_of))
                ):
                    snapshot[value] = fallback[value]
                    snapshot[as_of] = fallback[as_of]
            snapshot["source"] = "eastmoney_basic+pingzhongdata"
        # Remove half-valid groups rather than publishing a value with the
        # wrong or missing observation date.
        for value, as_of in daily_groups:
            if snapshot.get(value) is None or not _valid_iso_date(snapshot.get(as_of)):
                snapshot[value] = None
                snapshot[as_of] = None
        snapshot["daily_source_status"] = "full" if (
            snapshot.get("nav") is not None
            and _valid_iso_date(snapshot.get("nav_date"))
            and snapshot.get("day_change") is not None
            and _valid_iso_date(snapshot.get("day_change_as_of"))
            and snapshot.get("rolling_1y") is not None
            and _valid_iso_date(snapshot.get("rolling_1y_as_of"))
            and snapshot.get("subscription_status") != "unknown"
        ) else "partial"
        return snapshot
    return _fetch_pingzhong_daily(code)


# 每日会变的字段；规模、费率和自然年度收益由低频元数据任务维护。
_VOLATILE_FUND_FIELDS = {
    "nav", "nav_date", "day_change", "day_change_as_of", "rolling_1y",
    "rolling_1y_as_of", "return_ytd",
    "buy_status", "subscription_status", "daily_limit", "daily_limit_cny",
    "subscription_as_of", "subscription_status_status", "source", "fetched_at", "track_error",
    "track_error_as_of", "track_error_source", "track_error_fetched_at",
    "daily_source_status",
}


def fetch_one_fund(code: str, category: str, _meta_cached=None) -> Optional[dict]:
    return _fetch_daily_snapshot(code)


_SINA_HEADERS = {
    "User-Agent": HEADERS["User-Agent"],
    "Referer":    "https://finance.sina.com.cn/",
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
    resp    = _get(f"https://hq.sinajs.cn/list={symbols}",
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
                "turnover_cny_100m": round(volume_cny / 1e8, 2),
                "change_pct":   change_pct,
                "market_change_pct": change_pct,
                "quote_as_of": (
                    f"{parts[30]}T{parts[31]}+08:00" if len(parts) > 31 and parts[30] and parts[31]
                    else None
                ),
                "quote_source": "sina",
            }
        except Exception:
            continue
    logger.info(f"[sina] got {len(result)}/{len(codes)} ETFs")
    return result


def _sina_stock_batch(yahoo_symbols: List[str]) -> Dict[str, dict]:
    """
    新浪财经批量行情 — A股 + 港股（一次请求）。
    输入 Yahoo Finance 格式的 symbol（如 600519.SS / 000001.SZ / 0700.HK）。
    返回 {yahoo_symbol: {regular_pct}}。

    Sina 字段（逗号分隔）：
      [0]名称  [1]今开  [2]昨收  [3]当前价  [4]最高  [5]最低  [9]成交额
    HK 的字段位置与 A 股相同。
    """
    if not yahoo_symbols:
        return {}

    def _to_sina(sym: str) -> Optional[str]:
        if sym.endswith(".SS"):
            return f"sh{sym[:-3]}"
        if sym.endswith(".SZ"):
            return f"sz{sym[:-3]}"
        if sym.endswith(".HK"):
            code = sym[:-3]
            try:
                return f"hk{int(code):05d}"
            except ValueError:
                return None
        return None

    sina_to_yahoo: Dict[str, str] = {}
    for sym in yahoo_symbols:
        s = _to_sina(sym)
        if s:
            sina_to_yahoo[s] = sym

    if not sina_to_yahoo:
        return {}

    symbols_str = ",".join(sina_to_yahoo.keys())
    try:
        resp = _get(f"https://hq.sinajs.cn/list={symbols_str}",
                    headers=_SINA_HEADERS, timeout=(3, 8))
        if not (resp and resp.ok):
            return {}
        text = resp.content.decode("gbk", errors="ignore")
    except Exception as e:
        logger.warning(f"[sina_stock] batch failed: {e}")
        return {}

    result: Dict[str, dict] = {}
    for line in text.split("\n"):
        m = re.search(r'hq_str_(\w+)="([^"]*)"', line)
        if not m:
            continue
        sina_sym, data = m.group(1), m.group(2)
        parts = data.split(",")
        if len(parts) < 4:
            continue
        yahoo_sym = sina_to_yahoo.get(sina_sym)
        if not yahoo_sym:
            continue
        try:
            prev_close = float(parts[2])   # 昨收（索引2）
            curr_price = float(parts[3])   # 当前价（索引3）
            if prev_close <= 0 or curr_price <= 0:
                continue
            change_pct = round((curr_price - prev_close) / prev_close * 100, 2)
            result[yahoo_sym] = {"regular_pct": change_pct}
        except (ValueError, IndexError):
            continue
    logger.info(f"[sina_stock] got {len(result)}/{len(sina_to_yahoo)} symbols")
    return result


def _twse_batch(tw_symbols: List[str]) -> Dict[str, float]:
    """
    台湾证交所 (TWSE) 批量行情，返回 {symbol.TW: change_pct}。
    ex_ch 支持管道符批量，如 tse_2330.tw|tse_2454.tw。
    """
    if not tw_symbols:
        return {}
    codes = [s[:-3] for s in tw_symbols if s.endswith(".TW")]
    ex_ch = "|".join(f"tse_{c}.tw" for c in codes)
    try:
        r = _get(
            "https://mis.twse.com.tw/stock/api/getStockInfo.jsp",
            params={"ex_ch": ex_ch, "json": "1", "delay": "0"},
            timeout=(3, 8),
        )
        if not (r and r.ok):
            return {}
        items = r.json().get("msgArray", [])
        out: Dict[str, float] = {}
        for item in items:
            code = item.get("c", "")
            z_raw = item.get("z") or item.get("l")   # 当前成交价 / 最近收盘价
            y_raw = item.get("y")                     # 昨收
            try:
                z_f, y_f = float(z_raw), float(y_raw)
                if y_f > 0:
                    out[f"{code}.TW"] = round((z_f - y_f) / y_f * 100, 2)
            except (TypeError, ValueError):
                continue
        logger.info(f"[twse] got {len(out)}/{len(codes)} symbols")
        return out
    except Exception as e:
        logger.warning(f"[twse] batch failed: {e}")
        return {}


def _naver_kr_batch(kr_symbols: List[str]) -> Dict[str, float]:
    """
    Naver Finance 韩股行情，返回 {symbol.KS: change_pct}。
    """
    if not kr_symbols:
        return {}
    codes = [s[:-3] for s in kr_symbols if s.endswith(".KS")]
    out: Dict[str, float] = {}
    for code in codes:
        try:
            r = _get(
                f"https://polling.finance.naver.com/api/realtime/domestic/stock/{code}",
                headers={"Referer": "https://finance.naver.com/"},
                timeout=(3, 6),
            )
            if not (r and r.ok):
                continue
            datas = r.json().get("datas", [])
            if not datas:
                continue
            pct_raw = datas[0].get("fluctuationsRatioRaw")
            if pct_raw is not None:
                out[f"{code}.KS"] = float(pct_raw)
        except Exception as e:
            logger.warning(f"[naver_kr] {code}: {e}")
    logger.info(f"[naver_kr] got {len(out)}/{len(codes)} symbols")
    return out


def _fetch_intl_stocks(symbols: List[str]) -> Dict[str, float]:
    """台股(.TW)→TWSE，韩股(.KS)→Naver，并发执行，返回 {sym: pct}。"""
    tw = [s for s in symbols if s.endswith(".TW")]
    kr = [s for s in symbols if s.endswith(".KS")]
    result: Dict[str, float] = {}
    from concurrent.futures import ThreadPoolExecutor, as_completed
    futs = {}
    with ThreadPoolExecutor(max_workers=2) as ex:
        if tw:
            futs[ex.submit(_twse_batch, tw)] = "tw"
        if kr:
            futs[ex.submit(_naver_kr_batch, kr)] = "kr"
        for fut in as_completed(futs):
            try:
                result.update(fut.result())
            except Exception as e:
                logger.warning(f"[fetch_intl] {futs[fut]} failed: {e}")
    return result


def fetch_etfs_em_fallback(codes: List[str]) -> Dict[str, dict]:
    """
    东方财富 ETF 行情（首选源）。
    f43: 最新价（×1000 → 元）  f170: 涨跌幅（×100 → %）
    f48: 成交额（元）           f86: 行情 Unix 时间
    """
    def _secid(c: str) -> str:
        return f"1.{c}" if c.startswith("5") else f"0.{c}"

    def _fetch_one(c: str) -> Optional[dict]:
        resp = None
        for _attempt in range(2):
            resp = _get(
                "https://push2.eastmoney.com/api/qt/stock/get",
                params={"secid": _secid(c), "fields": "f43,f48,f86,f170", "cb": "cb"},
                headers=HEADERS, timeout=(3, 6),
            )
            if resp and resp.ok:
                break
        if not (resp and resp.ok):
            return None
        try:
            m = re.search(r"cb\((.+)\)", resp.text)
            if not m:
                return None
            d = json.loads(m.group(1)).get("data") or {}
            price_raw = parse_number(d.get("f43"))
            chg_raw   = parse_number(d.get("f170"))
            turnover_raw = parse_number(d.get("f48"))
            quote_ts = parse_number(d.get("f86"))
            if price_raw is None or price_raw <= 0:
                return None
            quote_as_of = None
            if quote_ts and quote_ts > 0:
                try:
                    quote_as_of = datetime.fromtimestamp(quote_ts, timezone.utc).isoformat(timespec="seconds")
                except (ValueError, OSError, OverflowError):
                    pass
            turnover = round(turnover_raw / 1e8, 2) if turnover_raw is not None else None
            return {
                "market_price": round(price_raw / 1000, 4),
                "change_pct":   round(chg_raw / 100, 2) if chg_raw is not None else None,
                "market_change_pct": round(chg_raw / 100, 2) if chg_raw is not None else None,
                "volume":       turnover,
                "turnover_cny_100m": turnover,
                "quote_as_of": quote_as_of,
                "quote_source": "eastmoney_push2",
            }
        except Exception:
            return None

    if not codes:
        return {}
    ex  = ThreadPoolExecutor(max_workers=min(8, len(codes)))
    res: Dict[str, dict] = {}
    try:
        futs = {ex.submit(_fetch_one, c): c for c in codes}
        done, not_done = wait(list(futs), timeout=6)
        for fut in not_done:
            fut.cancel()
        for fut in done:
            c = futs[fut]
            try:
                data = fut.result()
                if data:
                    res[c] = data
            except Exception:
                pass
    finally:
        ex.shutdown(wait=True, cancel_futures=True)
    logger.info(f"[em_fallback] got {len(res)}/{len(codes)} ETFs")
    return res


# ─── 市场情绪数据源 ──────────────────────────────────────────────────────────────

def fetch_index_price(symbol: str) -> dict:
    """从 Yahoo Finance 获取指数实时点位 + 多周期涨幅 + 近15日历史"""
    try:
        result = _yf_chart(symbol, interval="1d", range_="1y")
        if not result:
            return {}
        meta   = result["meta"]
        price  = meta.get("regularMarketPrice")
        if not price:
            return {}
        price = float(price)
        timestamps = result.get("timestamp", [])
        closes_raw = result["indicators"]["quote"][0].get("close", [])
        # 过滤空值
        pairs = [(ts, float(c)) for ts, c in zip(timestamps, closes_raw) if c is not None]
        if not pairs:
            return {}
        # 多周期涨幅：从末尾往前数交易日
        def pct(n):
            if len(pairs) < n + 1:
                return None
            base = pairs[-(n + 1)][1]
            return round((price - base) / base * 100, 2) if base else None
        def yr1():
            if len(pairs) < 2:
                return None
            base = pairs[0][1]
            return round((price - base) / base * 100, 2) if base else None
        returns = {
            "d15":  pct(15),
            "mo1":  pct(21),
            "mo6":  pct(126),
            "yr1":  yr1(),
        }
        # 近15日历史（用于图表）+ 追加今日实时价格
        history = [
            {"date": datetime.utcfromtimestamp(ts).strftime("%m/%d"), "close": round(c, 2)}
            for ts, c in pairs[-15:]
        ]
        market_timestamp = parse_number(meta.get("regularMarketTime"))
        today_str = (
            datetime.fromtimestamp(market_timestamp, timezone.utc).strftime("%m/%d")
            if market_timestamp is not None and market_timestamp > 0
            else datetime.fromtimestamp(pairs[-1][0], timezone.utc).strftime("%m/%d")
        )
        if history and history[-1]["date"] != today_str:
            history.append({"date": today_str, "close": round(price, 2)})
        # 今日涨跌（用 regularMarketPreviousClose/previousClose，避免 chartPreviousClose 取到年初价格）
        prev = meta.get("regularMarketPreviousClose") or meta.get("previousClose") or (pairs[-2][1] if len(pairs) >= 2 else None)
        change_pct = round((price - float(prev)) / float(prev) * 100, 2) if prev else None
        # 连涨/连跌天数（从最近一天往前数）
        closes_all = [c for _, c in pairs]
        streak = 0
        for i in range(len(closes_all) - 1, 0, -1):
            diff = closes_all[i] - closes_all[i - 1]
            if streak == 0:
                streak = 1 if diff > 0 else -1
            elif (streak > 0 and diff > 0) or (streak < 0 and diff < 0):
                streak += (1 if streak > 0 else -1)
            else:
                break
        # 近1年最高点 / 最低点
        yr_high = round(max(closes_all), 2)
        yr_low  = round(min(closes_all), 2)
        pct_from_high = round((price - yr_high) / yr_high * 100, 2) if yr_high else None
        return {
            "price": round(price, 2),
            "change_pct": change_pct,
            "returns": returns,
            "history": history,
            "streak": streak,          # 正=连涨N天，负=连跌N天
            "yr_high": yr_high,
            "yr_low": yr_low,
            "pct_from_high": pct_from_high,  # 距年内高点的差距
            "as_of": datetime.fromtimestamp(
                market_timestamp if market_timestamp is not None and market_timestamp > 0 else pairs[-1][0],
                timezone.utc,
            ).date().isoformat(),
            "source": "Yahoo Finance chart",
            "return_type": "price",
        }
    except Exception as e:
        logger.warning(f"[index_price:{symbol}] {e}")
    return {}


def fetch_vix() -> dict:
    """从 CBOE 官方延迟行情 API 获取 VIX 恐慌指数。"""
    try:
        url = "https://cdn.cboe.com/api/global/delayed_quotes/quotes/_VIX.json"
        resp = _get(url, timeout=(4, 10), headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                          "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        })
        if not (resp and resp.ok):
            return {}
        d = resp.json().get("data", {})
        price = parse_number(d.get("current_price"))
        if price is None or price <= 0:
            return {}
        ts = d.get("last_trade_time", "")[:10]
        change = parse_number(d.get("price_change"))
        change_pct = parse_number(d.get("price_change_percent"))
        return {
            "value": round(price, 2),
            "change": round(change, 2) if change is not None else None,
            "change_pct": round(change_pct, 2) if change_pct is not None else None,
            "date": ts,
            "as_of": ts or None,
            "source": "CBOE delayed quotes",
            "status": "fresh" if ts else "partial",
        }
    except Exception as e:
        logger.warning(f"[vix] {e}")
    return {}

def fetch_fear_greed() -> dict:
    """从 CNN 获取恐慌贪婪指数"""
    try:
        url = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata"
        resp = _get(url, timeout=(4, 12), headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                          "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Referer": "https://edition.cnn.com/markets/fear-and-greed",
        })
        if not (resp and resp.ok):
            return {}
        fg = resp.json().get("fear_and_greed", {})
        score = parse_number(fg.get("score"))
        if score is None or not 0 <= score <= 100:
            return {}
        prev_close = fg.get("previous_close")
        prev_week  = fg.get("previous_1_week")
        timestamp = str(fg.get("timestamp") or "").strip() or None
        return {
            "score": round(score, 1),
            "rating": fg.get("rating", ""),
            "previous_close": round(float(prev_close), 1) if prev_close is not None else None,
            "previous_1_week": round(float(prev_week), 1) if prev_week is not None else None,
            "as_of": timestamp,
            "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "source": "CNN Fear & Greed",
        }
    except Exception as e:
        logger.warning(f"[fear_greed] {e}")
    return {}

def fetch_sp500_pe() -> dict:
    """从 multpl.com 获取 S&P 500 当前市盈率，结合历史年度 PE 分布计算分位。
    当前 PE：multpl.com（Standard & Poor's），实时更新；
    历史分位：使用 1950–2025 年度 PE 数据（来源同 multpl.com）。
    """
    # S&P 500 年度 PE 历史分布（1950–2025，来源：multpl.com / S&P Global）
    # 用于计算当前估值的历史分位（越低越便宜）
    _PE_HIST = [
        7.73, 7.45, 11.33, 11.04, 12.46, 12.45, 14.57, 15.26, 12.97, 17.66,  # 1950–1959
        18.02, 22.37, 22.76, 18.98, 21.06, 20.31, 19.87, 16.77, 17.27, 19.07,  # 1960–1969
        17.23, 17.23, 18.91, 17.82, 13.74,  7.35, 11.74, 11.58,  8.47,  7.58,  # 1970–1979
         7.35,  8.14,  9.14, 12.58, 11.18, 13.86, 15.04, 21.24, 14.84, 12.74,  # 1980–1989
        15.57, 26.12, 25.81, 21.30, 17.32, 16.01, 18.95, 22.38, 27.95, 33.48,  # 1990–1999
        30.44, 45.84, 46.50, 31.89, 22.73, 20.57, 17.85, 17.36, 21.46, 70.91,  # 2000–2009
        18.11, 16.31, 14.87, 17.38, 18.15, 20.02, 24.21, 25.59, 24.79, 21.15,  # 2010–2019
        26.23, 40.15, 29.27, 21.63, 26.12, 28.77,                               # 2020–2025
    ]
    try:
        url = "https://www.multpl.com/s-p-500-pe-ratio/table/by-month"
        resp = _get(url, timeout=(4, 15), headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                          "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml",
        })
        if not (resp and resp.ok):
            return {}
        import re as _re
        cells = _re.findall(r"<td[^>]*>([\s\S]*?)</td>", resp.text)
        def strip_tags(s):
            return _re.sub(r"<[^>]+>", "", s).strip()
        texts = [strip_tags(c) for c in cells]
        current_pe = None
        current_date = None
        i = 0
        while i < len(texts) - 1:
            date_t = texts[i]
            val_t  = texts[i + 1]
            if _re.match(r"\w+\s+\d+,?\s*\d{4}", date_t):
                m = _re.search(r"(\d+\.?\d*)", val_t)
                if m:
                    v = float(m.group(1))
                    if 3.0 < v < 150.0:  # 有效 PE 范围
                        current_pe = v
                        current_date = date_t
                        break
            i += 1
        if current_pe is None:
            return {}
        rank = sum(1 for x in _PE_HIST if x <= current_pe)
        percentile = round(rank / len(_PE_HIST) * 100)
        parsed_date = None
        if current_date:
            for fmt in ("%B %d, %Y", "%B %d %Y", "%b %d, %Y", "%b %d %Y"):
                try:
                    parsed_date = datetime.strptime(current_date, fmt).date().isoformat()
                    break
                except ValueError:
                    pass
        return {
            "pe": round(current_pe, 1),
            "percentile": percentile,
            "as_of": parsed_date,
            "source": "Multpl / S&P 500 PE Ratio",
            "pe_type": "trailing",
            "percentile_basis": "annual_observations_1950_2025",
            "percentile_status": "approximate",
        }
    except Exception as e:
        logger.warning(f"[sp500_pe] {e}")
    return {}


def fetch_sp500_pe_history(start_year: int = 1990) -> list:
    """S&P500 历史 PE 参考序列。

    Multpl 抓取值标记为 observed；仅有年度样本时生成的月度插值明确
    标记为 estimated。调用方不得把 estimated 序列描述成月度实测值。
    """
    # ── 内嵌年度 PE（1990–2025，来源 multpl.com 年度均值）────────────────
    _ANNUAL_SP = {
        1990:15.57, 1991:26.12, 1992:25.81, 1993:21.30, 1994:17.32,
        1995:16.01, 1996:18.95, 1997:22.38, 1998:27.95, 1999:33.48,
        2000:30.44, 2001:45.84, 2002:46.50, 2003:31.89, 2004:22.73,
        2005:20.57, 2006:17.85, 2007:17.36, 2008:21.46, 2009:70.91,
        2010:18.11, 2011:16.31, 2012:14.87, 2013:17.38, 2014:18.15,
        2015:20.02, 2016:24.21, 2017:25.59, 2018:24.79, 2019:21.15,
        2020:26.23, 2021:40.15, 2022:29.27, 2023:21.63, 2024:26.12,
        2025:28.77,
    }

    def _interpolate_annual(annual: dict, from_year: int) -> list:
        years = sorted(annual.keys())
        current_ym = datetime.now(_CHINA_TZ).strftime("%Y-%m")
        result = []
        for i, yr in enumerate(years):
            if yr < from_year:
                continue
            pe_s = annual[yr]
            pe_e = annual[years[i + 1]] if i < len(years) - 1 else pe_s
            for mo in range(1, 13):
                ym = f"{yr}-{mo:02d}"
                if ym > current_ym:
                    break
                result.append({
                    "date": ym,
                    "pe": round(pe_s + (pe_e - pe_s) * (mo - 1) / 12, 2),
                    "quality": "estimated",
                    "source": "embedded_annual_interpolation",
                })
        return result

    # ── 先尝试 multpl.com ────────────────────────────────────────────────
    try:
        import re as _re
        _MONTH_MAP = {"Jan":1,"Feb":2,"Mar":3,"Apr":4,"May":5,"Jun":6,
                      "Jul":7,"Aug":8,"Sep":9,"Oct":10,"Nov":11,"Dec":12}
        url = "https://www.multpl.com/s-p-500-pe-ratio/table/by-month"
        resp = _get(url, timeout=(4, 20), headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                          "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml",
        })
        if resp and resp.ok:
            cells = _re.findall(r"<td[^>]*>([\s\S]*?)</td>", resp.text)
            strip = lambda s: _re.sub(r"<[^>]+>", "", s).strip()
            texts = [strip(c) for c in cells]
            scraped = []
            i = 0
            while i < len(texts) - 1:
                m_d = _re.match(r"(\w{3})\w*\s+\d+,?\s*(\d{4})", texts[i])
                if m_d:
                    mon, yr = m_d.group(1), int(m_d.group(2))
                    m_v = _re.search(r"(\d+\.?\d*)", texts[i + 1])
                    if m_v:
                        v = float(m_v.group(1))
                        if 3.0 < v < 200.0:
                            scraped.append({
                                "date": f"{yr}-{_MONTH_MAP.get(mon,1):02d}",
                                "pe": round(v, 2),
                                "quality": "observed",
                                "source": "multpl_monthly_table",
                            })
                i += 1
            scraped.sort(key=lambda x: x["date"])
            # 若数据足够完整（从 2000 年前开始，超过 200 条）直接使用
            if len(scraped) > 200 and scraped[0]["date"] < "2005-01":
                logger.info(f"[sp500_pe_history] multpl ok, {len(scraped)} pts")
                return [r for r in scraped if r["date"] >= f"{start_year}-01"]
            # 否则：用插值历史打底，再与抓到的实测月份取并集。年度表只到
            # 2025，不能因此把已抓到的 2026 实测行丢掉。
            base = _interpolate_annual(_ANNUAL_SP, start_year)
            if scraped:
                merged = {r["date"]: r for r in base}
                merged.update({r["date"]: r for r in scraped if r["date"] >= f"{start_year}-01"})
                base = [merged[key] for key in sorted(merged)]
            logger.info(f"[sp500_pe_history] fallback+union, {len(base)} pts")
            return base
    except Exception as e:
        logger.warning(f"[sp500_pe_history] {e}")

    # ── 纯 fallback ───────────────────────────────────────────────────────
    return _interpolate_annual(_ANNUAL_SP, start_year)


def fetch_nasdaq100_pe() -> dict:
    """获取 QQQ PE，作为纳指100估值代理。

    不再把 2026-04 的硬编码值冒充当前值，也不再用来源混杂的年度数组
    计算伪精确分位。没有同口径历史序列时 percentile 明确返回 ``None``。
    """
    # Invesco 是 QQQ 基金管理人；该接口给出带 effectiveDate 的组合加权
    # harmonic trailing PE，不依赖 Yahoo 的区域性 cookie/crumb 权限。
    invesco_url = "https://dng-api.invesco.com/cache/v1/accounts/en_US/shareclasses/46090E103"
    invesco_params = {
        "variationType": "fundCharacteristics",
        "idType": "cusip",
        "productType": "ETF",
    }
    invesco_headers = {
        "User-Agent": YF_HEADERS["User-Agent"],
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://www.invesco.com/",
        "Origin": "https://www.invesco.com",
    }
    for attempt in range(2):
        try:
            resp = _get(
                invesco_url,
                params=invesco_params,
                timeout=(4, 10),
                headers=invesco_headers,
            )
            if resp is not None and resp.ok:
                payload = resp.json() or {}
                pe = parse_number(payload.get("priceToEarningsRatio"))
                effective_date = str(payload.get("effectiveDate") or "").strip() or None
                if pe is not None and 5.0 < pe < 500.0 and _valid_iso_date(effective_date):
                    return {
                        "pe": round(pe, 1),
                        "percentile": None,
                        "as_of": effective_date,
                        "source": "Invesco QQQ fund characteristics",
                        "pe_type": "weighted_harmonic_trailing",
                        "proxy": True,
                        "data_status": "fresh",
                        "percentile_status": "unavailable_same_basis_history",
                    }
        except Exception as e:
            logger.warning(f"[nasdaq100_pe] invesco attempt {attempt}: {e}")
        if attempt == 0:
            time.sleep(0.15)

    # Last resort is an explicitly dated, official published reference.  It is
    # displayable but must keep the overall market snapshot partial.
    return {
        "pe": 34.45,
        "percentile": None,
        "as_of": "2026-06-30",
        "source": "Invesco QQQ Q2 2026 factsheet",
        "pe_type": "weighted_harmonic_trailing",
        "proxy": True,
        "data_status": "reference",
        "percentile_status": "unavailable_same_basis_history",
    }


def fetch_nasdaq100_pe_history(_current_pe: float = None) -> list:
    """获取纳指100/QQQ PE 历史参考序列。

    只有来源返回的连续序列标为 observed；fallback 是年度参考值的线性插值，
    标为 estimated，且不会用价格比例或当前 PE 伪造缺失月份。
    """
    # 年度实际 PE（1990–2025）来源：macrotrends / QQQ factsheet / 多方核对
    _ANNUAL = {
        1990: 17.5,  1991: 18.2,  1992: 19.8,  1993: 21.3,  1994: 18.5,
        1995: 22.4,  1996: 27.1,  1997: 30.8,  1998: 45.2,  1999: 75.3,
        2000: 102.4, 2001: 48.9,  2002: 26.1,  2003: 30.4,  2004: 26.4,
        2005: 22.8,  2006: 21.4,  2007: 24.6,  2008: 20.2,  2009: 19.5,
        2010: 21.3,  2011: 19.0,  2012: 20.3,  2013: 23.2,  2014: 23.8,
        2015: 23.5,  2016: 22.8,  2017: 26.6,  2018: 23.4,  2019: 29.8,
        2020: 36.2,  2021: 38.5,  2022: 24.4,  2023: 32.2,  2024: 34.6,
        2025: 31.5,
    }
    # 尝试 macrotrends 月度数据
    try:
        import re as _re, json as _json
        url = "https://www.macrotrends.net/stocks/charts/QQQ/invesco-qqq-trust/pe-ratio"
        resp = _get(url, timeout=(5, 20), headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                          "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml",
            "Referer": "https://www.macrotrends.net/",
        })
        if resp and resp.ok:
            m = _re.search(r"var\s+originalData\s*=\s*(\[.*?\])\s*;", resp.text, _re.DOTALL)
            if m:
                raw = _json.loads(m.group(1))
                result = []
                for item in raw:
                    date_s = str(item.get("date", ""))[:7]
                    val = item.get("value")
                    if date_s >= "1990-01" and val:
                        try:
                            v = float(val)
                            if 3.0 < v < 500.0:
                                result.append({
                                    "date": date_s,
                                    "pe": round(v, 2),
                                    "quality": "observed",
                                    "source": "macrotrends_qqq_pe",
                                })
                        except (ValueError, TypeError):
                            pass
                result.sort(key=lambda x: x["date"])
                # 要求数据足够多且历史足够长（macrotrends 只返回近期则丢弃）
                if len(result) > 200 and result[0]["date"] < "2005-01":
                    logger.info(f"[nasdaq100_pe_history] macrotrends ok, {len(result)} points")
                    return result
    except Exception as e:
        logger.warning(f"[nasdaq100_pe_history macrotrends] {e}")

    # Fallback：年度数据线性插值为月度
    years = sorted(_ANNUAL.keys())
    result = []
    current_ym = datetime.now(_CHINA_TZ).strftime("%Y-%m")
    for i, yr in enumerate(years):
        pe_start = _ANNUAL[yr]
        pe_end   = _ANNUAL[years[i + 1]] if i < len(years) - 1 else pe_start
        for mo in range(1, 13):
            ym = f"{yr}-{mo:02d}"
            if ym > current_ym:
                break
            frac = (mo - 1) / 12
            result.append({
                "date": ym,
                "pe": round(pe_start + (pe_end - pe_start) * frac, 2),
                "quality": "estimated",
                "source": "embedded_annual_interpolation",
            })
    result.sort(key=lambda x: x["date"])
    logger.info(f"[nasdaq100_pe_history] fallback interpolated, {len(result)} points")
    return result


def _yf_monthly(symbol: str) -> dict:
    res = _yf_chart(symbol, interval="1mo", range_="11y")
    if not res:
        raise ConnectionError(f"Yahoo Finance unavailable for {symbol}")
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
    track_map: Dict[str, dict] = {}
    previous = _lkg_get(f"funds_{category}") or []
    previous_map = {
        item.get("code"): item for item in previous
        if isinstance(item, dict) and item.get("code")
    }

    needs_tracking = category in ("nasdaq_passive", "sp500_passive")
    ex = ThreadPoolExecutor(
        max_workers=min(16 if needs_tracking else 10, _PROVIDER_MAX_CONCURRENCY)
    )
    try:
        fs = {ex.submit(fetch_one_fund, code, category): code for code in codes}
        track_fs = {ex.submit(_fetch_tracking_error, code): code for code in codes} if needs_tracking else {}
        done, not_done = wait(list(fs) + list(track_fs), timeout=20)
        for fut in not_done:
            fut.cancel()
        for fut in done:
            if fut in fs:
                try:
                    item = fut.result()
                    if item:
                        live_map[item["code"]] = item
                except Exception:
                    pass
            elif fut in track_fs:
                try:
                    item = fut.result()
                    if item:
                        track_map[track_fs[fut]] = item
                except Exception:
                    pass
    finally:
        # Running futures cannot be cancelled.  Wait for their bounded HTTP
        # timeouts so the next sequential cron category cannot overlap them.
        ex.shutdown(wait=True, cancel_futures=True)

    success_rate = len(live_map) / len(codes)
    logger.info(f"[{category}] {len(live_map)}/{len(codes)} live ({success_rate:.0%})")

    # 目录静态元数据始终优先；LKG 只补日更字段，不能把旧规模/费率覆盖回来。
    results = []
    for fb in static:
        live = live_map.get(fb["code"]) or {}
        track = track_map.get(fb["code"]) or {}
        previous_row = previous_map.get(fb["code"]) or {}
        previous_dynamic = {
            k: v for k, v in previous_row.items()
            if k in _VOLATILE_FUND_FIELDS and v is not None
        }
        # 目录可能刚完成一次低频更新；较旧的运行时跟踪误差不得反向覆盖它。
        if (
            previous_dynamic.get("track_error_as_of")
            and fb.get("track_error_as_of")
            and previous_dynamic["track_error_as_of"] < fb["track_error_as_of"]
        ):
            for key in ("track_error", "track_error_as_of", "track_error_source"):
                previous_dynamic.pop(key, None)
        merged = {**fb, **previous_dynamic}
        nav_accepted = _apply_monotonic_group(
            merged,
            live,
            previous_row,
            ("nav", "nav_date", "return_ytd"),
            "nav_date",
            "nav",
        )
        day_accepted = _apply_monotonic_group(
            merged,
            live,
            previous_row,
            ("day_change", "day_change_as_of"),
            "day_change_as_of",
            "day_change",
        )
        rolling_accepted = _apply_monotonic_group(
            merged,
            live,
            previous_row,
            ("rolling_1y", "rolling_1y_as_of"),
            "rolling_1y_as_of",
            "rolling_1y",
        )
        subscription_fields = (
            "buy_status", "subscription_status", "subscription_status_status",
            "daily_limit", "daily_limit_cny", "subscription_as_of",
        )
        subscription_candidate_fresh = (
            live.get("subscription_status_status") == "fresh"
            and live.get("subscription_status") != "unknown"
            and live.get("subscription_as_of") == _china_now().date().isoformat()
        )
        subscription_accepted = subscription_candidate_fresh and _apply_monotonic_group(
            merged,
            live,
            previous_row,
            subscription_fields,
            "subscription_as_of",
            "subscription_status",
        )
        track_accepted = _apply_monotonic_group(
            merged,
            track,
            previous_row,
            ("track_error", "track_error_as_of", "track_error_source", "track_error_fetched_at"),
            "track_error_as_of",
            "track_error",
        )
        if live:
            merged["source"] = live.get("source")
            merged["fetched_at"] = live.get("fetched_at")
            merged["daily_source_status"] = live.get("daily_source_status")
        merged.setdefault("annual_return_2025", merged.get("ytd_return"))
        if "subscription_status" not in merged:
            if merged.get("buy_status") == "suspended":
                merged["subscription_status"] = "suspended"
            elif merged.get("buy_status") == "open":
                limit = parse_number(merged.get("daily_limit"))
                merged["subscription_status"] = "limited" if limit and limit > 0 else "open"
            else:
                merged["subscription_status"] = "unknown"
        if track_accepted:
            merged["track_error_status"] = "fresh"
        elif merged.get("track_error") is not None and _valid_iso_date(merged.get("track_error_as_of")):
            merged["track_error_status"] = "stale"
        else:
            merged["track_error_status"] = "unavailable"

        if live:
            daily_full = nav_accepted and day_accepted and rolling_accepted and subscription_accepted
            if not subscription_accepted:
                # A NAV-only fallback must never make a retained purchase
                # limit look current.
                merged.update({
                    "buy_status": "unknown",
                    "subscription_status": "unknown",
                    "subscription_status_status": "unavailable",
                    "daily_limit": "待确认",
                    "daily_limit_cny": None,
                    "subscription_as_of": None,
                })
            # Tracking error has its own low-frequency disclosure date.  A
            # provider failure there must not block today's NAV/subscription
            # snapshot from becoming the new LKG.
            merged["data_status"] = "fresh" if daily_full else "partial"
            merged["daily_status"] = "fresh" if daily_full else "partial"
        else:
            merged["data_status"] = "stale" if fb["code"] in previous_map else "reference"
            merged["daily_status"] = "stale" if fb["code"] in previous_map else "unavailable"
            if fb["code"] in previous_map:
                merged["subscription_status_status"] = "stale"
        results.append(merged)

    results = safe_sort(
        results,
        key=lambda row: row.get("rolling_1y"),
        reverse=True,
    )
    source = "live" if results and all(row.get("data_status") == "fresh" for row in results) else (
        "partial" if success_rate > 0 else "none"
    )
    return results, source


def _build_etfs() -> tuple:
    """
    构建每日 ETF 收盘快照，返回 (results, source)。

    - 东方财富 Push2：市价、场内涨跌、成交额、行情时间（首选）
    - 新浪财经：仅补齐缺失市价
    - 东方财富 BasicInformation：最新已公布 NAV、净值日期、滚动一年
    - 同站 pingzhongdata：BasicInformation 失败时补 NAV 派生字段

    任一侧缺失时 premium 必须为 ``None``，绝不沿用静态旧溢价。
    """
    codes = [etf["code"] for etf in STATIC_ETFS]

    quote_map: Dict[str, dict] = {}
    basic_map: Dict[str, dict] = {}
    track_map: Dict[str, dict] = {}
    previous = _lkg_get("etfs") or []
    previous_map = {
        item.get("code"): item for item in previous
        if isinstance(item, dict) and item.get("code")
    }

    ex = ThreadPoolExecutor(max_workers=min(16, _PROVIDER_MAX_CONCURRENCY))
    try:
        # Sina is one bounded batch request and avoids a nested executor
        # competing with NAV tasks for the same provider semaphore.
        quote_fut = ex.submit(fetch_etfs_sina_batch, codes)
        basic_futs: Dict = {ex.submit(_fetch_daily_snapshot, c): c for c in codes}
        track_futs: Dict = {ex.submit(_fetch_tracking_error, c): c for c in codes}

        all_futs = [quote_fut] + list(basic_futs.keys()) + list(track_futs.keys())
        done, not_done = wait(all_futs, timeout=24)

        for fut in not_done:
            fut.cancel()
        for fut in done:
            if fut is quote_fut:
                try:
                    quote_map = fut.result() or {}
                except Exception:
                    pass
            elif fut in basic_futs:
                code = basic_futs[fut]
                try:
                    data = fut.result()
                    if data:
                        basic_map[code] = data
                except Exception:
                    pass
            elif fut in track_futs:
                code = track_futs[fut]
                try:
                    data = fut.result()
                    if data:
                        track_map[code] = data
                except Exception:
                    pass
    finally:
        ex.shutdown(wait=True, cancel_futures=True)

    # 新浪缺失时才调用东方财富逐只补齐。
    missing = [c for c in codes if c not in quote_map]
    if 0 < len(missing) <= 4:
        quote_map.update(fetch_etfs_em_fallback(missing))
    elif missing:
        logger.warning(f"[etfs] Sina missing {len(missing)} quotes; skip broad fallback to keep cron deadline")

    quote_count = 0
    premium_count = 0
    results = []
    for fb in STATIC_ETFS:
        code = fb["code"]
        quote = quote_map.get(code) or {}
        basic = basic_map.get(code) or {}
        track = track_map.get(code) or {}
        previous_row = previous_map.get(code) or {}
        market_price = parse_number(quote.get("market_price"))
        nav = parse_number(basic.get("nav"))
        nav_date = str(basic.get("nav_date") or "").strip() or None
        quote_is_current = (
            market_price is not None
            and market_price > 0
            and _valid_iso_datetime(quote.get("quote_as_of"))
            and _is_publishable_cn_close_quote(quote.get("quote_as_of"))
        )
        nav_is_current = nav is not None and nav > 0 and _valid_iso_date(nav_date)
        # 只允许同一轮同时拿到的行情和净值参与计算。任一侧失败时保留上次
        # premium 及其原日期，绝不跨日期拼出一个“新”溢价率。
        premium = None

        normalized_basic = basic
        quote_fields = (
            "market_price", "market_change_pct", "change_pct", "turnover_cny_100m",
            "volume", "quote_as_of", "quote_source",
        )
        nav_fields = (
            "nav", "nav_date", "nav_as_of", "nav_source", "rolling_1y",
            "rolling_1y_as_of", "day_change", "day_change_as_of",
        )
        nav_core_fields = ("nav", "nav_date", "nav_as_of", "nav_source")
        premium_fields = (
            "premium", "premium_pct", "premium_as_of", "premium_quote_as_of",
            "premium_nav_as_of", "premium_basis",
        )
        track_fields = ("track_error", "track_error_as_of", "track_error_source", "track_error_fetched_at")
        retained = {
            key: previous_row.get(key)
            for key in (*quote_fields, *nav_fields, *premium_fields, *track_fields)
            if previous_row.get(key) is not None
        }
        merged = {**fb, **retained}
        if quote_is_current:
            quote_candidate = {
                "market_price": market_price,
                "market_change_pct": quote.get("market_change_pct"),
                "change_pct": quote.get("change_pct"),
                "turnover_cny_100m": quote.get("turnover_cny_100m"),
                "volume": quote.get("volume"),
                "quote_as_of": quote.get("quote_as_of"),
                "quote_source": quote.get("quote_source"),
            }
            quote_is_current = _apply_monotonic_group(
                merged,
                quote_candidate,
                previous_row,
                quote_fields,
                "quote_as_of",
                "market_price",
            )
        if nav_is_current:
            nav_update = {
                "nav": nav,
                "nav_date": nav_date,
                "nav_as_of": nav_date,
                "nav_source": normalized_basic.get("source"),
            }
            nav_is_current = _apply_monotonic_group(
                merged,
                nav_update,
                previous_row,
                nav_core_fields,
                "nav_date",
                "nav",
            )
        rolling_is_current = _apply_monotonic_group(
            merged,
            normalized_basic,
            previous_row,
            ("rolling_1y", "rolling_1y_as_of"),
            "rolling_1y_as_of",
            "rolling_1y",
        )
        day_is_current = _apply_monotonic_group(
            merged,
            normalized_basic,
            previous_row,
            ("day_change", "day_change_as_of"),
            "day_change_as_of",
            "day_change",
        )
        track_accepted = _apply_monotonic_group(
            merged,
            track,
            previous_row,
            track_fields,
            "track_error_as_of",
            "track_error",
        )
        if not track_accepted and fb.get("track_error_as_of") and (
            not merged.get("track_error_as_of") or merged["track_error_as_of"] < fb["track_error_as_of"]
        ):
            merged.update({key: fb.get(key) for key in track_fields})
        if quote_is_current:
            quote_count += 1
        if quote_is_current and nav_is_current:
            premium = calculate_etf_premium(market_price, nav)
        if quote_is_current and nav_is_current and premium is not None:
            premium_count += 1
            merged.update({
                "premium": premium,
                "premium_pct": premium,
                "premium_as_of": quote.get("quote_as_of"),
                "premium_quote_as_of": quote.get("quote_as_of"),
                "premium_nav_as_of": nav_date,
                "premium_basis": "market_close_vs_latest_published_nav",
            })

        daily_complete = (
            nav_is_current
            and rolling_is_current
            and day_is_current
        )
        quote_complete = quote_is_current and quote.get("market_change_pct") is not None
        any_current = quote_is_current or nav_is_current or rolling_is_current or day_is_current or track_accepted
        fully_current = (
            quote_complete
            and daily_complete
            and premium is not None
        )
        merged.update({
            "quote_status": "fresh" if quote_is_current else ("stale" if previous_row.get("market_price") is not None else "unavailable"),
            "nav_status": "fresh" if nav_is_current else ("stale" if previous_row.get("nav") is not None else "unavailable"),
            "fund_daily_status": "fresh" if daily_complete else (
                "partial" if nav_is_current else ("stale" if previous_row else "unavailable")
            ),
            "premium_status": "fresh" if quote_is_current and nav_is_current and premium is not None else (
                "stale" if previous_row.get("premium") is not None else "unavailable"
            ),
            "track_error_status": "fresh" if track_accepted else ("stale" if merged.get("track_error") is not None else "unavailable"),
            "source": "eastmoney+sina" if quote.get("quote_source") == "sina" else "eastmoney",
            "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds") if any_current else previous_row.get("fetched_at"),
            "data_status": "fresh" if fully_current else ("partial" if any_current else ("stale" if previous_row else "reference")),
        })
        merged.setdefault("annual_return_2025", fb.get("ytd_return"))
        results.append(merged)

    quote_rate = quote_count / len(codes) if codes else 0
    premium_rate = premium_count / len(codes) if codes else 0
    logger.info(
        f"[etfs] quote={quote_count}/{len(codes)}, premium={premium_count}/{len(codes)} "
        f"({premium_rate:.0%})"
    )
    results = safe_sort(
        results,
        key=lambda row: abs(row["premium"]) if row.get("premium") is not None else None,
        reverse=True,
    )
    source = "live" if results and all(row.get("data_status") == "fresh" for row in results) else (
        "partial" if any(row.get("data_status") in {"fresh", "partial"} for row in results) else "none"
    )
    return results, source

# ─── FastAPI ──────────────────────────────────────────────────────────────────

app = FastAPI(title="Wise-ETF API", version="5.0.0")
_cors_env = [origin.strip() for origin in os.environ.get("CORS_ORIGINS", "").split(",") if origin.strip()]
_cors_origins = _cors_env or ["https://wise-etf.com", "https://www.wise-etf.com"]
if os.environ.get("APP_ENV", "").lower() in {"development", "dev", "local", "test"}:
    _cors_origins.extend(["http://localhost:5173", "http://127.0.0.1:5173"])
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


def _cache_header(response: Response, seconds: int):
    # 不做 CDN 边缘缓存，避免 Vercel Edge 提供过期数据
    # 缓存由函数内部 Redis 层控制，每次请求必须打到 serverless 函数
    response.headers["Cache-Control"] = "no-store"


def _latest_field_date(rows: list, fields: tuple) -> Optional[str]:
    values = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        for field in fields:
            value = row.get(field)
            if isinstance(value, str) and value:
                values.append(value)
    return max(values) if values else None


def _dataset_status(rows: list, source: str) -> str:
    if not rows:
        return "empty"
    if source in ("static", "reference", "lkg", "file_cache"):
        return "stale"
    states = {row.get("data_status") for row in rows if isinstance(row, dict)}
    if states and states.issubset({"stale", "reference"}):
        return "stale"
    if "partial" in states or "stale" in states or "reference" in states or source == "partial":
        return "partial"
    return "fresh"


def _fund_cache_is_current(rows: list) -> bool:
    today = _china_now().date().isoformat()
    return bool(rows) and all(
        isinstance(row, dict)
        and row.get("subscription_status_status") == "fresh"
        and row.get("subscription_as_of") == today
        for row in rows
    )


def _etf_cache_is_current(rows: list) -> bool:
    expected = _expected_cn_close_date()
    if not rows:
        return False
    for row in rows:
        if not isinstance(row, dict) or row.get("premium_status") != "fresh":
            return False
        quote = _as_of_instant(row.get("premium_quote_as_of") or row.get("quote_as_of"))
        if quote is None or quote.astimezone(_CHINA_TZ).date().isoformat() != expected:
            return False
    return True


def _stale_etf_rows(rows: list) -> list:
    return [{
        **row,
        "data_status": "stale",
        "quote_status": "stale" if row.get("market_price") is not None else "unavailable",
        "nav_status": "stale" if row.get("nav") is not None else "unavailable",
        "premium_status": "stale" if row.get("premium") is not None else "unavailable",
        "fund_daily_status": "stale",
    } for row in rows]


def _reference_etfs() -> list:
    """冷启动参考快照不能把历史行情伪装成当前行情。"""
    dynamic_fields = {
        "market_price": None,
        "nav": None,
        "nav_date": None,
        "nav_as_of": None,
        "premium": None,
        "premium_pct": None,
        "volume": None,
        "turnover_cny_100m": None,
        "change_pct": None,
        "market_change_pct": None,
        "quote_as_of": None,
        "premium_as_of": None,
        "premium_quote_as_of": None,
        "premium_nav_as_of": None,
        "data_status": "reference",
    }
    return [{**item, **dynamic_fields} for item in STATIC_ETFS]


@app.get("/api/funds/{category}")
def get_funds(category: str, response: Response):
    """
    三层容错：内存缓存 → 实时抓取（静态字段不变，只更新日更字段）→ 文件缓存 → 静态兜底
    """
    cache_key = f"funds_{category}"

    # 1. 内存缓存
    cached = _mem_get(cache_key, "funds")
    cached_status = _dataset_status(cached, "cache") if cached is not None else None
    if cached_status == "fresh" and not _fund_cache_is_current(cached):
        cached = [{**row, "data_status": "stale", "daily_status": "stale"} for row in cached]
        cached_status = "stale"
    if cached is not None and cached_status == "fresh":
        _cache_header(response, 3600)
        return {
            "data": cached,
            "count": len(cached),
            "source": "cache",
            "status": cached_status,
            "as_of": _latest_field_date(cached, ("nav_date", "subscription_as_of", "track_error_as_of")),
            "schema_version": "2.0",
        }
    if cached is not None and _recovery_gate_active(cache_key):
        _cache_header(response, 3600)
        return {
            "data": cached,
            "count": len(cached),
            "source": "cache",
            "status": cached_status,
            "as_of": _latest_field_date(cached, ("nav_date", "subscription_as_of", "track_error_as_of")),
            "schema_version": "2.0",
        }

    static = STATIC_FUNDS.get(category, [])
    if not static:
        return {"data": [], "count": 0, "source": "empty"}

    refresh_lock = _try_recovery_refresh(cache_key)
    if refresh_lock is None:
        if cached is not None:
            _cache_header(response, 3600)
            return {
                "data": cached,
                "count": len(cached),
                "source": "cache",
                "status": cached_status,
                "as_of": _latest_field_date(cached, ("nav_date", "subscription_as_of", "track_error_as_of")),
                "schema_version": "2.0",
            }
        previous = _file_load(cache_key) or []
        reference = (
            [{**row, "data_status": "stale", "daily_status": "stale"} for row in previous]
            if previous else
            [{**row, "data_status": "reference"} for row in static]
        )
        _cache_header(response, 3600)
        return {
            "data": reference,
            "count": len(reference),
            "source": "lkg" if previous else "refresh_in_progress",
            "status": "stale",
            "as_of": _latest_field_date(reference, ("nav_date", "subscription_as_of", "track_error_as_of")),
            "schema_version": "2.0",
        }

    try:
        # 2. 实时抓取
        results, source = _build_funds(category)

        if source == "live":
            _publish_cache(cache_key, results, CACHE_TTL["funds"])
        elif source == "partial":
            # 部分刷新可供当前请求使用，但不能替换永久完整快照。
            _cache_recovery_snapshot(cache_key, results)
        else:
            # 3. 永久 Last-Known-Good（上次成功数据）
            file_data = _file_load(cache_key)
            if file_data:
                results = [{**row, "data_status": "stale", "daily_status": "stale"} for row in file_data]
                _cache_recovery_snapshot(cache_key, results)
                source  = "lkg"
            elif cached is not None:
                # A failed recovery must not erase the short-lived partial snapshot.
                results = cached
                _cache_recovery_snapshot(cache_key, results)
                source = "cache"
            else:
                # 4. 带明确状态的参考快照
                results = [{**row, "data_status": "reference"} for row in static]
                source  = "reference"
    finally:
        if refresh_lock is not None:
            refresh_lock.release()

    _cache_header(response, 3600)
    return {
        "data": results,
        "count": len(results),
        "source": source,
        "status": _dataset_status(results, source),
        "as_of": _latest_field_date(results, ("nav_date", "subscription_as_of", "track_error_as_of")),
        "schema_version": "2.0",
    }


@app.get("/api/etfs")
def get_etfs(response: Response):
    """Serve the official close snapshot, with one guarded after-close recovery."""
    cache_key = "etfs"
    cached = _mem_get(cache_key, "etfs")
    if cached:
        is_current = _etf_cache_is_current(cached)
        results = cached if is_current else _stale_etf_rows(cached)
        source = "cache"
        status = _dataset_status(results, source) if is_current else "stale"
    else:
        previous = _file_load(cache_key) or []
        if previous:
            results = _stale_etf_rows(previous)
            source = "lkg"
            status = "stale"
        else:
            results = _reference_etfs()
            source = "reference"
            status = "stale"

    # Cold deployment or a failed cron may leave no current close snapshot.
    # Permit exactly one cross-instance recovery after the A-share close;
    # followers keep receiving the stale/reference snapshot, and failures back
    # off for five minutes.  A normal page refresh therefore never fans out to
    # providers and can never publish an intraday quote.
    now = _china_now()
    after_close = now.weekday() < 5 and (now.hour, now.minute) >= (15, 5)
    if status != "fresh" and after_close and not _recovery_gate_active(cache_key):
        lock_key = "etfs:close"
        token = _acquire_job_lock(lock_key)
        if token is not None:
            try:
                candidate, candidate_source = _build_etfs()
                if candidate_source == "live" and _store_snapshot(
                    cache_key, candidate, candidate_source, CACHE_TTL["etfs"]
                ):
                    results = candidate
                    source = "live"
                    status = "fresh"
                elif candidate_source == "partial":
                    results = candidate
                    source = "partial"
                    status = "partial"
                    _cache_recovery_snapshot(cache_key, candidate)
                else:
                    _cache_recovery_snapshot(cache_key, results)
            except Exception as exc:
                logger.error(f"[etfs:recovery] {exc}")
                _cache_recovery_snapshot(cache_key, results)
            finally:
                _release_job_lock(lock_key, token)

    _cache_header(response, 300)
    return {
        "data": results,
        "count": len(results),
        "source": source,
        "status": status,
        "as_of": _latest_field_date(results, ("quote_as_of", "nav_as_of", "track_error_as_of", "premium_as_of")),
        "schema_version": "2.0",
    }


@app.get("/api/overview")
def get_overview(response: Response):
    _cache_header(response, 3600)
    return {
        "stats": {**{k: {"count": len(v)} for k, v in STATIC_FUNDS.items()},
                  **{"etf": {"count": len(STATIC_ETFS)}}},
        "last_update": datetime.now(_CHINA_TZ).strftime("%Y-%m-%d %H:%M"),
        "total_funds": sum(len(v) for v in STATIC_FUNDS.values()) + len(STATIC_ETFS),
    }


@app.get("/api/fx/usdcny")
def get_usdcny(response: Response):
    """USD/CNY 最近交易价；失败时仅返回带 stale 标记的永久快照。"""
    cache_key = "fx_usdcny"
    cached = _cache_get(cache_key)
    if cached:
        _cache_header(response, 3600)
        return {"data": cached, "source": "cache", "status": "fresh", "as_of": cached.get("as_of")}

    data = None
    try:
        result = _yf_chart("USDCNY=X", interval="1d", range_="5d") or {}
        meta = result.get("meta") or {}
        value = parse_number(meta.get("regularMarketPrice"))
        timestamps = result.get("timestamp") or []
        if value is not None and value > 0:
            as_of = datetime.fromtimestamp(timestamps[-1], timezone.utc).date().isoformat() if timestamps else None
            data = {
                "pair": "USD/CNY",
                "value": round(value, 4),
                "as_of": as_of,
                "source": "Yahoo Finance USDCNY=X",
            }
    except Exception as exc:
        logger.warning(f"[fx_usdcny] {exc}")

    if data:
        _publish_cache(cache_key, data, CACHE_TTL["fx_current"])
        source = "live"
        status = "fresh"
    else:
        data = _lkg_get(cache_key)
        source = "lkg" if data else "empty"
        status = "stale" if data else "empty"
    _cache_header(response, 3600)
    return {"data": data, "source": source, "status": status, "as_of": (data or {}).get("as_of")}


def _monthly_return_payload() -> dict:
    """抓取日线后按完整自然月计算，当前月单列为 MTD。"""
    with ThreadPoolExecutor(max_workers=2) as ex:
        f_ndx = ex.submit(_yf_chart, "^NDX", "1d", "2y")
        f_spx = ex.submit(_yf_chart, "^GSPC", "1d", "2y")
        ndx_raw = f_ndx.result(timeout=15)
        spx_raw = f_spx.result(timeout=15)

    def wrap(result):
        return {"chart": {"result": [result] if result else None, "error": None}}

    today = datetime.now(_CHINA_TZ).date()
    ndx = normalize_yahoo_monthly_returns(wrap(ndx_raw), "NDX", reference_date=today)
    spx = normalize_yahoo_monthly_returns(wrap(spx_raw), "SPX", reference_date=today)
    ndx_months = {row["month"]: row for row in ndx["months"]}
    spx_months = {row["month"]: row for row in spx["months"]}
    labels = sorted(set(ndx_months) | set(spx_months))
    months = []
    for label in labels:
        nq = ndx_months.get(label) or {}
        sp = spx_months.get(label) or {}
        months.append({
            "month": label,
            "nasdaq": nq.get("value"),
            "sp500": sp.get("value"),
            "nasdaq_as_of": nq.get("as_of"),
            "sp500_as_of": sp.get("as_of"),
            "status": "ok" if nq.get("status") == "ok" and sp.get("status") == "ok" else "partial",
        })

    mtd = {
        "month": ndx["mtd"].get("month") or spx["mtd"].get("month"),
        "nasdaq": ndx["mtd"].get("value"),
        "sp500": spx["mtd"].get("value"),
        "nasdaq_as_of": ndx["mtd"].get("as_of"),
        "sp500_as_of": spx["mtd"].get("as_of"),
        "status": "partial" if ndx["mtd"].get("value") is not None or spx["mtd"].get("value") is not None else "unavailable",
        "is_partial": True,
    }
    available = sum(1 for row in months if row["nasdaq"] is not None and row["sp500"] is not None)
    return {
        "months": months,
        "mtd": mtd,
        "as_of": max(filter(None, (ndx.get("as_of"), spx.get("as_of"))), default=None),
        "source": "Yahoo Finance chart",
        "status": "fresh" if available == 12 else ("partial" if available else "empty"),
        "return_type": "price",
        "currency": "USD",
    }


@app.get("/api/monthly-returns")
def get_monthly_returns(response: Response):
    """最近 12 个完整自然月收益；当前未完结月份单独返回为 MTD。"""
    cache_key = "monthly_returns_v1"
    cached = _cache_get(cache_key)
    if cached and cached.get("status") == "fresh":
        _cache_header(response, 21600)
        return {"data": cached, "source": "cache", "status": cached.get("status", "fresh")}
    if cached and _recovery_gate_active(cache_key):
        _cache_header(response, 21600)
        return {"data": cached, "source": "cache", "status": cached.get("status", "partial")}

    refresh_lock = _try_recovery_refresh(cache_key)
    if refresh_lock is None:
        if cached:
            _cache_header(response, 21600)
            return {"data": cached, "source": "cache", "status": cached.get("status", "partial")}
        lkg = _lkg_get(cache_key)
        _cache_header(response, 21600)
        return {
            "data": lkg,
            "source": "lkg" if lkg else "refresh_in_progress",
            "status": "stale" if lkg else "unavailable",
        }

    try:
        try:
            data = _monthly_return_payload()
        except Exception as exc:
            logger.warning(f"[monthly_returns] {exc}")
            data = None
        if data and data.get("months") and data.get("status") == "fresh":
            _publish_cache(cache_key, data, CACHE_TTL["monthly_returns"])
            source = "live"
        elif data and data.get("months"):
            _cache_recovery_snapshot(cache_key, data)
            source = "partial"
        else:
            lkg = _lkg_get(cache_key)
            if lkg:
                data = lkg
                source = "lkg"
            elif cached:
                data = cached
                source = "cache"
            else:
                data = None
                source = "empty"
            if data:
                _cache_recovery_snapshot(cache_key, data)
    finally:
        if refresh_lock is not None:
            refresh_lock.release()
    _cache_header(response, 21600)
    return {
        "data": data,
        "source": source,
        "status": "stale" if source == "lkg" else ((data or {}).get("status", "empty")),
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
        _cache_set(cache_key, data, CACHE_TTL["fx_history"])
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


def _require_job_secret(authorization: Optional[str]) -> None:
    """Protect cron/admin routes; insecure access is opt-in for local development."""
    expected = os.environ.get("CRON_SECRET")
    if not expected:
        is_explicit_dev = os.environ.get("APP_ENV", "").lower() in {"development", "dev", "local", "test"}
        allow_insecure = os.environ.get("ALLOW_INSECURE_LOCAL_JOBS", "").lower() in {"1", "true", "yes"}
        if is_explicit_dev or allow_insecure:
            return
        raise HTTPException(status_code=503, detail="CRON_SECRET is not configured")
    supplied = authorization or ""
    token = supplied[7:] if supplied.lower().startswith("bearer ") else supplied
    if not token or not hmac.compare_digest(token, expected):
        raise HTTPException(status_code=401, detail="Unauthorized")


def _store_snapshot(cache_key: str, data: list, source: str, ttl: int) -> bool:
    """发布完整快照；部分快照只进入热缓存，不降级永久 LKG。"""
    if source == "live":
        return _publish_cache(cache_key, data, ttl)
    elif source == "partial":
        _cache_recovery_snapshot(cache_key, data)
    return False


def _refresh_fund_category(category: str) -> dict:
    if category not in STATIC_FUNDS:
        raise HTTPException(status_code=404, detail=f"Unknown fund category: {category}")
    started = time.monotonic()
    data, source = _build_funds(category)
    published = _store_snapshot(f"funds_{category}", data, source, CACHE_TTL["funds"])
    result = {
        "category": category,
        "count": len(data),
        "source": source,
        "published": published,
        "duration_ms": round((time.monotonic() - started) * 1000),
    }
    if source != "live" or not published:
        raise HTTPException(status_code=503, detail={**result, "error": "daily snapshot not published"})
    result["live_data"] = _publish_live_projection(data)
    return result


@app.get("/api/cron/funds/{category}")
def cron_fund_category(category: str, authorization: Optional[str] = Header(default=None)):
    """One category per invocation keeps the Vercel function under 30 seconds."""
    _require_job_secret(authorization)
    lock_key = f"funds:{category}"
    token = _acquire_job_lock(lock_key)
    if token is None:
        raise HTTPException(status_code=409, detail="Fund refresh is already running or Redis is unavailable")
    try:
        return {
            "ts": _china_now().isoformat(),
            "v": "v5",
            "run_id": token,
            "result": _refresh_fund_category(category),
        }
    finally:
        _release_job_lock(lock_key, token)


def _publish_live_projection(rows: list) -> dict:
    """把同轮成功的基金日更字段投影给旧客户端，并保留未刷新的 LKG 行。"""
    fresh_rows = {}
    for row in rows:
        code = row.get("code") if isinstance(row, dict) else None
        if not code or not (row.get("daily_status") == "fresh" or row.get("fund_daily_status") == "fresh"):
            continue
        projected = {
            key: row.get(key) for key in (
                "day_change", "rolling_1y", "return_ytd", "buy_status",
                "subscription_status", "daily_limit", "daily_limit_cny",
                "nav", "nav_date", "subscription_as_of", "fetched_at",
            ) if row.get(key) is not None
        }
        if projected:
            fresh_rows[code] = projected

    if not fresh_rows:
        return {"status": "empty", "fresh_count": 0, "total_count": len(set(_ALL_CODES))}

    previous = _cache_get("live_data") or _lkg_get("live_data") or {}
    merged = {**previous, **fresh_rows}
    cycle_date = datetime.now(_CHINA_TZ).date().isoformat()
    previous_meta = _cache_get("live_data:meta") or {}
    prior_codes = set(previous_meta.get("fresh_codes") or []) if previous_meta.get("cycle_date") == cycle_date else set()
    fresh_codes = sorted(prior_codes | set(fresh_rows))
    is_complete = len(fresh_codes) == len(set(_ALL_CODES))
    meta = {
        "status": "fresh" if is_complete else "partial",
        "fresh_count": len(fresh_codes),
        "total_count": len(set(_ALL_CODES)),
        "as_of": _latest_field_date(list(fresh_rows.values()), ("nav_date", "subscription_as_of")) or previous_meta.get("as_of"),
        "cycle_date": cycle_date,
        "fresh_codes": fresh_codes,
    }
    if is_complete:
        _publish_cache("live_data", merged, CACHE_TTL["live_data"])
        _lkg_set("live_data:meta", meta)
        meta_ttl = CACHE_TTL["live_data"]
    else:
        _cache_recovery_snapshot("live_data", merged)
        meta_ttl = RECOVERY_CACHE_TTL
    _cache_set("live_data:meta", meta, meta_ttl)
    return meta


@app.get("/api/cron/refresh")
def cron_refresh(authorization: Optional[str] = Header(default=None)):
    """Deprecated: the all-category job cannot fit the 30-second budget."""
    _require_job_secret(authorization)
    raise HTTPException(
        status_code=410,
        detail="Use /api/cron/funds/{category}; the legacy combined refresh is disabled",
    )


@app.get("/api/cron/etfs")
def cron_etfs(authorization: Optional[str] = Header(default=None)):
    """A 股收盘后更新 ETF 市价、滚动收益、跟踪误差和溢价快照。"""
    _require_job_secret(authorization)
    now = _china_now()
    if now.weekday() >= 5 or (now.hour, now.minute) < (15, 5):
        raise HTTPException(status_code=409, detail="ETF close snapshot is only published after 15:05 Asia/Shanghai")
    lock_key = "etfs:close"
    token = _acquire_job_lock(lock_key)
    if token is None:
        raise HTTPException(status_code=409, detail="ETF close refresh is already running or Redis is unavailable")
    started = time.monotonic()
    try:
        data, source = _build_etfs()
        published = _store_snapshot("etfs", data, source, CACHE_TTL["etfs"])
        if source != "live" or not published:
            raise HTTPException(status_code=503, detail={
                "count": len(data),
                "source": source,
                "published": published,
                "duration_ms": round((time.monotonic() - started) * 1000),
                "error": "ETF close snapshot not published",
            })
        live_meta = _publish_live_projection(data)
        return {
            "ts": _china_now().isoformat(),
            "v": "v5",
            "run_id": token,
            "results": {
                "etfs": {
                    "count": len(data),
                    "source": source,
                    "published": published,
                    "duration_ms": round((time.monotonic() - started) * 1000),
                },
                "live_data": {**live_meta, "source": "same_snapshot"},
            },
        }
    finally:
        _release_job_lock(lock_key, token)


@app.get("/api/cron/prem")
def cron_prem(authorization: Optional[str] = Header(default=None)):
    """独立 cron：只刷溢价率历史（数据量大，单独跑避免主 cron 超时）"""
    _require_job_secret(authorization)
    results = {}

    def _refresh_one(code: str):
        hist = fetch_premium_history(code)
        if hist:
            _publish_cache(f"prem_hist_{code}", hist, CACHE_TTL["premium_history"])
        return code, len(hist)

    ex = ThreadPoolExecutor(max_workers=6)
    try:
        futures = {ex.submit(_refresh_one, etf["code"]): etf["code"] for etf in STATIC_ETFS}
        done, not_done = wait(list(futures), timeout=26)
        for future in not_done:
            future.cancel()
            results[futures[future]] = "timeout"
        for future in done:
            code = futures[future]
            try:
                _, count = future.result()
                results[code] = count
            except Exception as exc:
                results[code] = str(exc)
    finally:
        ex.shutdown(wait=False)
    return {"ts": datetime.now(_CHINA_TZ).isoformat(), "results": results}


@app.get("/api/cron/live")
def cron_live(authorization: Optional[str] = Header(default=None)):
    """
    每5分钟由 Vercel Cron 触发，拉取实时股价写入 Redis（qdii:live:{sym}，7min TTL）。
    post_market 时段额外写 qdii:close（今日正规收盘，72h TTL）。
    a_share / weekend 时段跳过（无需实时股价）。
    """
    _require_job_secret(authorization)
    session = _current_session()
    if session in ("a_share", "weekend"):
        return {"ok": True, "skipped": True, "session": session}

    # 收集所有 US symbols（前10大持仓，排除港股/A股）
    all_syms: set = set()
    for code in QDII_CODES:
        master = _C_TO_A_HOLDINGS_MAP.get(code, code)
        holdings = fetch_qdii_holdings(master) or []
        for h in sorted(holdings, key=lambda x: x.get("weight", 0), reverse=True)[:10]:
            sym = h.get("symbol", "")
            if sym and not any(sym.endswith(sfx) for sfx in _QDII_NON_US_SUFFIX):
                all_syms.add(sym)
    symbols = list(all_syms)
    if not symbols:
        return {"ok": False, "msg": "no symbols"}

    now = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

    if session == "post_market":
        # 正规收盘已完成：Yahoo regular → qdii:close（72h）；Yahoo post → qdii:live（7min）
        close_res = _fetch_chg_from_yf_simple(symbols, prefer_regular=True, timeout=25)
        if close_res:
            _cache_mset({f"qdii:close:{s}": pct for s, pct in close_res.items()}, 72 * 3600)
        live_res = _fetch_chg_from_yf_simple(symbols, prefer_post=True, timeout=25)
        if live_res:
            _cache_mset({f"qdii:live:{s}": pct for s, pct in live_res.items()}, 7 * 60)
        logger.info(f"[cron/live] post_market close={len(close_res)} live={len(live_res)}")
        return {"ok": True, "ts": now, "session": session, "close": len(close_res), "live": len(live_res)}

    elif session == "us_open":
        # 盘中：Yahoo regularMarketChangePercent → qdii:live（7min）
        live_res = _fetch_chg_from_yf_simple(symbols, prefer_regular=True, timeout=25)
        if live_res:
            _cache_mset({f"qdii:live:{s}": pct for s, pct in live_res.items()}, 7 * 60)
        logger.info(f"[cron/live] us_open live={len(live_res)}/{len(symbols)}")
        return {"ok": True, "ts": now, "session": session, "live": len(live_res)}

    else:  # pre_market：Yahoo 默认（盘前 > 盘后 > 盘中）→ qdii:live（7min）
        live_res = _fetch_chg_from_yf_simple(symbols, timeout=25)
        if live_res:
            _cache_mset({f"qdii:live:{s}": pct for s, pct in live_res.items()}, 7 * 60)
        logger.info(f"[cron/live] pre_market live={len(live_res)}/{len(symbols)}")
        return {"ok": True, "ts": now, "session": session, "live": len(live_res)}


# ─── 用户认证 ──────────────────────────────────────────────────────────────────

_JWT_SECRET = os.environ.get("JWT_SECRET", "")


def _require_jwt_secret() -> str:
    if not _JWT_SECRET:
        raise HTTPException(status_code=503, detail="JWT_SECRET is not configured")
    return _JWT_SECRET

def _hash_password(password: str) -> str:
    """PBKDF2-SHA256 加密密码，返回 salt:hash"""
    salt = secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 260000)
    return f"{salt}:{h.hex()}"

def _verify_password(password: str, stored: str) -> bool:
    """验证密码"""
    try:
        salt, hashed = stored.split(":", 1)
        h = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 260000)
        return hmac.compare_digest(h.hex(), hashed)
    except Exception:
        return False

def _make_token(email: str) -> str:
    """生成 30 天有效的 HMAC-SHA256 token"""
    secret = _require_jwt_secret()
    user = _user_get(email) or {}
    token_version = int(user.get("token_version") or 1)
    exp = (datetime.utcnow() + timedelta(days=30)).strftime("%Y-%m-%dT%H:%M:%SZ")
    payload = f"{email}|{exp}|{token_version}"
    sig = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return base64.urlsafe_b64encode(f"{payload}|{sig}".encode()).decode()

def _verify_token(token: str) -> Optional[str]:
    """验证 token，返回 email 或 None"""
    if not _JWT_SECRET:
        return None
    try:
        decoded = base64.urlsafe_b64decode(token.encode() + b"==").decode()
        email, exp_str, version_text, sig = decoded.split("|", 3)
        payload = f"{email}|{exp_str}|{version_text}"
        expected = hmac.new(_JWT_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected):
            return None
        if datetime.strptime(exp_str, "%Y-%m-%dT%H:%M:%SZ") < datetime.utcnow():
            return None
        user = _user_get(email)
        if not user or int(user.get("token_version") or 1) != int(version_text):
            return None
        return email
    except Exception:
        return None

def _user_get(email: str) -> Optional[dict]:
    """从 Redis 读取用户"""
    return _cache_get(f"wise_user:{email.lower()}")

def _user_save(email: str, password_hash: str, *, rotate_tokens: bool = False) -> bool:
    """永久存储用户到 Redis"""
    r = _get_redis()
    if not r:
        return False
    try:
        existing = _user_get(email) or {}
        token_version = int(existing.get("token_version") or 1) + (1 if rotate_tokens else 0)
        r.set(f"wise_user:{email.lower()}", json.dumps({
            "email": email.lower(),
            "password": password_hash,
            "created_at": existing.get("created_at") or datetime.utcnow().isoformat(),
            "password_updated_at": datetime.utcnow().isoformat() if rotate_tokens else existing.get("password_updated_at"),
            "token_version": token_version,
        }))
        return True
    except Exception:
        return False


from fastapi import Request as _Request, Header as _Header


def _rate_limit(scope: str, identifier: str, *, limit: int, window_seconds: int) -> None:
    """Small Redis-backed auth throttle; unavailable Redis already prevents auth writes."""
    r = _get_redis()
    if not r:
        return
    digest = hashlib.sha256(identifier.encode("utf-8", "ignore")).hexdigest()[:24]
    key = f"rate:{scope}:{digest}"
    try:
        count = int(r.incr(key))
        if count == 1:
            r.expire(key, window_seconds)
        if count > limit:
            raise HTTPException(status_code=429, detail="请求过于频繁，请稍后再试")
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning(f"[rate_limit] {scope}: {exc}")

@app.post("/api/auth/register")
async def auth_register(request: _Request):
    """用户注册：邮箱 + 密码（加密存 Redis）"""
    _require_jwt_secret()
    try:
        body = await request.json()
    except Exception:
        return {"ok": False, "msg": "请求格式错误"}
    email    = body.get("email", "").strip().lower()
    password = body.get("password", "")
    client_ip = request.client.host if request.client else "unknown"
    _rate_limit("register", client_ip, limit=5, window_seconds=3600)
    if not re.match(r'^[^\s@]+@[^\s@]+\.[^\s@]+$', email):
        return {"ok": False, "msg": "邮箱格式不正确"}
    if len(password) < 8:
        return {"ok": False, "msg": "密码至少8位"}
    if not any(c.isupper() for c in password):
        return {"ok": False, "msg": "密码需包含大写字母"}
    if not any(c.islower() for c in password):
        return {"ok": False, "msg": "密码需包含小写字母"}
    if not any(c.isdigit() for c in password):
        return {"ok": False, "msg": "密码需包含数字"}
    if _user_get(email):
        return {"ok": False, "msg": "该邮箱已注册"}
    if not _user_save(email, _hash_password(password)):
        return {"ok": False, "msg": "注册失败，请稍后重试"}
    token = _make_token(email)
    logger.info(f"[auth] register: {email}")
    return {"ok": True, "token": token, "email": email}


@app.post("/api/auth/login")
async def auth_login(request: _Request):
    """用户登录"""
    _require_jwt_secret()
    try:
        body = await request.json()
    except Exception:
        return {"ok": False, "msg": "请求格式错误"}
    email    = body.get("email", "").strip().lower()
    password = body.get("password", "")
    client_ip = request.client.host if request.client else "unknown"
    _rate_limit("login", f"{client_ip}|{email}", limit=10, window_seconds=600)
    user = _user_get(email)
    if not user or not _verify_password(password, user.get("password", "")):
        return {"ok": False, "msg": "邮箱或密码错误"}
    token = _make_token(email)
    logger.info(f"[auth] login: {email}")
    return {"ok": True, "token": token, "email": email}


@app.get("/api/auth/me")
def auth_me(authorization: str = _Header(None)):
    """验证 token，返回用户信息"""
    _require_jwt_secret()
    if not authorization or not authorization.startswith("Bearer "):
        return {"ok": False, "msg": "未登录"}
    email = _verify_token(authorization[7:])
    if not email:
        return {"ok": False, "msg": "登录已过期，请重新登录"}
    return {"ok": True, "email": email}


@app.post("/api/auth/change_password")
async def auth_change_password(request: _Request, authorization: str = _Header(None)):
    """修改密码：验证旧密码后更新"""
    _require_jwt_secret()
    if not authorization or not authorization.startswith("Bearer "):
        return {"ok": False, "msg": "未登录"}
    email = _verify_token(authorization[7:])
    if not email:
        return {"ok": False, "msg": "登录已过期，请重新登录"}
    try:
        body = await request.json()
    except Exception:
        return {"ok": False, "msg": "请求格式错误"}
    old_password = body.get("old_password", "")
    new_password = body.get("new_password", "")
    user = _user_get(email)
    if not user or not _verify_password(old_password, user.get("password", "")):
        return {"ok": False, "msg": "当前密码不正确"}
    if len(new_password) < 8:
        return {"ok": False, "msg": "新密码至少8位"}
    if not any(c.isupper() for c in new_password):
        return {"ok": False, "msg": "新密码需包含大写字母"}
    if not any(c.islower() for c in new_password):
        return {"ok": False, "msg": "新密码需包含小写字母"}
    if not any(c.isdigit() for c in new_password):
        return {"ok": False, "msg": "新密码需包含数字"}
    if old_password == new_password:
        return {"ok": False, "msg": "新密码不能与当前密码相同"}
    if not _user_save(email, _hash_password(new_password), rotate_tokens=True):
        return {"ok": False, "msg": "修改失败，请稍后重试"}
    logger.info(f"[auth] change_password: {email}")
    return {"ok": True, "msg": "密码修改成功"}


@app.get("/api/cron/post_snap")
def cron_post_snap(authorization: Optional[str] = Header(default=None)):
    """
    HKT 08:05 触发（夜盘结束后）：写入最终收盘 + 夜盘涨跌幅，72h TTL 覆盖周末。
      qdii:close:{sym}  收盘涨跌幅（Nasdaq regular；国际市场/港股/A股用 Yahoo v8）
      qdii:post:{sym}   夜盘涨跌幅（Yahoo v8 prefer_post，无夜盘股票跳过）
    """
    _require_job_secret(authorization)
    yf_syms: set = set()
    hk_a_syms: set = set()
    for code in QDII_CODES:
        master = _C_TO_A_HOLDINGS_MAP.get(code, code)
        for h in (fetch_qdii_holdings(master) or []):
            sym = h.get("symbol", "")
            if not sym:
                continue
            if any(sym.endswith(s) for s in _QDII_NON_US_SUFFIX):
                hk_a_syms.add(sym)
            else:
                yf_syms.add(sym)

    us_symbols = list(yf_syms)
    hk_a_list  = list(hk_a_syms)
    if not us_symbols and not hk_a_list:
        return {"ok": False, "msg": "no symbols found"}

    now = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

    # 纯美股收盘 → Nasdaq
    pure_us = [s for s in us_symbols if not any(s.endswith(sfx) for sfx in _QDII_YF_INTL_SUFFIX)]
    close_results: Dict[str, float] = {}
    if pure_us:
        close_results = _fetch_chg_from_nasdaq(pure_us, timeout=60)
        logger.info(f"[snap] Nasdaq close {len(close_results)}/{len(pure_us)}")

    # 所有美股+国际 → Yahoo v8 夜盘（国际市场无夜盘，自动回落到正规收盘兼做 close 兜底）
    post_results = _fetch_chg_from_yf_simple(us_symbols, prefer_post=True)
    logger.info(f"[snap] Yahoo post {len(post_results)}/{len(us_symbols)}")

    # 港股/A股 → Yahoo v8 收盘
    hk_a_results: Dict[str, float] = {}
    if hk_a_list:
        hk_a_results = _fetch_chg_from_yf_simple(hk_a_list, prefer_post=False)
        logger.info(f"[snap] HK/A close {len(hk_a_results)}/{len(hk_a_list)}")

    written = 0
    missing_post = []
    for sym in us_symbols:
        is_intl   = any(sym.endswith(sfx) for sfx in _QDII_YF_INTL_SUFFIX)
        close_pct = close_results.get(sym) if not is_intl else post_results.get(sym)
        post_pct  = post_results.get(sym)  if not is_intl else None
        if close_pct is None and post_pct is None:
            continue
        if close_pct is not None:
            _cache_set(f"qdii:close:{sym}", close_pct, 72 * 3600)
        if post_pct is not None:
            _cache_set(f"qdii:post:{sym}", post_pct, 72 * 3600)
        else:
            missing_post.append(sym)
        written += 1

    for sym, pct in hk_a_results.items():
        _cache_set(f"qdii:close:{sym}", pct, 72 * 3600)
        written += 1

    logger.info(f"[snap] done written={written}/{len(us_symbols)+len(hk_a_list)}")
    return {"ok": True, "ts": now, "written": written, "missing_post": missing_post}


@app.get("/api/cron/clear")
def cron_clear(authorization: Optional[str] = Header(default=None)):
    """只清热缓存，永久 Last-Known-Good 不会被删除。"""
    _require_job_secret(authorization)
    r = _get_redis()
    if not r:
        return {"ok": False, "msg": "Redis unavailable"}
    keys = [f"funds_{cat}" for cat in STATIC_FUNDS] + ["etfs", "live_data", "live_data:meta"]
    try:
        for key in keys:
            _cache_delete(key)
        return {"ok": True, "cleared": keys}
    except Exception as e:
        return {"ok": False, "msg": str(e)}


@app.get("/api/cache/delete")
def cache_delete_key(
    key: str = "",
    authorization: Optional[str] = Header(default=None),
):
    """受保护的精确 key 删除；禁止通配符及用户/收藏命名空间。"""
    _require_job_secret(authorization)
    if not key:
        raise HTTPException(status_code=400, detail="key is required")
    if "*" in key or "?" in key or "[" in key:
        raise HTTPException(status_code=400, detail="wildcard deletion is disabled")

    public_cache_keys = {
        "etfs", "live_data", "market_sentiment", "market_sentiment_v2", "pe_history_v3",
        "monthly_returns_v1", "fx_history", "fx_usdcny", "news",
        *{f"funds_{category}" for category in STATIC_FUNDS},
        *{f"prem_hist_{item['code']}" for item in STATIC_ETFS},
    }
    qdii_exact = bool(re.fullmatch(r"qdii:(?:chg|close|post|live):[A-Za-z0-9._-]+", key))
    if key not in public_cache_keys and not qdii_exact:
        raise HTTPException(status_code=403, detail="key is not in the cache allowlist")
    r = _get_redis()
    if not r:
        return {"ok": False, "msg": "Redis unavailable"}
    try:
        _cache_delete(key)
        return {"ok": True, "deleted": [key]}
    except Exception as e:
        return {"ok": False, "msg": str(e)}


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
    """单次获取每日字段，和 `/api/funds` 共用完全相同的解析规则。"""
    data = _fetch_basic_information(code)
    if not data:
        return code, {}
    return code, _normalize_basic_information(code, data)


# ─── ETF 溢价率历史 ──────────────────────────────────────────────────────────────

_SINA_KL_HEADERS = {
    "User-Agent": HEADERS["User-Agent"],
    "Referer":    "https://finance.sina.com.cn/",
}

def fetch_premium_history(code: str, days: int = 35) -> list:
    """
    计算ETF近N个交易日的真实溢价率。
    - 历史净值：东方财富 f10/lsjz
    - 历史收盘价：新浪财经 CN_MarketData.getKLineData（scale=240 = 日线）
    """
    prefix = "sh" if code.startswith("5") else "sz"

    # 1. 历史净值
    nav_map: Dict[str, float] = {}
    try:
        resp = _get(
            "https://api.fund.eastmoney.com/f10/lsjz",
            params={"fundCode": code, "pageIndex": 1, "pageSize": days + 5},
            headers={**HEADERS, "Referer": "https://fundf10.eastmoney.com/"},
            timeout=(3, 6),
        )
        if resp and resp.ok:
            for item in resp.json().get("Data", {}).get("LSJZList", []):
                d, v = item.get("FSRQ", ""), item.get("DWJZ", "")
                if d and v:
                    try:
                        nav_map[d] = float(v)
                    except Exception:
                        pass
    except Exception as e:
        logger.warning(f"[prem_hist] NAV failed {code}: {e}")

    # 2. 历史收盘价
    price_map: Dict[str, float] = {}
    try:
        resp = _get(
            "https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData",
            params={"symbol": f"{prefix}{code}", "scale": 240, "ma": "no", "datalen": days + 5},
            headers=_SINA_KL_HEADERS,
            timeout=(3, 6),
        )
        if resp and resp.ok:
            for item in resp.json():
                d, c = item.get("day", ""), item.get("close", "")
                if d and c:
                    try:
                        price_map[d] = float(c)
                    except Exception:
                        pass
    except Exception as e:
        logger.warning(f"[prem_hist] price failed {code}: {e}")

    # 3. 交叉匹配 + 计算溢价率
    common = sorted(set(nav_map) & set(price_map))
    result = []
    for full_date in common[-days:]:
        nav   = nav_map[full_date]
        price = price_map[full_date]
        if nav <= 0:
            continue
        premium = round((price - nav) / nav * 100, 2)
        parts   = full_date.split("-")
        label   = f"{int(parts[1])}/{int(parts[2])}" if len(parts) == 3 else full_date
        result.append({
            "date": label,
            "full_date": full_date,
            "premium": premium,
            "market_price": price,
            "nav": nav,
            "basis": "same_day_close_vs_same_day_nav",
            "source": "eastmoney_nav+sina_close",
        })

    logger.info(f"[prem_hist] {code}: {len(result)} points (nav={len(nav_map)}, price={len(price_map)})")
    return result


# ─── 溢价率历史静态兜底（2026-04-02 真实数据）────────────────────────────────────
STATIC_PREMIUM_HISTORY: Dict[str, list] = {
    "513100": [{"date":"3/4","premium":1.67},{"date":"3/5","premium":4.33},{"date":"3/6","premium":5.95},{"date":"3/9","premium":1.78},{"date":"3/10","premium":3.93},{"date":"3/11","premium":4.22},{"date":"3/12","premium":5.51},{"date":"3/13","premium":5.08},{"date":"3/16","premium":4.26},{"date":"3/17","premium":3.53},{"date":"3/18","premium":6.36},{"date":"3/19","premium":5.08},{"date":"3/20","premium":6.28},{"date":"3/23","premium":0.67},{"date":"3/24","premium":3.83},{"date":"3/25","premium":4.21},{"date":"3/26","premium":5.43},{"date":"3/27","premium":6.88},{"date":"3/30","premium":6.02},{"date":"3/31","premium":2.01}],
    "513110": [{"date":"3/4","premium":0.09},{"date":"3/5","premium":2.66},{"date":"3/6","premium":4.29},{"date":"3/9","premium":0.34},{"date":"3/10","premium":2.65},{"date":"3/11","premium":2.82},{"date":"3/12","premium":3.99},{"date":"3/13","premium":3.48},{"date":"3/16","premium":2.73},{"date":"3/17","premium":1.79},{"date":"3/18","premium":4.74},{"date":"3/19","premium":2.97},{"date":"3/20","premium":4.41},{"date":"3/23","premium":-0.9},{"date":"3/24","premium":2.69},{"date":"3/25","premium":2.74},{"date":"3/26","premium":4.06},{"date":"3/27","premium":5.21},{"date":"3/30","premium":4.22},{"date":"3/31","premium":0.03}],
    "159941": [{"date":"3/4","premium":0.71},{"date":"3/5","premium":3.63},{"date":"3/6","premium":5.09},{"date":"3/9","premium":1.09},{"date":"3/10","premium":3.07},{"date":"3/11","premium":3.37},{"date":"3/12","premium":4.48},{"date":"3/13","premium":4.11},{"date":"3/16","premium":3.6},{"date":"3/17","premium":2.6},{"date":"3/18","premium":5.5},{"date":"3/19","premium":3.8},{"date":"3/20","premium":5.14},{"date":"3/23","premium":0.27},{"date":"3/24","premium":3.11},{"date":"3/25","premium":3.37},{"date":"3/26","premium":4.76},{"date":"3/27","premium":6.26},{"date":"3/30","premium":5.12},{"date":"3/31","premium":1.48}],
    "513300": [{"date":"3/4","premium":-0.15},{"date":"3/5","premium":2.98},{"date":"3/6","premium":4.51},{"date":"3/9","premium":0.48},{"date":"3/10","premium":3.03},{"date":"3/11","premium":3.11},{"date":"3/12","premium":4.22},{"date":"3/13","premium":3.49},{"date":"3/16","premium":2.68},{"date":"3/17","premium":1.82},{"date":"3/18","premium":4.98},{"date":"3/19","premium":2.92},{"date":"3/20","premium":4.25},{"date":"3/23","premium":-0.8},{"date":"3/24","premium":2.56},{"date":"3/25","premium":2.52},{"date":"3/26","premium":4.23},{"date":"3/27","premium":5.64},{"date":"3/30","premium":4.92},{"date":"3/31","premium":0.49}],
    "159659": [{"date":"3/4","premium":0.67},{"date":"3/5","premium":3.07},{"date":"3/6","premium":4.54},{"date":"3/9","premium":0.95},{"date":"3/10","premium":2.81},{"date":"3/11","premium":2.88},{"date":"3/12","premium":4.07},{"date":"3/13","premium":3.58},{"date":"3/16","premium":2.8},{"date":"3/17","premium":1.77},{"date":"3/18","premium":4.82},{"date":"3/19","premium":3.14},{"date":"3/20","premium":4.48},{"date":"3/23","premium":-0.54},{"date":"3/24","premium":2.51},{"date":"3/25","premium":2.66},{"date":"3/26","premium":4.36},{"date":"3/27","premium":5.52},{"date":"3/30","premium":4.58},{"date":"3/31","premium":0.66}],
    "159632": [{"date":"3/4","premium":-0.32},{"date":"3/5","premium":2.74},{"date":"3/6","premium":4.17},{"date":"3/9","premium":0.22},{"date":"3/10","premium":2.46},{"date":"3/11","premium":2.62},{"date":"3/12","premium":3.9},{"date":"3/13","premium":3.43},{"date":"3/16","premium":2.57},{"date":"3/17","premium":1.63},{"date":"3/18","premium":4.6},{"date":"3/19","premium":2.7},{"date":"3/20","premium":4.02},{"date":"3/23","premium":-1.02},{"date":"3/24","premium":2.23},{"date":"3/25","premium":2.45},{"date":"3/26","premium":3.92},{"date":"3/27","premium":5.16},{"date":"3/30","premium":4.31},{"date":"3/31","premium":0.16}],
    "159509": [{"date":"3/4","premium":9.67},{"date":"3/5","premium":14.57},{"date":"3/6","premium":17.16},{"date":"3/9","premium":11.07},{"date":"3/10","premium":14.43},{"date":"3/11","premium":14.2},{"date":"3/12","premium":15.63},{"date":"3/13","premium":16.0},{"date":"3/16","premium":16.45},{"date":"3/17","premium":14.4},{"date":"3/18","premium":17.43},{"date":"3/19","premium":15.73},{"date":"3/20","premium":17.21},{"date":"3/23","premium":11.23},{"date":"3/24","premium":16.51},{"date":"3/25","premium":16.74},{"date":"3/26","premium":17.28},{"date":"3/27","premium":19.39},{"date":"3/30","premium":19.02},{"date":"3/31","premium":13.29}],
    "513500": [{"date":"3/4","premium":4.28},{"date":"3/5","premium":6.07},{"date":"3/6","premium":6.99},{"date":"3/9","premium":3.37},{"date":"3/10","premium":4.6},{"date":"3/11","premium":4.88},{"date":"3/12","premium":6.67},{"date":"3/13","premium":5.76},{"date":"3/16","premium":4.29},{"date":"3/17","premium":4.35},{"date":"3/18","premium":5.93},{"date":"3/19","premium":4.95},{"date":"3/20","premium":5.97},{"date":"3/23","premium":0.1},{"date":"3/24","premium":2.57},{"date":"3/25","premium":3.14},{"date":"3/26","premium":5.01},{"date":"3/27","premium":6.19},{"date":"3/30","premium":4.62},{"date":"3/31","premium":1.38}],
    "159612": [{"date":"3/4","premium":4.13},{"date":"3/5","premium":5.85},{"date":"3/6","premium":6.81},{"date":"3/9","premium":3.7},{"date":"3/10","premium":5.2},{"date":"3/11","premium":5.38},{"date":"3/12","premium":6.71},{"date":"3/13","premium":6.47},{"date":"3/16","premium":5.03},{"date":"3/17","premium":4.89},{"date":"3/18","premium":6.73},{"date":"3/19","premium":5.73},{"date":"3/20","premium":6.68},{"date":"3/23","premium":0.91},{"date":"3/24","premium":2.92},{"date":"3/25","premium":4.26},{"date":"3/26","premium":5.11},{"date":"3/27","premium":6.29},{"date":"3/30","premium":5.53},{"date":"3/31","premium":2.65}],
    "513650": [{"date":"3/4","premium":2.38},{"date":"3/5","premium":4.25},{"date":"3/6","premium":5.5},{"date":"3/9","premium":2.13},{"date":"3/10","premium":3.42},{"date":"3/11","premium":3.96},{"date":"3/12","premium":5.33},{"date":"3/13","premium":4.67},{"date":"3/16","premium":2.77},{"date":"3/17","premium":2.65},{"date":"3/18","premium":4.63},{"date":"3/19","premium":2.99},{"date":"3/20","premium":4.38},{"date":"3/23","premium":-1.17},{"date":"3/24","premium":1.31},{"date":"3/25","premium":1.91},{"date":"3/26","premium":3.49},{"date":"3/27","premium":4.68},{"date":"3/30","premium":3.14},{"date":"3/31","premium":-0.17}],
}


@app.get("/api/premium_history/{code}")
def get_premium_history(code: str, response: Response):
    """ETF历史溢价率（近30个交易日）"""
    cache_key = f"prem_hist_{code}"

    cached = _mem_get(cache_key, "premium_history")
    if cached is not None:
        _cache_header(response, 1800)
        return {
            "data": cached,
            "source": "cache",
            "status": "fresh",
            "as_of": _latest_field_date(cached, ("full_date",)),
        }

    data = fetch_premium_history(code)
    if data:
        _publish_cache(cache_key, data, CACHE_TTL["premium_history"])
        source = "live"
    else:
        data = _lkg_get(cache_key) or []
        if data:
            source = "lkg"
        else:
            # 最后才展示带明确日期的历史参考数据。
            data = STATIC_PREMIUM_HISTORY.get(code, [])
            source = "reference" if data else "empty"
            if data:
                logger.info(f"[prem_hist] {code} fallback to reference snapshot")

    _cache_header(response, 1800)
    return {
        "data": data,
        "source": source,
        "status": "fresh" if source in ("live", "cache") else ("stale" if data else "empty"),
        "as_of": _latest_field_date(data, ("full_date",)) or ("2026-03-31" if data else None),
    }


@app.get("/api/debug_live/{code}")
def debug_live(code: str, authorization: Optional[str] = Header(default=None)):
    """调试：单只基金实时行情"""
    _require_job_secret(authorization)
    rt_resp = None; perf_resp_json = None; err = None
    try:
        r = requests.get(f"https://fundgz.1234567.com.cn/js/{code}.js", headers=HEADERS, timeout=(4,8))
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
            timeout=(6,12))
        perf_resp_json = r2.json()
    except Exception as e:
        err = str(e)
    return {"rt": rt_resp, "perf": perf_resp_json, "err": err}

def _build_live_data() -> dict:
    """并发拉取所有基金昨日涨跌/申购状态，返回 {code: {...}} 字典"""
    result = {}
    with ThreadPoolExecutor(max_workers=min(20, _PROVIDER_MAX_CONCURRENCY)) as ex:
        futures = {ex.submit(_fetch_live_one, code): code for code in _ALL_CODES}
        for f in futures:
            try:
                code, data = f.result(timeout=10)
                cleaned = {k: v for k, v in data.items() if v is not None and k != "code"}
                if cleaned:
                    result[code] = cleaned
            except Exception:
                pass
    return result


@app.get("/api/live_data")
def get_live_data(response: Response):
    """昨日涨跌(day_change) + 近1年滚动涨幅(rolling_1y) + 申购状态
    缓存策略：服务端内存+文件缓存12h，cron 每日 09:30 预热
    """
    cached = _mem_get("live_data", "live_data")
    cached_meta = (_cache_get("live_data:meta") or {}) if cached is not None else {}
    if cached is not None and cached_meta.get("status") == "fresh":
        _cache_header(response, 43200)
        return {
            "data": cached,
            "source": "cache",
            "status": cached_meta.get("status", "partial"),
            "as_of": cached_meta.get("as_of") or _latest_field_date(list(cached.values()), ("nav_date", "subscription_as_of")),
            "fresh_count": cached_meta.get("fresh_count"),
            "total_count": cached_meta.get("total_count", len(_ALL_CODES)),
            "schema_version": "2.0",
        }
    if cached is not None and _recovery_gate_active("live_data"):
        _cache_header(response, 43200)
        return {
            "data": cached,
            "source": "cache",
            "status": cached_meta.get("status", "partial"),
            "as_of": cached_meta.get("as_of") or _latest_field_date(list(cached.values()), ("nav_date", "subscription_as_of")),
            "fresh_count": cached_meta.get("fresh_count", 0),
            "total_count": cached_meta.get("total_count", len(_ALL_CODES)),
            "schema_version": "2.0",
        }

    refresh_lock = _try_recovery_refresh("live_data")
    if refresh_lock is None:
        if cached is not None:
            _cache_header(response, 43200)
            return {
                "data": cached,
                "source": "cache",
                "status": cached_meta.get("status", "partial"),
                "as_of": cached_meta.get("as_of") or _latest_field_date(list(cached.values()), ("nav_date", "subscription_as_of")),
                "fresh_count": cached_meta.get("fresh_count", 0),
                "total_count": cached_meta.get("total_count", len(_ALL_CODES)),
                "schema_version": "2.0",
            }
        lkg_data = _lkg_get("live_data") or {}
        lkg_meta = _lkg_get("live_data:meta") or {}
        _cache_header(response, 43200)
        return {
            "data": lkg_data,
            "source": "lkg" if lkg_data else "refresh_in_progress",
            "status": "stale" if lkg_data else "unavailable",
            "as_of": lkg_meta.get("as_of") or _latest_field_date(list(lkg_data.values()), ("nav_date", "subscription_as_of")),
            "fresh_count": 0,
            "total_count": lkg_meta.get("total_count", len(_ALL_CODES)),
            "schema_version": "2.0",
        }

    try:
        fresh_data = _build_live_data()
        if fresh_data:
            previous = {**(_lkg_get("live_data") or {}), **(cached or {})}
            data = {**previous, **fresh_data}
            is_complete = len(fresh_data) == len(set(_ALL_CODES))
            meta = {
                "status": "fresh" if is_complete else "partial",
                "fresh_count": len(fresh_data),
                "total_count": len(set(_ALL_CODES)),
                "as_of": _latest_field_date(list(fresh_data.values()), ("nav_date", "subscription_as_of")),
                "cycle_date": datetime.now(_CHINA_TZ).date().isoformat(),
                "fresh_codes": sorted(fresh_data),
            }
            if is_complete:
                _publish_cache("live_data", data, CACHE_TTL["live_data"])
                _lkg_set("live_data:meta", meta)
                source = "live"
                meta_ttl = CACHE_TTL["live_data"]
            else:
                _cache_recovery_snapshot("live_data", data)
                source = "partial"
                meta_ttl = RECOVERY_CACHE_TTL
            _cache_set("live_data:meta", meta, meta_ttl)
        else:
            lkg_data = _lkg_get("live_data") or {}
            data = lkg_data or cached or {}
            meta = _lkg_get("live_data:meta") or cached_meta
            source = "lkg" if lkg_data else ("cache" if data else "empty")
            if data:
                _cache_recovery_snapshot("live_data", data)
                _cache_set("live_data:meta", {**meta, "status": "stale"}, RECOVERY_CACHE_TTL)
    finally:
        if refresh_lock is not None:
            refresh_lock.release()

    _cache_header(response, 43200)
    return {
        "data": data,
        "source": source,
        "status": "stale" if source in ("lkg", "cache") and not fresh_data else meta.get("status", "empty"),
        "as_of": meta.get("as_of") or _latest_field_date(list(data.values()), ("nav_date", "subscription_as_of")),
        "fresh_count": meta.get("fresh_count", 0),
        "total_count": meta.get("total_count", len(_ALL_CODES)),
        "schema_version": "2.0",
    }


@app.get("/api/market-sentiment")
def get_market_sentiment(response: Response):
    """每日市场快照：每项均携带自身来源与截止日期。"""
    # v1 may contain a Yahoo QQQ PE stamped with the fetch date.  Never merge
    # that incompatible basis into the official, dated Invesco series.
    cache_key = "market_sentiment_v2"
    cached = _mem_get(cache_key, "market_sentiment")
    if cached is not None and cached.get("data_status") == "fresh":
        _cache_header(response, 3600)
        return {
            "data": cached,
            "source": "cache",
            "status": cached.get("data_status", "fresh"),
            "as_of": cached.get("as_of"),
        }
    if cached is not None and _recovery_gate_active(cache_key):
        _cache_header(response, 3600)
        return {
            "data": cached,
            "source": "cache",
            "status": cached.get("data_status", "partial"),
            "as_of": cached.get("as_of"),
        }

    refresh_lock = _try_recovery_refresh(cache_key)
    if refresh_lock is None:
        if cached is not None:
            _cache_header(response, 3600)
            return {
                "data": cached,
                "source": "cache",
                "status": cached.get("data_status", "partial"),
                "as_of": cached.get("as_of"),
            }
        lkg = _lkg_get(cache_key) or {}
        _cache_header(response, 3600)
        return {
            "data": lkg,
            "source": "lkg" if lkg else "refresh_in_progress",
            "status": "stale" if lkg else "unavailable",
            "as_of": lkg.get("as_of"),
        }

    try:
        with ThreadPoolExecutor(max_workers=6) as ex:
            futures = {
                "vix": ex.submit(fetch_vix),
                "fear_greed": ex.submit(fetch_fear_greed),
                "pe": ex.submit(fetch_sp500_pe),
                "nasdaq_pe": ex.submit(fetch_nasdaq100_pe),
                "ndx_price": ex.submit(fetch_index_price, "^NDX"),
                "spx_price": ex.submit(fetch_index_price, "^GSPC"),
            }
            fields = {}
            for name, future in futures.items():
                try:
                    fields[name] = future.result(timeout=15) or {}
                except Exception:
                    fields[name] = {}

        available = sum(1 for value in fields.values() if value)

        def _field_is_fresh(value: dict) -> bool:
            """A dated reference is displayable, but is not a fresh result."""
            if not isinstance(value, dict) or not value:
                return False
            status = value.get("data_status") or value.get("status")
            return status not in {"reference", "stale", "partial", "unavailable", "empty"}

        fresh_fields = sum(1 for value in fields.values() if _field_is_fresh(value))
        lkg = _lkg_get(cache_key) or {}
        cached_previous = cached if isinstance(cached, dict) else {}
        previous = {
            name: cached_previous.get(name) or lkg.get(name) or {}
            for name in fields
        }
        if available:
            retained_fields = [name for name, value in fields.items() if not value and previous.get(name)]
            fields = {
                name: value or previous.get(name) or {}
                for name, value in fields.items()
            }
            as_of_values = [
                value.get("as_of") or value.get("date")
                for value in fields.values() if isinstance(value, dict)
            ]
            data = {
                **fields,
                "as_of": max(filter(None, as_of_values), default=None),
                "data_status": "fresh" if fresh_fields == len(fields) else "partial",
                "available_fields": available,
                "fresh_fields": fresh_fields,
                "total_fields": len(fields),
                "retained_fields": retained_fields,
            }
            if fresh_fields == len(fields):
                _publish_cache(cache_key, data, CACHE_TTL["market_sentiment"])
                source = "live"
            else:
                _cache_recovery_snapshot(cache_key, data)
                source = "partial"
        else:
            retained_fields = [name for name, value in previous.items() if value]
            if retained_fields:
                as_of_values = [
                    value.get("as_of") or value.get("date")
                    for value in previous.values() if isinstance(value, dict)
                ]
                data = {
                    **previous,
                    "as_of": max(filter(None, as_of_values), default=None),
                    "data_status": "stale",
                    "available_fields": 0,
                    "fresh_fields": 0,
                    "total_fields": len(fields),
                    "retained_fields": retained_fields,
                }
                _cache_recovery_snapshot(cache_key, data)
                source = "lkg" if any(lkg.get(name) for name in fields) else "cache"
            else:
                data = {}
                source = "empty"
        _cache_header(response, 3600)
        return {
            "data": data,
            "source": source,
            "status": data.get("data_status", "empty"),
            "as_of": data.get("as_of"),
        }
    finally:
        if refresh_lock is not None:
            refresh_lock.release()


@app.get("/api/pe-history")
def get_pe_history(response: Response):
    """标普500 + 纳指100 历史 PE 参考序列（观测/估算逐点标识）。"""
    cache_key = "pe_history_v3"
    cached = _mem_get(cache_key, "fx_history")
    if cached is not None:
        cached_meta = cached.get("meta") or {}
        has_estimates = any((cached_meta.get(name) or {}).get("contains_estimates") for name in ("sp500", "nasdaq100"))
        _cache_header(response, 21600)
        return {"data": cached, "source": "cache", "status": "partial" if has_estimates else "fresh"}
    with ThreadPoolExecutor(max_workers=2) as ex:
        f_sp = ex.submit(fetch_sp500_pe_history, 1990)
        f_nq = ex.submit(fetch_nasdaq100_pe_history)
        try:
            sp500 = f_sp.result(timeout=25)
        except Exception:
            sp500 = []
        try:
            nasdaq = f_nq.result(timeout=25)
        except Exception:
            nasdaq = []

    def _series_meta(rows: list) -> dict:
        qualities = {row.get("quality", "unknown") for row in rows}
        return {
            "as_of": rows[-1].get("date") if rows else None,
            "points": len(rows),
            "quality": next(iter(qualities)) if len(qualities) == 1 else "mixed",
            "contains_estimates": "estimated" in qualities,
        }

    data = {
        "sp500": sp500,
        "nasdaq100": nasdaq,
        "meta": {
            "sp500": _series_meta(sp500),
            "nasdaq100": _series_meta(nasdaq),
            "usage": "reference_only_not_for_percentile",
        },
    }
    if sp500 or nasdaq:
        _publish_cache(cache_key, data, 6 * 3600)
        contains_estimates = data["meta"]["sp500"]["contains_estimates"] or data["meta"]["nasdaq100"]["contains_estimates"]
        source = "reference" if contains_estimates else "live"
    else:
        data = _lkg_get(cache_key) or data
        source = "lkg" if data.get("sp500") or data.get("nasdaq100") else "empty"
    _cache_header(response, 21600)
    return {
        "data": data,
        "source": source,
        "status": "stale" if source == "lkg" else "partial" if source == "reference" else "fresh" if source != "empty" else "empty",
    }


def _call_deepseek(prompt: str) -> str:
    """调用 DeepSeek API（兼容 OpenAI 格式）"""
    api_key = os.environ.get("DEEPSEEK_API_KEY", "")
    if not api_key:
        return ""
    try:
        resp = requests.post(
            "https://api.deepseek.com/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model": "deepseek-chat",
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": 800,
                "temperature": 0.4,
            },
            timeout=(5, 30),
        )
        if resp.ok:
            return resp.json()["choices"][0]["message"]["content"].strip()
    except Exception as e:
        logger.warning(f"[deepseek] {e}")
    return ""


@app.get("/api/market-ai-insight")
def get_market_ai_insight(response: Response):
    """每日一次、基于已验证指数快照的 AI 摘要。"""
    cache_key = "market_ai_insight_v2"
    cached = _mem_get(cache_key, "news")
    if cached is not None:
        _cache_header(response, 86400)
        return {"data": cached, "source": "cache", "status": "fresh"}

    # 没有持久缓存时不允许每个页面访问都触发付费模型调用。
    if not _get_redis():
        return {"data": None, "source": "disabled", "status": "unavailable", "reason": "persistent_cache_required"}

    # 获取最新指数数据
    with ThreadPoolExecutor(max_workers=2) as ex:
        f_ndx = ex.submit(fetch_index_price, "^NDX")
        f_spx = ex.submit(fetch_index_price, "^GSPC")
        ndx = f_ndx.result(timeout=20)
        spx = f_spx.result(timeout=20)

    if not ndx or not spx:
        return {"data": None, "source": "empty"}

    def fmt(v, suffix=""):
        if v is None: return "暂无"
        sign = "+" if v >= 0 else ""
        return f"{sign}{v}{suffix}"

    today = datetime.utcnow().strftime("%Y-%m-%d")

    prompt = f"""请仅依据下面给出的数字，生成2条中性、可核验的中文市场摘要。
不得补充未提供的历史事实，不得预测收益，不得给出买卖建议；数据不足就明确说不足。
每条40-70字，level只能是 bullish、neutral 或 bearish。
严格输出JSON数组，不要输出其他文字：
[{{"tag":"3-5字标题","icon":"一个emoji","text":"摘要","level":"neutral"}}]

数据日期：{today}
纳指100：{ndx.get('price')}点，日涨跌{fmt(ndx.get('change_pct'),'%')}，连续方向天数{ndx.get('streak',0)}，近15日{fmt(ndx.get('returns',{}).get('d15'),'%')}，近1月{fmt(ndx.get('returns',{}).get('mo1'),'%')}，近半年{fmt(ndx.get('returns',{}).get('mo6'),'%')}，近1年{fmt(ndx.get('returns',{}).get('yr1'),'%')}。
标普500：{spx.get('price')}点，日涨跌{fmt(spx.get('change_pct'),'%')}，连续方向天数{spx.get('streak',0)}，近15日{fmt(spx.get('returns',{}).get('d15'),'%')}，近1月{fmt(spx.get('returns',{}).get('mo1'),'%')}，近半年{fmt(spx.get('returns',{}).get('mo6'),'%')}，近1年{fmt(spx.get('returns',{}).get('yr1'),'%')}。"""

    # 防止多个冷启动请求同时触发付费调用。锁在模型最长 30s 超时之外留余量。
    redis = _get_redis()
    lock_key = "lock:market_ai_insight_v2"
    lock_token = secrets.token_hex(12)
    try:
        lock_acquired = bool(redis.set(lock_key, lock_token, nx=True, ex=60)) if redis else False
    except Exception as exc:
        logger.warning(f"[deepseek:lock] {exc}")
        lock_acquired = False
    if not lock_acquired:
        retained = _lkg_get(cache_key)
        _cache_header(response, 60)
        return {
            "data": retained,
            "source": "lkg" if retained else "generation_in_progress",
            "status": "stale" if retained else "unavailable",
        }
    try:
        ai_text = _call_deepseek(prompt)
    finally:
        try:
            # 60 秒锁长于模型超时，因此不会误删下一位持有者的锁。
            redis.delete(lock_key)
        except Exception:
            pass

    # 解析 JSON
    insights = []
    if ai_text:
        try:
            match = re.search(r'\[.*\]', ai_text, re.DOTALL)
            if match:
                insights = json.loads(match.group())
        except Exception as e:
            logger.warning(f"[deepseek:parse] {e}, raw: {ai_text[:200]}")

    result = {
        "insights": insights,
        "ndx_summary": {"price": ndx.get('price'), "streak": ndx.get('streak'), "yr_high": ndx.get('yr_high')},
        "spx_summary": {"price": spx.get('price'), "streak": spx.get('streak'), "yr_high": spx.get('yr_high')},
        "generated_at": datetime.utcnow().strftime("%Y-%m-%d") + " 每日更新",
    }

    if insights:
        _publish_cache(cache_key, result, 24 * 3600)
        source = "live"
    else:
        result = _lkg_get(cache_key)
        source = "lkg" if result else "empty"
    _cache_header(response, 86400)
    return {"data": result, "source": source, "status": "stale" if source == "lkg" else "fresh" if source == "live" else "empty"}


# ─── 微信小程序：登录 & 用户收藏 ──────────────────────────────────────────────

from pydantic import BaseModel

class WxLoginBody(BaseModel):
    code: str

class FavoritesBody(BaseModel):
    openid: str
    favorites: list

@app.post("/api/wx/login")
def wx_login(body: WxLoginBody):
    """微信 code 换 openid（服务端保存 session_key，前端只拿 openid）"""
    appid  = os.environ.get("WX_APPID")
    secret = os.environ.get("WX_SECRET")
    if not appid or not secret:
        return {"error": "wx credentials not configured"}, 500

    resp = _get(
        "https://api.weixin.qq.com/sns/jscode2session",
        params={
            "appid":      appid,
            "secret":     secret,
            "js_code":    body.code,
            "grant_type": "authorization_code",
        },
        timeout=(3, 5),
    )
    if not resp or not resp.ok:
        return {"error": "weixin api failed"}

    data = resp.json()
    if "errcode" in data and data["errcode"] != 0:
        logger.warning(f"[wx_login] errcode={data['errcode']} errmsg={data.get('errmsg')}")
        return {"error": data.get("errmsg", "wx login failed")}

    openid      = data.get("openid")
    session_key = data.get("session_key", "")

    # 将 session_key 存入 Redis（TTL 2小时），openid 返回给前端
    if openid:
        r = _get_redis()
        if r:
            try:
                r.set(f"wx:session:{openid}", session_key, ex=7200)
            except Exception as e:
                logger.warning(f"[wx_login] redis set session: {e}")

    return {"openid": openid}


@app.get("/api/user/favorites")
def get_favorites(openid: str, response: Response):
    """获取用户收藏列表"""
    if not openid:
        return {"favorites": []}
    r = _get_redis()
    if not r:
        return {"favorites": []}
    try:
        raw = r.get(f"user:favorites:{openid}")
        if raw:
            return {"favorites": json.loads(raw) if isinstance(raw, str) else raw}
    except Exception as e:
        logger.warning(f"[favorites:get] {e}")
    return {"favorites": []}


@app.post("/api/user/favorites")
def save_favorites(body: FavoritesBody, response: Response):
    """保存用户收藏列表"""
    r = _get_redis()
    if not r:
        return {"ok": False, "reason": "redis unavailable"}
    try:
        r.set(
            f"user:favorites:{body.openid}",
            json.dumps(body.favorites, ensure_ascii=False),
            ex=90 * 24 * 3600,   # 90天 TTL
        )
        return {"ok": True}
    except Exception as e:
        logger.warning(f"[favorites:save] {e}")
        return {"ok": False, "reason": str(e)}


# ═══════════════════════════════════════════════════════════════════════════════
# QDII 估值模块
# ═══════════════════════════════════════════════════════════════════════════════

import html as _html_mod
import random as _random
import sqlite3 as _sqlite3
from pathlib import Path as _Path
from contextlib import contextmanager as _ctx

# 所有主动 QDII 基金代码（与前端 QDII_FUNDS 同步）
QDII_CODES = list(_LEGACY_QDII_CODES)

# C 类 → A 类持仓重定向（同一投资组合，避免缓存时序差异导致 A/C 持仓不一致）
_C_TO_A_HOLDINGS_MAP: dict[str, str] = {
    "022184": "100055",  # 富国全球科技互联网C → A
    "016702": "016701",  # 银华海外数字经济C → A
    "017437": "017436",  # 华宝纳斯达克精选C → A
    "017731": "017730",  # 嘉实全球产业升级C → A
    "018036": "501226",  # 长城全球新能源汽车C → A
    "017145": "017144",  # 华宝海外新能源汽车C → A
    "018156": "018155",  # 创金合信全球医药生物C → A
    "006309": "006308",  # 汇添富全球消费C → A
}

# ─── SQLite ───────────────────────────────────────────────────────────────────

_SEED_DB_PATH = _Path(__file__).parent.parent / "wise_etf.db"

def _get_db_path() -> _Path:
    """Vercel 部署目录只读，写操作走 /tmp；本地开发直接用项目根目录。"""
    if os.environ.get("VERCEL"):
        tmp = _Path("/tmp/wise_etf.db")
        if not tmp.exists() and _SEED_DB_PATH.exists():
            import shutil
            try:
                shutil.copy2(str(_SEED_DB_PATH), str(tmp))
                logger.info("[db] copied seed db to /tmp/wise_etf.db")
            except Exception as e:
                logger.warning(f"[db] seed copy failed: {e}")
        return tmp
    return _SEED_DB_PATH

_DB_PATH = _get_db_path()

@_ctx
def _db():
    conn = _sqlite3.connect(str(_DB_PATH))
    conn.row_factory = _sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()

def _init_qdii_tables():
    with _db() as conn:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS qdii_holdings (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            fund_code   TEXT NOT NULL,
            report_date TEXT,
            symbol      TEXT NOT NULL,
            name        TEXT,
            weight      REAL,
            updated_at  TEXT
        );
        CREATE UNIQUE INDEX IF NOT EXISTS uix_qdii_holdings
            ON qdii_holdings(fund_code, symbol, report_date);

        CREATE TABLE IF NOT EXISTS qdii_stock_prices (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol      TEXT NOT NULL,
            date        TEXT NOT NULL,
            change_pct  REAL,
            updated_at  TEXT,
            UNIQUE(symbol, date)
        );

        CREATE TABLE IF NOT EXISTS qdii_valuations (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            fund_code   TEXT NOT NULL,
            date        TEXT NOT NULL,
            valuation   REAL,
            coverage    REAL,
            fx_change   REAL,
            created_at  TEXT,
            UNIQUE(fund_code, date)
        );

        CREATE TABLE IF NOT EXISTS qdii_full_cache (
            id          INTEGER PRIMARY KEY,
            payload     TEXT NOT NULL,
            session     TEXT NOT NULL,
            computed_at TEXT NOT NULL
        );
        """)

try:
    _init_qdii_tables()
except Exception as _e:
    logger.warning(f"[db] init tables failed (non-fatal): {_e}")

# qdii_stock_prices 表加 close_price 列（旧表无此列，忽略已存在错误）
try:
    with _db() as _conn:
        _conn.execute("ALTER TABLE qdii_stock_prices ADD COLUMN close_price REAL")
except Exception:
    pass


def _db_save_holdings(fund_code: str, holdings: list, report_date: str = ""):
    now = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    with _db() as conn:
        for h in holdings[:10]:
            conn.execute("""
                INSERT INTO qdii_holdings(fund_code, report_date, symbol, name, weight, updated_at)
                VALUES(?,?,?,?,?,?)
                ON CONFLICT(fund_code, symbol, report_date) DO UPDATE SET
                    name=excluded.name, weight=excluded.weight, updated_at=excluded.updated_at
            """, (fund_code, report_date, h["symbol"], h["name"], h["weight"], now))


def _db_save_stock_prices(stock_cache: dict, date: str):
    now = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    with _db() as conn:
        for sym, pf in stock_cache.items():
            # stock_cache 值为 {pre_pct, regular_pct, post_pct}，取 regular 存库
            pct = pf.get("regular_pct") if isinstance(pf, dict) else pf
            if pct is not None:
                conn.execute("""
                    INSERT INTO qdii_stock_prices(symbol, date, change_pct, updated_at)
                    VALUES(?,?,?,?)
                    ON CONFLICT(symbol, date) DO UPDATE SET
                        change_pct=excluded.change_pct, updated_at=excluded.updated_at
                """, (sym, date, pct, now))


def _db_save_daily_snap(snap: dict, date: str):
    """保存每日 Nasdaq 快照到 qdii_stock_prices，并删除 3 天前旧数据。"""
    if not snap:
        return
    now = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    with _db() as conn:
        for sym, data in snap.items():
            conn.execute("""
                INSERT INTO qdii_stock_prices(symbol, date, change_pct, updated_at)
                VALUES(?,?,?,?)
                ON CONFLICT(symbol, date) DO UPDATE SET
                    change_pct=excluded.change_pct,
                    updated_at=excluded.updated_at
            """, (sym, date, data.get("pct"), now))
        conn.execute("DELETE FROM qdii_stock_prices WHERE date < date('now', '-3 days')")
    logger.info(f"[db] saved daily snap {date}: {len(snap)} symbols, cleaned >3d old data")


def _db_load_latest_prices(symbols: list) -> dict:
    """从 DB 读取每个 symbol 最近一条涨跌数据，用于 Nasdaq 失败时兜底。"""
    if not symbols:
        return {}
    with _db() as conn:
        placeholders = ",".join("?" * len(symbols))
        rows = conn.execute(f"""
            SELECT symbol, change_pct FROM qdii_stock_prices
            WHERE symbol IN ({placeholders})
            AND change_pct IS NOT NULL
            ORDER BY date DESC
        """, symbols).fetchall()
    result = {}
    for row in rows:
        sym = row["symbol"]
        if sym not in result:  # 每个 symbol 只取最新一条
            result[sym] = {"pct": row["change_pct"]}
    return result


def _db_save_valuations(results: list, date: str):
    now = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    with _db() as conn:
        for r in results:
            if r["valuation"] is not None:
                conn.execute("""
                    INSERT INTO qdii_valuations(fund_code, date, valuation, coverage, fx_change, created_at)
                    VALUES(?,?,?,?,?,?)
                    ON CONFLICT(fund_code, date) DO UPDATE SET
                        valuation=excluded.valuation, coverage=excluded.coverage,
                        fx_change=excluded.fx_change, created_at=excluded.created_at
                """, (r["code"], date, r["valuation"], r["coverage"], r["fx_change"], now))

def _db_save_full_cache(payload: dict):
    """将完整估值 payload 持久化到 SQLite，供重启后冷启动使用。"""
    try:
        with _db() as conn:
            conn.execute("DELETE FROM qdii_full_cache")
            conn.execute(
                "INSERT INTO qdii_full_cache(payload, session, computed_at) VALUES(?,?,?)",
                (json.dumps(payload, ensure_ascii=False), payload.get("session", "closed"), payload.get("updated_at", ""))
            )
    except Exception as e:
        logger.warning(f"[qdii] db save full cache failed: {e}")


def _db_load_full_cache() -> Optional[dict]:
    """从 SQLite 加载上一次计算的完整估值 payload。"""
    try:
        with _db() as conn:
            row = conn.execute(
                "SELECT payload FROM qdii_full_cache ORDER BY id DESC LIMIT 1"
            ).fetchone()
            if row:
                return json.loads(row["payload"])
    except Exception as e:
        logger.warning(f"[qdii] db load full cache failed: {e}")
    return None


# 缓存 TTL
_HOLDINGS_TTL   = 24 * 3600   # 季报持仓，每天刷一次
_STOCK_CHG_TTL  = 20 * 3600   # 个股涨跌幅，盘后固定

def _current_session() -> str:
    """
    返回当前市场时段（基于 HKT，EDT=HKT-12）：
      a_share     HKT 08:00-16:00 周一至周五（A股交易中）
      pre_market  HKT 16:00-21:30 周一至周五（美股盘前）
      us_open     HKT 21:30-04:00 周一至周五（美股盘中，跨午夜）
                  + HKT 周六 00:00-04:00（美股周五收盘前，Fri 12:00-16:00 ET）
      post_market HKT 04:00-08:00 周一至周五（美股盘后）
      weekend     HKT 周六 04:00 至周一 08:00（美股完全休市）

    修正说明：
      - 周六 HKT 00:00-04:00：美股周五仍在交易（ET 12:00-16:00），应为 us_open
      - 周一 HKT 00:00-08:00：美股仍是周日休市，应为 weekend（原代码误判为 us_open/post_market）
    """
    from datetime import timezone, timedelta
    HKT = timezone(timedelta(hours=8))
    now = datetime.now(HKT)
    wd = now.weekday()  # 0=周一 … 4=周五 5=周六 6=周日
    h  = now.hour + now.minute / 60.0

    # 周六：
    #   00:00-04:00 → 美股周五盘中（Fri 12:00-16:00 ET）
    #   04:00-08:00 → 美股周五盘后（Fri 16:00-20:00 ET）
    #   08:00+      → 真正休市
    if wd == 5:
        if h < 4.0: return "us_open"
        if h < 8.0: return "post_market"
        return "weekend"

    # 周日：全天休市（无盘后，美股周六不交易）
    if wd == 6:
        return "weekend"

    # 周一：00:00-08:00 仍是美股周日休市（无盘后）；08:00 起 A 股开盘
    if wd == 0 and h < 8.0:
        return "weekend"

    # 周一 08:00 至周五 24:00（正常工作日逻辑）
    if 8.0 <= h < 16.0:      return "a_share"
    if 16.0 <= h < 21.5:     return "pre_market"
    if h >= 21.5 or h < 4.0: return "us_open"
    return "post_market"  # HKT 04:00-08:00

_VALUATION_TTL  = 20 * 3600   # 持仓数据写 DB 时用


# ─── 持仓抓取（多层次策略）─────────────────────────────────────────────────────

def _strip_tags(s: str) -> str:
    return re.sub(r'<[^>]+>', '', s).strip()


# 东方财富 unify/r/{id}.{code} 中的数字市场 ID → Yahoo Finance 后缀
# 实测：0=深交所 1=上交所 105=NASDAQ 106=NYSE 116=港交所
_EM_ID_TO_YF: dict[str, str] = {
    "0":   "SZ",   # 深交所（主板/创业板/科创板）
    "1":   "SS",   # 上交所
    "116": "HK",   # 港交所
    # 200-299 范围通常为其他境外交易所，遇到再补充
}
# 美股市场 ID（直接用代码，不加后缀）
_EM_US_IDS = {"105", "106", "107", "74"}

def _map_em_id_to_yahoo(market_id: str, code: str) -> str:
    """根据东方财富数字市场 ID 转换为 Yahoo Finance symbol"""
    if market_id in _EM_US_IDS:
        return code.upper()
    if market_id in _EM_ID_TO_YF:
        suffix = _EM_ID_TO_YF[market_id]
        if suffix == "HK":
            try: return f"{int(code)}.HK"
            except ValueError: return f"{code}.HK"
        return f"{code}.{suffix}"
    # 未知 ID：按代码位数+首位启发式推断
    return _normalize_symbol(code)

def _normalize_symbol(raw: str) -> str:
    """无市场 ID 时的兜底：纯数字按首位+位数推断交易所"""
    raw = raw.strip()
    if not raw:
        return raw
    if raw.isdigit():
        n, head = len(raw), raw[0]
        if n == 6:
            if head == "6": return f"{raw}.SS"   # 上交所 600xxx/603xxx/688xxx
            if head == "3": return f"{raw}.SZ"   # 创业板 300xxx/301xxx
            return f"{raw}.KS"                   # 其余6位优先当韩股
        if n == 4: return f"{raw}.TW"            # 台股
        return f"{int(raw)}.HK"                  # 港股
    return raw


def _parse_em_holdings_table(html: str) -> list:
    """
    解析东方财富持仓 HTML 表格，动态检测权重列。
    季报: 序号|代码|名称|最新价|涨跌幅|相关资讯|占净值%|持股数|持仓市值
    年报/半年报: 序号|代码|名称|相关资讯|占净值%|持股数|持仓市值（列数不同）
    取第一张有实质内容的表格（即当前报告期），忽略页面下方历史季报小表。
    """
    tables = re.findall(r'<table[^>]*>(.*?)</table>', html, re.DOTALL)
    if not tables:
        return []
    # 取第一张行数 >= 2 的表（当前报告期），而非最大的表（可能是历史合并）
    target = None
    for t in tables:
        if len(re.findall(r'<tr[^>]*>', t)) >= 2:
            target = t
            break
    if not target:
        return []

    rows = re.findall(r'<tr[^>]*>(.*?)</tr>', target, re.DOTALL)
    holdings = []
    seen_symbols: set = set()
    for row in rows:
        raw_cells = re.findall(r'<td[^>]*>(.*?)</td>', row, re.DOTALL)
        cells = [_strip_tags(c) for c in raw_cells]
        if len(cells) < 4:
            continue
        sym_raw  = cells[1] if len(cells) > 1 else ""
        name_raw = cells[2] if len(cells) > 2 else ""
        if not sym_raw:
            continue
        # 从代码列 HTML 中提取 unify/r/{id}.{code} 精准映射交易所
        symbol = sym_raw  # 默认用文本内容
        if len(raw_cells) > 1:
            mu = re.search(r'unify/r/(\d+)\.([^\'\" <>\s]+)', raw_cells[1])
            if mu:
                symbol = _map_em_id_to_yahoo(mu.group(1), mu.group(2).strip())
            else:
                symbol = _normalize_symbol(sym_raw)
        # 去重
        if symbol in seen_symbols:
            continue
        # 动态找权重列：找第一个 0 < val <= 30 的列（避免误识别价格/持股数）
        weight = None
        for i in range(3, min(len(cells), 10)):
            try:
                w = float(cells[i].replace('%', '').strip())
                if 0 < w <= 30:
                    weight = w
                    break
            except ValueError:
                continue
        if weight is None:
            continue
        seen_symbols.add(symbol)
        holdings.append({
            "name":   name_raw,
            "symbol": symbol,
            "weight": weight,
            "change": None,
        })
    return holdings


def _fetch_em_holdings_for_period(code: str, year: str, month: str) -> tuple:
    """调用东方财富 FundArchivesDatas 接口获取指定报告期持仓。
    返回 (holdings: list, report_date: str)，失败时返回 ([], "")。
    """
    url = "https://fundf10.eastmoney.com/FundArchivesDatas.aspx"
    params = {
        "type":    "jjcc",
        "code":    code,
        "topline": "200",   # 年报/半年报时服务端会返回完整持仓
        "year":    year,
        "month":   month,
        "rt":      str(_random.random()),
    }
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Referer":    f"https://fundf10.eastmoney.com/ccmx_{code}.html",
    }
    try:
        resp = _get(url, params=params, headers=headers, timeout=(6, 15))
        if not (resp and resp.ok):
            return [], ""
        m = re.search(r'content:"(.*?)"(?:,|\s*})', resp.text, re.DOTALL)
        if not m:
            return [], ""
        html = _html_mod.unescape(m.group(1))
        # 提取报告期日期（如 "2026-03-31"）
        dm = re.search(r'截止至[：:]\s*<font[^>]*>(\d{4}-\d{2}-\d{2})</font>', html)
        report_date = dm.group(1) if dm else ""
        return _parse_em_holdings_table(html), report_date
    except Exception as e:
        logger.warning(f"[em_holdings] {code} y={year} m={month}: {e}")
        return [], ""


def _fetch_holdings_from_annual_pdf(code: str) -> list:
    """
    通过东方财富 JJGG 接口找年报/半年报 PDF，用 pdfplumber 解析完整持仓。
    返回 [] 若失败。
    """
    try:
        import pdfplumber, io
    except ImportError:
        logger.warning("[pdf] pdfplumber not installed")
        return []

    try:
        # 获取基金公告列表（type=3: 定期报告）
        jjgg_url = "http://api.fund.eastmoney.com/f10/JJGG"
        jjgg_params = {
            "fundcode": code, "pageIndex": 1, "pageSize": 10,
            "type": "3", "_": str(int(time.time() * 1000)),
        }
        jjgg_headers = {
            "User-Agent": "Mozilla/5.0",
            "Referer": f"https://fundf10.eastmoney.com/jjgg_{code}_3.html",
        }
        resp = _get(jjgg_url, params=jjgg_params, headers=jjgg_headers, timeout=(5, 12))
        if not (resp and resp.ok):
            logger.warning(f"[pdf] JJGG fetch failed for {code}")
            return []

        data = resp.json()
        announcements = data.get("Data", []) or []

        # 优先找年报（含"年度报告"或"年报"），其次半年报
        pdf_url = None
        for priority_keyword in ["年度报告", "年报", "半年度报告", "半年报"]:
            for ann in announcements:
                title = ann.get("TITLE", "") or ann.get("title", "")
                ann_id = ann.get("ID", "") or ann.get("id", "")
                if priority_keyword in title and ann_id:
                    pdf_url = f"http://pdf.dfcfw.com/pdf/H2_{ann_id}_1.pdf"
                    logger.info(f"[pdf] found '{title}' → {pdf_url}")
                    break
            if pdf_url:
                break

        if not pdf_url:
            logger.warning(f"[pdf] no annual/semi-annual report found for {code}")
            return []

        # 下载 PDF
        pdf_resp = _get(pdf_url, timeout=(10, 30))
        if not (pdf_resp and pdf_resp.ok):
            logger.warning(f"[pdf] download failed: {pdf_url}")
            return []

        # 解析 PDF
        holdings = []
        seen_symbols = set()
        with pdfplumber.open(io.BytesIO(pdf_resp.content)) as pdf:
            for page in pdf.pages:
                text = page.extract_text() or ""
                # 定位到"所有权益投资明细"或"股票投资明细"部分
                if not any(kw in text for kw in ["权益投资", "股票投资", "投资明细", "持仓"]):
                    continue
                # 逐行解析，找包含股票代码和权重的行
                for line in text.split('\n'):
                    line = line.strip()
                    # 找百分比数值（占净值比例）
                    pct_matches = re.findall(r'(\d+\.\d+)%', line)
                    if not pct_matches:
                        continue
                    # 找股票代码（如 NVDA US / TSLA US / 2513 HK / 2454 TW）
                    code_match = re.search(
                        r'\b([A-Z]{1,5}(?:\.[A-Z])?|[0-9]{4,5})\s+(US|HK|TW|KR|JP|GB|FR|DE|NL)\b',
                        line
                    )
                    if not code_match:
                        continue
                    raw_code, market = code_match.group(1), code_match.group(2)
                    # 转换为 Yahoo Finance 格式
                    if market == "HK":
                        yf_sym = f"{int(raw_code)}.HK"
                    elif market == "TW":
                        yf_sym = f"{raw_code}.TW"
                    elif market == "KR":
                        yf_sym = f"{raw_code}.KS"
                    else:
                        yf_sym = raw_code  # US stocks 直接用
                    if yf_sym in seen_symbols:
                        continue
                    try:
                        weight = float(pct_matches[0])
                        if 0 < weight <= 25:
                            seen_symbols.add(yf_sym)
                            holdings.append({
                                "name": "",
                                "symbol": yf_sym,
                                "weight": weight,
                                "change": None,
                            })
                    except ValueError:
                        continue

        logger.info(f"[pdf] {code}: extracted {len(holdings)} holdings from PDF")
        return holdings
    except Exception as e:
        logger.warning(f"[pdf] {code}: {e}")
        return []


def fetch_qdii_holdings(code: str, _cached=None) -> list:
    """返回持仓列表。元数据（报告期等）存在 qdii_hmeta_{code} 缓存中。"""
    if _cached is not None:
        return _cached
    master_code = _C_TO_A_HOLDINGS_MAP.get(code, code)
    if master_code != code:
        logger.info(f"[qdii_holdings] {code} → redirect to A class {master_code}")
        return fetch_qdii_holdings(master_code)

    cache_key = f"qdii_h_{code}"
    cached = _cache_get(cache_key)
    if cached:
        return cached

    return _do_fetch_qdii_holdings(code)


def _do_fetch_qdii_holdings(code: str) -> list:
    """
    实际拉取逻辑，不走缓存。
    持仓获取策略：
    1. 最新季报（year="",month=""，东方财富返回最新一期），前十大持仓，保持原顺序。
       - 验证报告期：必须是季末（03-31 / 06-30 / 09-30 / 12-31），否则视为异常。
       - 季报失败 → 缓存30分钟（短TTL），让下次请求重试，而不是将年报数据缓存24小时。
    2. 仅用 2025年12月年报 补充季报没有的品种。
       - 不回溯更早数据；若年报异常或缺失，仅返回季报前十。
    3. 季报+年报均失败 → 尝试 PDF 年报。
    """
    cache_key = f"qdii_h_{code}"
    meta_key  = f"qdii_hmeta_{code}"

    # Step 1: 最新季报
    latest_q, q_date = _fetch_em_holdings_for_period(code, "", "")
    logger.info(f"[qdii_holdings] {code} latest: {len(latest_q)} holdings, date={q_date!r}")

    # 验证：季报日期必须是季末
    _QUARTER_ENDS = {"-03-31", "-06-30", "-09-30", "-12-31"}
    q_is_valid = bool(latest_q) and any(q_date.endswith(e) for e in _QUARTER_ENDS)
    if latest_q and not q_is_valid:
        logger.warning(f"[qdii_holdings] {code}: quarterly date={q_date!r} 不是季末，忽略")
        latest_q = []

    # Step 2: 2025年12月年报（补充用）
    complete_h: list = []
    ann_date = ""
    h, ann_date = _fetch_em_holdings_for_period(code, "2025", "12")
    if h:
        total_w = sum(x["weight"] for x in h)
        logger.info(f"[qdii_holdings] {code} 2025-12年报: {len(h)} holdings, total_w={total_w:.1f}%, date={ann_date!r}")
        if total_w > 120 or len(h) > 200:
            logger.warning(f"[qdii_holdings] {code} 2025-12年报异常(weight={total_w:.1f}%,count={len(h)})，跳过")
        elif len(h) > 10:
            complete_h = h
    else:
        logger.warning(f"[qdii_holdings] {code}: 未找到2025年12月年报")

    # Step 3: 合并
    report_date = q_date  # 优先用季报日期
    source = "quarterly"

    if latest_q and complete_h:
        q_symbols      = {x["symbol"] for x in latest_q}
        q_weight_total = sum(x["weight"] for x in latest_q)
        supplemental   = [x for x in complete_h if x["symbol"] not in q_symbols]
        sup_weight_total = sum(x["weight"] for x in supplemental)
        remaining = max(0.0, 100.0 - q_weight_total)
        if sup_weight_total > 0 and remaining > 1.0:
            scale = remaining / sup_weight_total
            supplemental = [{**x, "weight": round(x["weight"] * scale, 4)} for x in supplemental]
            supplemental.sort(key=lambda x: x["weight"], reverse=True)
            best_holdings = latest_q + supplemental
        else:
            best_holdings = latest_q
        source = "quarterly+annual"
        logger.info(f"[qdii_holdings] {code}: merged={len(best_holdings)} (q={len(latest_q)}+sup={len(supplemental)})")
    elif latest_q:
        best_holdings = latest_q
    elif complete_h:
        complete_h.sort(key=lambda x: x["weight"], reverse=True)
        best_holdings = complete_h
        report_date = ann_date
        source = "annual_only"
        logger.warning(f"[qdii_holdings] {code}: 季报失败，仅使用年报数据 date={ann_date!r}")
    else:
        best_holdings = []

    # Step 4: PDF 兜底
    if not best_holdings:
        pdf_h = _fetch_holdings_from_annual_pdf(code)
        if pdf_h:
            best_holdings = pdf_h
            source = "pdf"
            logger.info(f"[qdii_holdings] {code}: PDF兜底 ({len(pdf_h)} positions)")

    if best_holdings:
        best_holdings = best_holdings[:10]
        # 季报成功 → 正常TTL；仅年报/PDF兜底 → 短TTL，让下次请求尽快重试季报
        ttl = _HOLDINGS_TTL if source in ("quarterly", "quarterly+annual") else 1800
        _cache_set(cache_key, best_holdings, ttl)
        _cache_set(meta_key, {"report_date": report_date, "source": source}, ttl)
        if source not in ("quarterly", "quarterly+annual"):
            logger.warning(f"[qdii_holdings] {code}: 使用{source}兜底，TTL=30min，等待季报重试")
    else:
        logger.warning(f"[qdii_holdings] {code}: 所有来源均失败")

    return best_holdings



def fetch_fx_data() -> dict:
    """
    美元/人民币数据：{change: float, price: float}
    change = 涨跌幅%，price = 实际汇率（如 6.7856）
    """
    cache_key = "qdii_fx_data"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    res = _yf_chart("USDCNY=X", interval="1d", range_="5d")
    if not res:
        return {"change": 0.0, "price": None}
    try:
        meta  = res["meta"]
        price = float(meta.get("regularMarketPrice") or 0)
        closes = res.get("indicators", {}).get("quote", [{}])[0].get("close", []) if isinstance(res, dict) else []
        valid = [c for c in closes if c is not None]
        prev = float(valid[-2]) if len(valid) >= 2 else float(
            meta.get("regularMarketPreviousClose")
            or meta.get("chartPreviousClose")
            or meta.get("previousClose") or 0
        )
        pct = round((price - prev) / prev * 100, 2) if price and prev else 0.0
        result = {"change": pct, "price": round(price, 4) if price else None}
        # 汇率在美股盘中随时变，跟随 _valuation_ttl()；非交易时段用 8h
        s = _current_session()
        ttl = _valuation_ttl() if s in ("us_open", "pre_market", "post_market") else 8 * 3600
        _cache_set(cache_key, result, ttl)
        return result
    except Exception:
        return {"change": 0.0, "price": None}

def fetch_fx_change() -> float:
    return fetch_fx_data()["change"]


def fetch_fund_nav(code: str) -> Optional[float]:
    """从天天基金实时接口获取最新净值（dwjz），缓存 6h"""
    cache_key = f"qdii_nav_{code}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return float(cached)
    try:
        url  = f"https://fundgz.1234567.com.cn/js/{code}.js"
        resp = _get(url, timeout=(3, 8))
        if not (resp and resp.ok):
            return None
        m = re.search(r'\{.*\}', resp.text)
        if not m:
            return None
        data = json.loads(m.group(0))
        nav  = float(data.get("dwjz") or 0)
        if nav > 0:
            _cache_set(cache_key, nav, 6 * 3600)
            return nav
    except Exception as e:
        logger.warning(f"[nav] {code}: {e}")
    return None


def fetch_fund_gszzl(code: str, _cached=None) -> dict:
    """
    从天天基金 fundgz 接口一次性获取：dwjz(净值) + gszzl(估值涨幅) + gsz + gztime。
    合并原 fetch_fund_nav，避免对同一 URL 的重复请求。
    返回: {gszzl, gsz, gztime, is_fresh, nav}
    开盘时段 TTL=15min，其他时段 TTL=30min。
    """
    if _cached is not None:
        return _cached
    cache_key = f"qdii_gszzl_{code}"
    cached = _cache_get(cache_key)
    if cached:
        return cached
    result: dict = {"gszzl": None, "gsz": None, "gztime": None, "is_fresh": False, "nav": None, "nav_date": None}
    try:
        from datetime import timezone, timedelta
        url  = f"https://fundgz.1234567.com.cn/js/{code}.js"
        resp = _get(url, timeout=(3, 8))
        if not (resp and resp.ok):
            return result
        m = re.search(r'\{.*?\}', resp.text, re.DOTALL)
        if not m:
            return result
        data      = json.loads(m.group(0))
        gztime    = (data.get("gztime") or "").strip()
        gszzl_str = (data.get("gszzl") or "").strip()
        gsz_str   = (data.get("gsz")   or "").strip()
        dwjz_str  = (data.get("dwjz")  or "").strip()
        jzrq_str  = (data.get("jzrq")  or "").strip()   # 净值日期 e.g. "2025-05-14"
        beijing_today = datetime.now(timezone(timedelta(hours=8))).strftime("%Y-%m-%d")
        gszzl: Optional[float] = None
        if gszzl_str and gszzl_str not in ("0.00", "0", ""):
            try: gszzl = round(float(gszzl_str), 2)
            except ValueError: pass
        gsz: Optional[float] = None
        if gsz_str:
            try: gsz = float(gsz_str)
            except ValueError: pass
        nav: Optional[float] = None
        if dwjz_str:
            try:
                v = float(dwjz_str)
                if v > 0: nav = round(v, 4)
            except ValueError: pass
        is_fresh = bool(gztime and gztime.startswith(beijing_today) and gszzl is not None)
        result = {
            "gszzl":    gszzl,
            "gsz":      gsz,
            "gztime":   gztime or None,
            "is_fresh": is_fresh,
            "nav":      nav,
            "nav_date": jzrq_str or None,
        }
        s   = _current_session()
        # 周末 A股不开盘，gszzl 数据不变，缓存 12h；其他时段跟随 _valuation_ttl()
        ttl = 12 * 3600 if s == "weekend" else _valuation_ttl()
        _cache_set(cache_key, result, ttl)
    except Exception as e:
        logger.warning(f"[gszzl] {code}: {e}")
    return result


def fetch_fund_meta(code: str, _cached=None) -> dict:
    """
    从 eastmoney pingzhongdata 获取：
      - scale:      最新季度净资产(亿)，来自 Data_assetAllocation["净资产"][-1]
      - ytd_return: 2025全年收益率(%)，由 Data_ACWorthTrend 计算（累计净值，处理份额折算）
    缓存 12h。
    """
    if _cached is not None:
        return _cached
    cache_key = f"qdii_meta_{code}"
    cached = _cache_get(cache_key)
    if cached:
        return cached

    result: dict = {"scale": None, "ytd_return": None, "nav_latest": None}
    try:
        url  = f"https://fund.eastmoney.com/pingzhongdata/{code}.js"
        resp = _get(url, timeout=(5, 15))
        if not (resp and resp.ok):
            return result
        text = resp.text

        # ── 规模：Data_assetAllocation → 净资产 series 最新值 ──────────────────
        m = re.search(r'Data_assetAllocation\s*=\s*(\{.*?\});', text, re.DOTALL)
        if m:
            try:
                aa = json.loads(m.group(1))
                for s in aa.get("series", []):
                    if s.get("name") == "净资产" and s.get("data"):
                        last = [v for v in s["data"] if v is not None]
                        if last:
                            result["scale"] = round(last[-1], 2)
            except Exception:
                pass

        # ── Data_netWorthTrend：最新净值 ──────────────────────────────────────
        m = re.search(r'Data_netWorthTrend\s*=\s*(\[.*?\]);', text, re.DOTALL)
        if m:
            try:
                trend = json.loads(m.group(1))
                if trend:
                    last_nav = next((p["y"] for p in reversed(trend) if p.get("y")), None)
                    if last_nav and last_nav > 0:
                        result["nav_latest"] = round(float(last_nav), 4)
            except Exception:
                pass

        # ── Data_ACWorthTrend：2025全年收益率（累计净值，天然处理份额折算/分红）──
        m_ac = re.search(r'Data_ACWorthTrend\s*=\s*(\[.*?\]);', text, re.DOTALL)
        if m_ac:
            try:
                ac_trend = json.loads(m_ac.group(1))   # [[ts, val], ...]
                if ac_trend:
                    START_2025 = 1735689600000   # 2025-01-01 UTC
                    END_2025   = 1767225600000   # 2025-12-31 UTC
                    start_nav = next((p[1] for p in ac_trend if p[0] >= START_2025), None)
                    end_nav   = next((p[1] for p in reversed(ac_trend) if p[0] <= END_2025), None)
                    if start_nav and end_nav and start_nav > 0:
                        result["ytd_return"] = round((end_nav - start_nav) / start_nav * 100, 2)
            except Exception:
                pass

    except Exception as e:
        logger.warning(f"[meta] {code}: {e}")

    _cache_set(cache_key, result, 12 * 3600)
    return result


# ─── 估值计算核心 ──────────────────────────────────────────────────────────────

_QDII_NON_US_SUFFIX = (".HK", ".SS", ".SZ")          # 仅 Sina 支持的市场
_QDII_YF_INTL_SUFFIX = (".TW", ".KS", ".T", ".L", ".PA", ".DE")  # Yahoo 支持的非美市场


def _fetch_chg_from_nasdaq(symbols: List[str], timeout: int = 15) -> Dict[str, float]:
    """并发调用 Nasdaq API，返回 {symbol: pct}，只含有效值。
    并发数限制为 6，避免触发 Nasdaq 限速。
    """
    if not symbols:
        return {}
    results: Dict[str, float] = {}
    # 分批，每批 4 个，批次间加 0.5s 延迟，避免高并发被封
    batch_size = 4
    for i in range(0, len(symbols), batch_size):
        if i > 0:
            time.sleep(_random.uniform(0.4, 0.9))
        batch = symbols[i:i + batch_size]
        with ThreadPoolExecutor(max_workers=batch_size) as ex:
            futs = {ex.submit(_nasdaq_fetch, sym): sym for sym in batch}
            done, not_done = wait(list(futs), timeout=timeout)
            for fut in not_done:
                fut.cancel()
            for fut in done:
                sym = futs[fut]
                try:
                    r = fut.result()
                    pct = r.get("pct")
                    if pct is not None:
                        results[sym] = pct
                except Exception as e:
                    logger.warning(f"[chg_fetch] {sym}: {e}")
    return results


def _sym_to_yf(sym: str) -> str:
    """将内部 symbol 转为 Yahoo Finance ticker，目前处理 JP 后缀的日本股票。"""
    if sym.endswith("JP") and not sym.endswith(".JP"):
        return sym[:-2] + ".T"
    return sym


def _yf_pct_simple(symbol: str, prefer_post: bool = False, prefer_regular: bool = False) -> Optional[float]:
    """
    Yahoo Finance v8 chart 接口（无需 crumb）获取当前涨跌幅。
    prefer_post=True：只取盘后价（供 post_market/a_share 夜盘用）。
    prefer_regular=True：只取正规收盘涨跌幅（供 us_open 盘中用，避免 pre 数据干扰）。
    默认：盘前 > 盘后 > 盘中。
    """
    yf_sym = _sym_to_yf(symbol)
    try:
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{yf_sym}"
        r = requests.get(url, params={"interval": "1d", "range": "2d"},
                         headers={"User-Agent": "Mozilla/5.0"}, timeout=8)
        data = r.json()
        meta = data["chart"]["result"][0]["meta"]
        reg   = meta.get("regularMarketPrice")
        prev  = meta.get("chartPreviousClose") or meta.get("previousClose")
        pre   = meta.get("preMarketPrice")
        post  = meta.get("postMarketPrice")
        if prefer_post:
            if post and reg:
                return round((post - reg) / reg * 100, 2)
            return None
        if prefer_regular:
            # 直接用 Yahoo 的 regularMarketChangePercent，或手算 (reg - prev) / prev
            chg_pct = meta.get("regularMarketChangePercent")
            if chg_pct is not None:
                return round(chg_pct, 2)
            if reg and prev:
                return round((reg - prev) / prev * 100, 2)
            return None
        # 默认：盘前 > 盘后 > 盘中
        if pre and reg:
            return round((pre - reg) / reg * 100, 2)
        if post and reg:
            return round((post - reg) / reg * 100, 2)
        if reg and prev:
            return round((reg - prev) / prev * 100, 2)
    except Exception as e:
        logger.debug(f"[yf_simple] {symbol}({yf_sym}): {e}")
    return None


def _fetch_chg_from_yf_simple(symbols: List[str], timeout: int = 15,
                               prefer_post: bool = False, prefer_regular: bool = False) -> Dict[str, float]:
    """并发调用 _yf_pct_simple（最多16线程，无人工延迟）。"""
    if not symbols:
        return {}
    results: Dict[str, float] = {}
    with ThreadPoolExecutor(max_workers=min(16, len(symbols))) as ex:
        futs = {ex.submit(_yf_pct_simple, sym, prefer_post, prefer_regular): sym for sym in symbols}
        done, not_done = wait(list(futs), timeout=timeout)
        for fut in not_done:
            fut.cancel()
        for fut in done:
            sym = futs[fut]
            try:
                pct = fut.result()
                if pct is not None:
                    results[sym] = pct
            except Exception as e:
                logger.warning(f"[yf_simple_fetch] {sym}: {e}")
    return results


def _build_stock_cache(all_symbols: List[str]) -> Dict[str, dict]:
    """
    从 Redis 批量读取 qdii:close / qdii:post / qdii:live，构建 stock_cache。
      qdii:close:{sym}  上一个完整交易日正规收盘涨跌幅（72h TTL，cron/snap 写入）
      qdii:post:{sym}   上一个交易日夜盘涨跌幅（72h TTL，cron/snap 写入）
      qdii:live:{sym}   当前盘中实时涨跌幅（7min TTL，cron/live 每5分钟写入）
    """
    if not all_symbols:
        return {}
    bulk = _cache_mget(
        [f"qdii:close:{s}" for s in all_symbols] +
        [f"qdii:post:{s}"  for s in all_symbols] +
        [f"qdii:live:{s}"  for s in all_symbols]
    )
    return {
        sym: {
            "close_pct": bulk.get(f"qdii:close:{sym}"),
            "post_pct":  bulk.get(f"qdii:post:{sym}"),
            "live_pct":  bulk.get(f"qdii:live:{sym}"),
        }
        for sym in all_symbols
    }


def calc_valuation_for_fund(code: str, stock_cache: dict, fx_change: float,
                             field: str = "close_pct",
                             prefetched_holdings: Optional[list] = None) -> dict:
    """
    计算单只基金估值。
    stock_cache: {symbol -> {close_pct, post_pct, live_pct}}
    field: 用于计算的字段名（"close_pct" / "post_pct" / "live_pct"）
    """
    raw_holdings = prefetched_holdings if prefetched_holdings is not None else fetch_qdii_holdings(code)
    if not raw_holdings:
        return {"code": code, "valuation": None, "holdings": [], "coverage": 0,
                "fx_change": fx_change}

    # 去重：同一 symbol 保留权重最大的那条
    dedup: dict[str, dict] = {}
    for h in raw_holdings:
        sym = h["symbol"]
        if sym not in dedup or h["weight"] > dedup[sym]["weight"]:
            dedup[sym] = h
    holdings = list(dedup.values())

    # 归一化：若总权重超过110%（多期/多分类叠加），等比缩放到100%
    total_weight = sum(h["weight"] for h in holdings)
    if total_weight > 110.0:
        scale = 100.0 / total_weight
        holdings = [{**h, "weight": round(h["weight"] * scale, 4)} for h in holdings]

    weighted_sum   = 0.0
    covered_weight = 0.0
    enriched = []
    for h in holdings:
        sym = h["symbol"]
        chg = (stock_cache.get(sym) or {}).get(field)
        enriched.append({**h, "change": chg})
        if chg is not None:
            weighted_sum   += h["weight"] / 100.0 * chg
            covered_weight += h["weight"]

    coverage  = round(covered_weight, 1)
    valuation = round(weighted_sum, 2) if covered_weight > 0 else None

    return {
        "code":      code,
        "valuation": valuation,
        "holdings":  enriched,
        "coverage":  coverage,
        "fx_change": fx_change,
    }


# ─── API 端点 ──────────────────────────────────────────────────────────────────

@app.get("/api/qdii/holdings/{code}")
def api_qdii_holdings(code: str, response: Response, force: bool = False):
    """返回单只基金季报前十大持仓（含持仓权重和报告期）"""
    response.headers["Cache-Control"] = "public, max-age=3600"
    master_code = _C_TO_A_HOLDINGS_MAP.get(code, code)
    if force:
        _cache_delete(f"qdii_h_{master_code}")
        _cache_delete(f"qdii_hmeta_{master_code}")
        logger.info(f"[qdii_holdings] force cleared cache for {master_code}")
    holdings = fetch_qdii_holdings(code)
    meta = _cache_get(f"qdii_hmeta_{master_code}") or {}
    if not holdings:
        return {"code": code, "holdings": [], "error": "fetch_failed"}
    return {
        "code":        code,
        "holdings":    holdings,
        "report_date": meta.get("report_date", ""),
        "source":      meta.get("source", ""),
    }


# SESSION DISPLAY SPEC（最后更新：2026-06-17）
# Redis 键：qdii:close / qdii:post / qdii:live（cron/snap + cron/live 写入）
# 时段        │ close_valuation（收盘）    │ live_valuation（实时）
# pre_market  │ qdii:close（昨日收盘）     │ qdii:live（盘前，每5min）
# us_open     │ qdii:close（昨日收盘）     │ qdii:live（盘中，每5min）
# post_market │ qdii:close（今日收盘）     │ qdii:live（夜盘，每5min）
# a_share     │ qdii:close（昨日收盘）     │ qdii:post（昨日夜盘，snap写入）
# weekend     │ qdii:close（周五收盘）     │ 不显示
@app.get("/api/qdii/valuations")
def api_qdii_valuations(response: Response):
    """批量返回所有主动 QDII 基金的估值结果。不缓存计算结果，每次直接从 Redis 读股价计算。"""
    from datetime import timezone, timedelta
    session = _current_session()

    fx_data   = fetch_fx_data()
    fx_change = fx_data["change"]
    fx_price  = fx_data["price"]

    # ── Step 1: 并发拉取 gszzl(含nav) + 持仓 + meta ─────────────────────────────
    gszzl_cache:  dict[str, dict] = {}
    all_holdings: dict[str, list] = {}
    meta_cache:   dict[str, dict] = {}

    _pre = _cache_mget(
        [f"qdii_gszzl_{c}"                              for c in QDII_CODES] +
        [f"qdii_h_{c}"                                  for c in QDII_CODES] +
        [f"qdii_meta_{c}"                               for c in QDII_CODES] +
        [f"qdii_hmeta_{_C_TO_A_HOLDINGS_MAP.get(c,c)}" for c in QDII_CODES]
    )
    _pre_gszzl = {c: _pre.get(f"qdii_gszzl_{c}") for c in QDII_CODES}
    _pre_h     = {c: _pre.get(f"qdii_h_{c}")     for c in QDII_CODES}
    _pre_meta  = {c: _pre.get(f"qdii_meta_{c}")  for c in QDII_CODES}

    with ThreadPoolExecutor(max_workers=20) as ex:
        gf = {ex.submit(fetch_fund_gszzl,   code, _pre_gszzl.get(code)): ("gszzl", code) for code in QDII_CODES}
        hf = {ex.submit(fetch_qdii_holdings, code, _pre_h.get(code)):     ("h",     code) for code in QDII_CODES}
        mf = {ex.submit(fetch_fund_meta,     code, _pre_meta.get(code)):  ("meta",  code) for code in QDII_CODES}
        for bucket in (gf, hf, mf):
            for fut, (kind, code) in bucket.items():
                try:
                    val = fut.result()
                except Exception:
                    val = {"gszzl": None, "gsz": None, "gztime": None, "is_fresh": False,
                           "nav": None, "nav_date": None} \
                          if kind == "gszzl" else [] if kind == "h" else {}
                if   kind == "gszzl": gszzl_cache[code] = val
                elif kind == "h":     all_holdings[code] = val
                else:                 meta_cache[code]   = val

    # ── Step 2: 从 Redis 读 close/post/live 三类股价，无需实时拉取 ────────────
    _TOP_N = 10
    all_symbols = list({
        h["symbol"]
        for holdings in all_holdings.values()
        for h in sorted(holdings, key=lambda x: x.get("weight", 0), reverse=True)[:_TOP_N]
        if h.get("symbol")
    })
    logger.info(f"[qdii] session={session} symbols={len(all_symbols)}")
    stock_cache = _build_stock_cache(all_symbols)

    # ── Step 3: 逐基金估值 ───────────────────────────────────────────────────
    HKT = timezone(timedelta(hours=8))
    now_hkt = datetime.now(HKT)
    days_since_friday = (now_hkt.weekday() - 4) % 7
    last_friday = (now_hkt - timedelta(days=days_since_friday)).strftime("%Y-%m-%d")

    def _last_us_trade_date():
        d = now_hkt.date()
        if session != "post_market":
            d -= timedelta(days=1)
        while d.weekday() >= 5:
            d -= timedelta(days=1)
        return d
    trade_day = _last_us_trade_date()
    trade_date = trade_day.strftime("%m/%d")
    close_hkt_day = trade_day + timedelta(days=1)
    close_hkt_label = f"{close_hkt_day.month}月{close_hkt_day.day}日 04:00"

    # live 字段：pre/us_open/post_market 用 live_pct；a_share 用 post_pct；weekend 无实时
    live_field = "post_pct" if session == "a_share" else ("live_pct" if session != "weekend" else None)

    results = []
    for code in QDII_CODES:
        g       = gszzl_cache.get(code, {})
        meta    = meta_cache.get(code, {})
        holdings = all_holdings.get(code, [])

        # 收盘估值（始终用 close_pct）
        r_close = calc_valuation_for_fund(code, stock_cache, fx_change, "close_pct", holdings)
        close_val = r_close["valuation"]
        # a_share 时段 gszzl 兜底
        if session == "a_share" and close_val is None and g.get("gszzl") is not None:
            close_val = g["gszzl"]

        # 实时估值
        if live_field:
            r_live = calc_valuation_for_fund(code, stock_cache, fx_change, live_field, holdings)
            live_val      = r_live["valuation"]
            live_coverage = r_live["coverage"]
            # 合并每条持仓：close_change = close_pct，change = live_pct/post_pct
            close_chg_map = {h["symbol"]: h.get("change") for h in r_close["holdings"]}
            for h in r_live["holdings"]:
                h["close_change"] = close_chg_map.get(h["symbol"])
            main_holdings = r_live["holdings"]
        else:
            live_val      = None
            live_coverage = 0
            # weekend：只展示 close_change，无 live
            for h in r_close["holdings"]:
                h["close_change"] = h.pop("change", None)
            main_holdings = r_close["holdings"]

        r = {
            "code":           code,
            "close_valuation": close_val,
            "live_valuation":  live_val,
            "coverage":        r_close["coverage"],
            "live_coverage":   live_coverage,
            "fx_change":       fx_change,
            "holdings":        main_holdings,
            "gszzl_time":      g.get("gztime"),
            "nav":             g.get("nav") or meta.get("nav_latest"),
            "nav_date":        g.get("nav_date"),
            "nav_published":   bool(session == "weekend" and g.get("nav_date") and g.get("nav_date") >= last_friday),
            "scale":           meta.get("scale"),
            "ytd_return":      meta.get("ytd_return"),
            "trade_date":      trade_date,
            "close_hkt_label": close_hkt_label,
        }
        master = _C_TO_A_HOLDINGS_MAP.get(code, code)
        hmeta  = _pre.get(f"qdii_hmeta_{master}") or {}
        r["holdings_date"]   = hmeta.get("report_date", "")
        r["holdings_source"] = hmeta.get("source", "")
        results.append(r)

    today      = datetime.utcnow().strftime("%Y-%m-%d")
    updated_at = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

    # ── Step 4: 持久化到 SQLite ────────────────────────────────────────────────
    try:
        _db_save_stock_prices(stock_cache, today)
        for r in results:
            if r.get("holdings"):
                _db_save_holdings(r["code"], r["holdings"], report_date=r.get("holdings_date", ""))
        _db_save_valuations(results, today)
        logger.info(f"[qdii] saved {len(results)} funds, {len(stock_cache)} stocks")
    except Exception as e:
        logger.warning(f"[qdii] DB save failed: {e}")

    payload = {
        "fx_change":  fx_change,
        "fx_price":   fx_price,
        "updated_at": updated_at,
        "session":    session,
        "funds":      results,
    }
    response.headers["Cache-Control"] = "no-store"
    return payload
