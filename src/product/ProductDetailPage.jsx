import { useEffect, useMemo, useState } from "react";
import { Analytics } from "@vercel/analytics/react";
import catalog from "../../catalog/products.v1.json";
import {
  buildProductDescription,
  categoryLabel,
  extractProductRows,
  findProductRow,
  mergeProductData,
  productApiPath,
  productRoute,
  subscriptionState,
} from "./product-detail-model.js";
import "./product-detail.css";

const SITE_ORIGIN = "https://wise-etf.com";
const SHARE_IMAGE = `${SITE_ORIGIN}/@Wise%20%E6%8A%95%E8%B5%84%E6%9C%89%E6%9C%AF%20(2).png`;

const hasNumber = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));

const number = (value, digits = 2) => {
  if (!hasNumber(value)) return "—";
  const parsed = Number(value);
  return parsed.toFixed(digits);
};

const signedPercent = (value) => {
  if (!hasNumber(value)) return "—";
  const parsed = Number(value);
  return `${parsed > 0 ? "+" : ""}${parsed.toFixed(2)}%`;
};

const metricTone = (value) => {
  if (!hasNumber(value)) return "neutral";
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed === 0) return "neutral";
  return parsed > 0 ? "up" : "down";
};

function upsertMeta(selector, attributes) {
  let node = document.head.querySelector(selector);
  if (!node) {
    node = document.createElement("meta");
    document.head.appendChild(node);
  }
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
}

function useProductMetadata(product, row) {
  useEffect(() => {
    if (!product) return undefined;
    const title = `${product.name}（${product.code}）${product.product_type === "etf" ? "行情与溢价信息" : "数据与申购信息"} · WiseETF`;
    const description = buildProductDescription(product, row);
    const url = `${SITE_ORIGIN}${productRoute(product)}`;
    document.title = title;
    upsertMeta('meta[name="description"]', { name: "description", content: description });
    upsertMeta('meta[property="og:title"]', { property: "og:title", content: title });
    upsertMeta('meta[property="og:description"]', { property: "og:description", content: description });
    upsertMeta('meta[property="og:type"]', { property: "og:type", content: "website" });
    upsertMeta('meta[property="og:url"]', { property: "og:url", content: url });
    upsertMeta('meta[property="og:image"]', { property: "og:image", content: SHARE_IMAGE });
    upsertMeta('meta[name="twitter:card"]', { name: "twitter:card", content: "summary_large_image" });
    upsertMeta('meta[name="twitter:title"]', { name: "twitter:title", content: title });
    upsertMeta('meta[name="twitter:description"]', { name: "twitter:description", content: description });
    let canonical = document.head.querySelector('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.appendChild(canonical);
    }
    canonical.href = url;

    let structured = document.head.querySelector(`script[data-wise-product="${product.code}"]`);
    const created = !structured;
    if (!structured) {
      structured = document.createElement("script");
      structured.type = "application/ld+json";
      structured.dataset.wiseProduct = product.code;
      document.head.appendChild(structured);
    }
    structured.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: title,
      description,
      url,
      isPartOf: { "@type": "WebSite", name: "WiseETF", url: SITE_ORIGIN },
      breadcrumb: {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "WiseETF", item: SITE_ORIGIN },
          { "@type": "ListItem", position: 2, name: categoryLabel(product) },
          { "@type": "ListItem", position: 3, name: product.name, item: url },
        ],
      },
    });
    return () => { if (created) structured.remove(); };
  }, [product, row]);
}

function Metric({ label, value, note, tone = "neutral" }) {
  return (
    <div className="pd-metric">
      <span>{label}</span>
      <strong className={`pd-tone-${tone}`}>{value}</strong>
      {note && <small>{note}</small>}
    </div>
  );
}

function subscriptionModel(row) {
  const status = subscriptionState(row);
  if (status === "suspended") return { label: "暂停申购", tone: "down", note: "当前不接受申购" };
  if (status === "limited" || row?.daily_limit) return { label: "限额申购", tone: "warn", note: "额度可能随基金公告调整" };
  if (status === "open") return { label: "开放申购", tone: "up", note: "实际额度以销售渠道为准" };
  return { label: "待确认", tone: "neutral", note: "本次未获取到有效申购状态" };
}

export default function ProductDetailPage({ type, code }) {
  const product = useMemo(
    () => catalog.products.find((item) => item.code === code && item.product_type === type),
    [code, type],
  );
  const [liveRow, setLiveRow] = useState(null);
  const [liveRows, setLiveRows] = useState([]);
  const [dataset, setDataset] = useState({ status: "loading", source: null, asOf: null, error: null });
  const [favorite, setFavorite] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("etf-favorites") || "[]");
      return Array.isArray(saved) && saved.includes(code);
    } catch {
      return false;
    }
  });
  const [shareState, setShareState] = useState("idle");
  const row = useMemo(() => mergeProductData(product, liveRow), [product, liveRow]);
  const related = useMemo(
    () => (product?.related_share_codes || []).map((relatedCode) => catalog.products.find((item) => item.code === relatedCode)).filter(Boolean),
    [product],
  );
  const isEtf = product?.product_type === "etf";
  const alternatives = useMemo(() => {
    if (!product) return [];
    const liveMap = new Map(liveRows.map((item) => [item.code, item]));
    const category = product.categories.find((item) => item !== "funds");
    const candidates = catalog.products.filter((item) => {
      if (item.code === product.code || item.product_type !== product.product_type) return false;
      if (isEtf) return item.tracking_index === product.tracking_index;
      if (product.tracking_index) return item.tracking_index === product.tracking_index;
      return item.categories.includes(category);
    }).map((item) => mergeProductData(item, liveMap.get(item.code)));
    return candidates.sort((a, b) => {
      if (isEtf) {
        const aPremium = hasNumber(a.premium) ? Math.abs(Number(a.premium)) : Infinity;
        const bPremium = hasNumber(b.premium) ? Math.abs(Number(b.premium)) : Infinity;
        return aPremium - bPremium || Number(a.fee_rate || Infinity) - Number(b.fee_rate || Infinity);
      }
      const order = { open: 0, limited: 1, unknown: 2, suspended: 3 };
      return order[subscriptionState(a)] - order[subscriptionState(b)] || Number(a.fee_rate || Infinity) - Number(b.fee_rate || Infinity);
    }).slice(0, 4);
  }, [isEtf, liveRows, product]);
  useProductMetadata(product, row);

  useEffect(() => {
    if (!product) return undefined;
    const controller = new AbortController();
    let timedOut = false;
    const timer = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 15000);
    const path = productApiPath(product);
    fetch(path, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((payload) => {
        const found = findProductRow(payload, product.code);
        if (!found) throw new Error("产品不在当前数据快照中");
        setLiveRows(extractProductRows(payload));
        setLiveRow(found);
        setDataset({
          status: payload.status || found.data_status || "available",
          source: payload.source || found.source || null,
          asOf: payload.as_of || found.as_of || found.nav_date || found.quote_as_of || null,
          error: null,
        });
      })
      .catch((error) => {
        if (error.name !== "AbortError") setDataset({ status: "reference", source: "catalog", asOf: product.metadata_as_of, error: error.message });
        else if (timedOut) setDataset({ status: "reference", source: "catalog", asOf: product.metadata_as_of, error: "请求超时" });
      })
      .finally(() => window.clearTimeout(timer));
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [product]);

  if (!product) {
    return (
      <main className="pd-not-found">
        <div><span>404</span><h1>没有找到这个产品</h1><p>请检查基金或 ETF 代码是否正确。</p><a href="/">返回 WiseETF</a></div>
      </main>
    );
  }

  const subscription = subscriptionModel(row);
  const decision = isEtf
    ? !hasNumber(row.premium)
      ? { tone: "neutral", title: "溢价暂不可用", text: "先核对场内价格与基金净值日期，再决定是否交易。" }
      : Number(row.premium) >= 3
        ? { tone: "down", title: "当前属于高溢价区间", text: "追价可能同时承担指数波动和溢价回落风险，建议先比较同指数产品。" }
        : Number(row.premium) >= 1.5
          ? { tone: "warn", title: "当前溢价需要留意", text: "购买前应比较其他场内ETF、场外额度以及两侧数据日期。" }
          : { tone: "up", title: "当前未进入高溢价区间", text: "仍需核对实时价格、净值日期、成交量和交易费用。" }
    : subscriptionState(row) === "suspended"
      ? { tone: "down", title: "当前显示暂停申购", text: "可以比较同类可申购基金、场内ETF或链上代币化现货。" }
      : subscriptionState(row) === "limited"
        ? { tone: "warn", title: `当前限额${row.daily_limit ? `：${row.daily_limit}` : ""}`, text: "额度不足时不必反复尝试，可以直接比较同类产品和其他购买路径。" }
        : subscriptionState(row) === "open"
          ? { tone: "up", title: "当前显示开放申购", text: "下单前仍需核对具体销售渠道的单笔与单日累计规则。" }
          : { tone: "neutral", title: "今日申购状态待确认", text: "接口未返回有效状态时，WiseETF不会把旧额度冒充当前额度。" };
  const canonicalUrl = `${SITE_ORIGIN}${productRoute(product)}`;
  const toggleFavorite = () => {
    let saved = [];
    try { saved = JSON.parse(localStorage.getItem("etf-favorites") || "[]"); } catch { saved = []; }
    const next = favorite ? saved.filter((item) => item !== product.code) : [...new Set([...saved, product.code])];
    localStorage.setItem("etf-favorites", JSON.stringify(next));
    setFavorite(!favorite);
  };
  const share = async () => {
    const shareData = { title: `${product.name} · WiseETF`, text: buildProductDescription(product, row), url: canonicalUrl };
    try {
      if (navigator.share) await navigator.share(shareData);
      else await navigator.clipboard.writeText(canonicalUrl);
      setShareState("done");
      window.setTimeout(() => setShareState("idle"), 1800);
    } catch (error) {
      if (error?.name !== "AbortError") setShareState("error");
    }
  };
  const categoryPath = isEtf ? "/etf" : product.categories.includes("nasdaq_passive") ? "/nasdaq" : product.categories.includes("sp500_passive") ? "/sp500" : "/active";

  return (
    <div className="pd-page">
      <header className="pd-nav">
        <a className="pd-brand" href="/" aria-label="返回 WiseETF 首页"><b>W</b><span>Wise <em>ETF</em></span></a>
        <nav><a href={isEtf ? "/today/etf-premium" : "/today/qdii-limits"}>{isEtf ? "今日溢价" : "今日额度"}</a><a href={categoryPath}>返回{categoryLabel(product)}</a><a href="/">全部数据</a></nav>
      </header>
      <main className="pd-main">
        <section className="pd-hero">
          <div className="pd-hero-copy">
            <div className="pd-eyebrow"><span>{categoryLabel(product)}</span><i>{isEtf ? "场内" : `场外 · ${product.share_class || "基金"}类`}</i></div>
            <p className="pd-code">{product.code}</p>
            <h1>{product.name}</h1>
            <p className="pd-summary">{buildProductDescription(product, row)}</p>
            <div className="pd-actions">
              <button className={favorite ? "active" : ""} onClick={toggleFavorite}>{favorite ? "★ 已收藏" : "☆ 加入自选"}</button>
              <button onClick={share}>{shareState === "done" ? "✓ 链接已复制" : shareState === "error" ? "复制失败" : "↗ 分享产品"}</button>
            </div>
          </div>
          <div className="pd-primary-card">
            <span>{isEtf ? "最新溢价率" : "近一年滚动"}</span>
            <strong className={`pd-tone-${metricTone(isEtf ? row.premium : row.rolling_1y)}`}>
              {signedPercent(isEtf ? row.premium : row.rolling_1y)}
            </strong>
            <small>{isEtf ? "收盘价相对最新已公布净值" : `截至 ${row.rolling_1y_as_of || row.nav_date || dataset.asOf || "最新净值日"}`}</small>
          </div>
        </section>

        <section className="pd-status" data-status={dataset.status}>
          <span className="pd-status-dot" />
          <div><b>{dataset.status === "loading" ? "正在读取每日快照" : dataset.status === "fresh" || dataset.status === "available" ? "每日数据已载入" : dataset.status === "partial" ? "部分数据暂缺" : "正在使用参考资料"}</b>
          <small>{dataset.asOf ? `数据截至 ${dataset.asOf}` : "等待有效数据日期"}{dataset.source ? ` · 来源 ${dataset.source}` : ""}{dataset.error ? ` · ${dataset.error}` : ""}</small></div>
        </section>

        <section className={`pd-decision pd-decision-${decision.tone}`}>
          <div><span>当前判断</span><h2>{decision.title}</h2><p>{decision.text}</p></div>
          <a href={isEtf ? "/today/etf-premium" : "/today/qdii-limits"}>查看完整{isEtf ? "溢价榜" : "额度清单"} →</a>
        </section>

        <section className="pd-grid">
          <div className="pd-panel pd-overview">
            <div className="pd-section-title"><span>核心数据</span><small>动态字段按页面标注日期展示</small></div>
            <div className="pd-metrics">
              <Metric label="2025 全年" value={signedPercent(row.annual_return_2025)} tone={metricTone(row.annual_return_2025)} note={row.annual_return_2025_as_of ? `截至 ${row.annual_return_2025_as_of}` : "自然年度累计净值口径"} />
              <Metric label="近一年滚动" value={signedPercent(row.rolling_1y)} tone={metricTone(row.rolling_1y)} note={row.rolling_1y_as_of || row.nav_date || "等待最新净值"} />
              <Metric label={isEtf ? "场内涨跌" : "昨日涨跌"} value={signedPercent(isEtf ? row.market_change_pct ?? row.change_pct : row.day_change)} tone={metricTone(isEtf ? row.market_change_pct ?? row.change_pct : row.day_change)} note={isEtf ? row.quote_as_of || "最新交易日" : row.day_change_as_of || row.nav_date || "最新净值日"} />
              <Metric label="基金规模" value={hasNumber(row.scale) ? `${number(row.scale)} 亿元` : "—"} note={row.scale_as_of ? `报告期 ${row.scale_as_of}` : "低频更新"} />
              <Metric label="运作费率" value={hasNumber(row.fee_rate) ? `${number(row.fee_rate)}%` : "—"} note="管理费与托管费等，以公告为准" />
              <Metric label="跟踪误差" value={hasNumber(row.track_error) && Number(row.track_error) > 0 ? `${number(row.track_error)}%` : "—"} note={row.track_error_as_of ? `披露截至 ${row.track_error_as_of}` : "主动产品通常不适用"} />
            </div>
          </div>

          <aside className="pd-panel pd-route-card">
            <div className="pd-section-title"><span>{isEtf ? "交易信息" : "申购信息"}</span></div>
            {isEtf ? (
              <>
                <Metric label="场内价格" value={hasNumber(row.market_price) ? number(row.market_price, 4) : "—"} note={row.quote_as_of || "等待收盘快照"} />
                <Metric label="最新净值" value={hasNumber(row.nav) ? number(row.nav, 4) : "—"} note={row.nav_as_of || row.nav_date || "等待基金净值"} />
                <Metric label="当日成交" value={hasNumber(row.turnover_cny_100m ?? row.volume) ? `${number(row.turnover_cny_100m ?? row.volume)} 亿元` : "—"} note="最新 A 股交易日" />
              </>
            ) : (
              <>
                <Metric label="申购状态" value={subscription.label} tone={subscription.tone} note={subscription.note} />
                <Metric label="每日限额" value={row.daily_limit || "待确认"} note={row.subscription_as_of ? `检查于 ${row.subscription_as_of}` : "仅在有效接口返回后展示"} />
                <Metric label="最新净值" value={hasNumber(row.nav) ? number(row.nav, 4) : "—"} note={row.nav_date || "等待最新净值"} />
              </>
            )}
          </aside>
        </section>

        <section className="pd-panel pd-context">
          <div className="pd-section-title"><span>理解这个产品</span></div>
          <div className="pd-context-grid">
            <div><small>产品类型</small><b>{categoryLabel(product)}{product.share_class && product.share_class !== "unspecified" ? ` · ${product.share_class}类` : ""}</b></div>
            <div><small>跟踪指数</small><b>{row.tracking_index || (isEtf ? "以基金公告为准" : "主动管理策略")}</b></div>
            <div><small>静态资料日期</small><b>{row.metadata_as_of || "未提供"}</b></div>
          </div>
          {related.length > 0 && <div className="pd-related"><span>同基金其他份额</span>{related.map((item) => <a key={item.code} href={productRoute(item)}>{item.share_class}类 · {item.code}</a>)}</div>}
        </section>

        {alternatives.length > 0 && <section className="pd-panel pd-alternatives">
          <div className="pd-section-title"><span>{isEtf ? "同指数 ETF 对比" : "同类产品选择"}</span><small>优先展示状态更明确、溢价更低或费率更低的产品</small></div>
          <div className="pd-alt-grid">{alternatives.map((item) => {
            const itemStatus = subscriptionModel(item);
            return <a href={productRoute(item)} key={item.code}>
              <span>{item.code}</span><h3>{item.name}</h3>
              <div><b>{isEtf ? hasNumber(item.premium) ? signedPercent(item.premium) : "溢价待确认" : itemStatus.label}</b><small>{isEtf ? `费率 ${hasNumber(item.fee_rate) ? `${number(item.fee_rate)}%` : "—"}` : item.daily_limit || `费率 ${hasNumber(item.fee_rate) ? `${number(item.fee_rate)}%` : "—"}`}</small></div>
            </a>;
          })}</div>
        </section>}

        <footer className="pd-footer">
          <p>数据仅用于信息展示，不构成投资建议。申购额度、净值、场内价格和溢价率可能处于不同披露时点，交易前请以基金公告及销售渠道为准。</p>
          <div className="pd-footer-links"><a href={isEtf ? "/today/etf-premium" : "/today/qdii-limits"}>查看今日清单</a><a href="/onchain">了解链上购买路径</a><a href="/">更多 WiseETF 数据</a></div>
        </footer>
      </main>
      <Analytics />
    </div>
  );
}
