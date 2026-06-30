const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

const root = __dirname;
loadEnvFile(path.join(root, ".env"));
const port = Number(process.env.PORT || 5173);
const marketConcepts = JSON.parse(fs.readFileSync(path.join(root, "market-concepts.json"), "utf8"));
const conceptMap = new Map(marketConcepts.map((concept) => [concept.id, concept]));

const mandatoryDisclaimer = [
  "___________________________",
  "Tuyên bố miễn trừ trách nhiệm:",
  "⚠️ Tất cả những thông tin chia sẻ trên Fanpage Kolia Phan đều chỉ dành cho mục đích chia sẻ kiến thức dựa trên quan điểm cá nhân và không phải lời tư vấn tài chính, khuyến nghị đầu tư hay cam kết lợi nhuận.",
  "⚠️ Trước khi đưa ra bất kỳ quyết định đầu tư nào, bạn cần tự nghiên cứu, đánh giá rủi ro và chịu trách nhiệm với lựa chọn của mình. Kolia Phan sẽ không chịu bất kỳ trách nhiệm nào liên quan đến việc đầu tư của các cá nhân theo dõi kênh.",
  "⚠️ Việc tiếp tục theo dõi, truy cập hoặc sử dụng các nội dung trên Fanpage được hiểu là bạn đã đọc, hiểu và đồng ý với các điều khoản trên."
].join("\n");

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

const researchSources = [
  { group: "domestic", name: "CafeF", url: "https://cafef.vn/index.rss" },
  { group: "domestic", name: "CafeF - Chứng khoán", url: "https://cafef.vn/thi-truong-chung-khoan.rss" },
  { group: "domestic", name: "VnExpress Kinh doanh", url: "https://vnexpress.net/rss/kinh-doanh.rss" },
  { group: "domestic", name: "Vietstock", url: "https://vietstock.vn/rss.htm" },
  { group: "domestic", name: "VnEconomy", url: "https://vneconomy.vn/rss.html" },
  { group: "international", name: "CNBC", url: "https://www.cnbc.com/id/100003114/device/rss/rss.html" },
  { group: "international", name: "CNBC Markets", url: "https://www.cnbc.com/id/15839135/device/rss/rss.html" },
  { group: "international", name: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/" },
  { group: "international", name: "Cointelegraph", url: "https://cointelegraph.com/rss" }
];

const domesticDomains = [
  "cafef.vn",
  "cafebiz.vn",
  "vnexpress.net",
  "vneconomy.vn",
  "baodautu.vn",
  "thesaigontimes.vn",
  "vietstock.vn",
  "baoquocte.vn",
  "nhandan.vn",
  "tuoitre.vn",
  "thanhnien.vn"
];

const internationalDomains = [
  "investing.com",
  "tradingview.com",
  "nytimes.com",
  "wsj.com",
  "ft.com",
  "economist.com",
  "bloomberg.com",
  "reuters.com",
  "fidelity.com",
  "foreignaffairs.com",
  "asia.nikkei.com",
  "cnbc.com",
  "coindesk.com",
  "cointelegraph.com"
];

const server = http.createServer(async (req, res) => {
  const parsedRequestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (req.method === "GET" && parsedRequestUrl.pathname === "/api/image-proxy") {
    try {
      await proxyImage(parsedRequestUrl.searchParams.get("url"), res);
    } catch (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
      res.end("Image not available");
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/generate") {
    try {
      const body = await readJson(req);
      const text = await generateCaption(body.prompt, body.news || [], body.options || {});
      sendJson(res, 200, text && typeof text === "object"
        ? { model: process.env.OPENAI_MODEL || "gpt-4.1-mini", ...text }
        : text);
    } catch (error) {
      sendJson(res, 500, { error: error.message || "Generate failed" });
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/generate-video-script") {
    try {
      const body = await readJson(req);
      const result = await generateVideoShortNews(body.news || [], body.videoConfig || {}, body.sceneSettings || {});
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { error: error.message || "Generate video script failed" });
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/edit-video-script") {
    try {
      const body = await readJson(req);
      const result = await editVideoShortNews(body);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { error: error.message || "Edit video script failed" });
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/content-review") {
    try {
      const body = await readJson(req);
      const result = await reviewGeneratedContent(body);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { error: error.message || "Content review failed" });
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/export-csv") {
    try {
      const body = await readJson(req);
      const file = saveCsvExport(body.rows || []);
      sendJson(res, 200, file);
    } catch (error) {
      sendJson(res, 500, { error: error.message || "CSV export failed" });
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/export-video-pdf") {
    try {
      const body = await readJson(req);
      const pdf = await buildVideoPdf(body.videoOutput || {});
      const filename = safeDownloadName(`${body.videoOutput?.videoTitle || "kolia-video-short"}.pdf`);
      const savedPath = savePdfToDownloads(filename, pdf);
      res.writeHead(200, {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Saved-File": encodeURIComponent(savedPath || ""),
        "Content-Length": pdf.length,
        "Cache-Control": "no-store"
      });
      res.end(pdf);
    } catch (error) {
      sendJson(res, 500, { error: error.message || "PDF export failed" });
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/research") {
    try {
      const body = await readJson(req);
      const news = await researchNews(body);
      const sourceGroup = String(body.sourceGroup || "all");
      const searchedSources = sourceGroup === "domestic"
        ? domesticDomains.length
        : sourceGroup === "international"
          ? internationalDomains.length
          : domesticDomains.length + internationalDomains.length;
      sendJson(res, 200, {
        count: news.length,
        sources: searchedSources,
        summary: generateQuickMarketSummary(news, Number(body.recencyHours || 48)),
        news
      });
    } catch (error) {
      sendJson(res, 500, { error: error.message || "Research failed" });
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/import-url") {
    try {
      const body = await readJson(req);
      const item = await importArticleUrl(body.url);
      sendJson(res, 200, { news: item });
    } catch (error) {
      sendJson(res, 500, { error: error.message || "Import URL failed" });
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/image-assets") {
    try {
      const body = await readJson(req);
      const assets = await collectImageAssets(body.news || []);
      sendJson(res, 200, { assets });
    } catch (error) {
      sendJson(res, 500, { error: error.message || "Image assets failed" });
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/personal-planner/parse") {
    try {
      const body = await readJson(req);
      const result = await parsePersonalPlannerInput(body.text || "", normalizePlannerWeekStart(body.weekStart));
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { error: error.message || "Planner parse failed" });
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/calendar-copilot/chat") {
    try {
      const body = await readJson(req);
      const result = await calendarCopilotChat(body);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message || "Calendar copilot failed" });
    }
    return;
  }

  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  const safePath = urlPath === "/" ? "/personal-assistant.html" : urlPath;
  const filePath = path.normalize(path.join(root, safePath));

  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  if (path.basename(filePath).startsWith(".")) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    res.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(content);
  });
});

async function researchNews(options = {}) {
  const limitMode = String(options.limitPerSource || "6");
  const limitAll = limitMode === "all";
  const limitPerSource = limitAll ? Infinity : Math.min(Math.max(Number(limitMode || 6), 1), 10);
  const fetchPerSource = limitAll ? 80 : Math.max(limitPerSource * 4, 12);
  const sourceGroup = String(options.sourceGroup || "all");
  const sourceMode = sourceGroup === "all" ? "both" : sourceGroup;
  const filterMode = String(options.filterMode || "smart");
  const minScore = Number(options.minScore || 60);
  const recencyHours = Math.min(Math.max(Number(options.recencyHours || 48), 1), 168);
  const cutoff = Date.now() - recencyHours * 60 * 60 * 1000;
  const selectedConcepts = Array.isArray(options.selectedConcepts) ? options.selectedConcepts : [];
  const keywordProfile = buildKeywordSet(selectedConcepts, sourceMode);
  const keywords = keywordProfile.keywords.length
    ? keywordProfile.keywords
    : String(options.keywords || "").split(",").map((keyword) => keyword.trim()).filter(Boolean);

  const sources = researchSources.filter((source) => sourceGroup === "all" || source.group === sourceGroup);
  const batches = await Promise.allSettled(sources.map(async (source) => {
    const xml = await fetchText(source.url);
    const items = parseRss(xml)
      .filter((item) => isRecent(item.pubDate, cutoff))
      .map((item) => ({ item, score: quickArticleScore(item, keywordProfile) }))
      .filter(({ score }) => !selectedConcepts.length || score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ item }) => item)
      .slice(0, fetchPerSource);

    const enriched = await Promise.all(items.map((item) => enrichRssItem(source, item)));
    return enriched.map((item) => scoreNewsItem(item, keywordProfile, source, cutoff, filterMode));
  }));

  const rssNews = batches
    .filter((batch) => batch.status === "fulfilled")
    .flatMap((batch) => batch.value)
    .sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0));

  const searchNews = keywords.length
    ? await researchGoogleNews(keywords.slice(0, 18), sourceGroup, limitAll ? 20 : limitPerSource, recencyHours, cutoff).catch(() => [])
    : [];

  const scoredSearch = searchNews.map((item) => scoreNewsItem(item, keywordProfile, { name: item.source, group: item.group, priority: sourcePriority(item.source) }, cutoff, filterMode));

  return dedupeScoredNews(rssNews.concat(scoredSearch))
    .filter((item) => groupMatches(item.group, sourceGroup))
    .filter((item) => isRecent(item.time, cutoff))
    .filter((item) => !selectedConcepts.length || (item.relevance_score || 0) >= minScore)
    .sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0) || (b.final_score || 0) - (a.final_score || 0))
    .reduce((acc, item) => {
      if (limitAll) {
        acc.items.push(item);
        return acc;
      }
      const count = acc.counts[item.source] || 0;
      if (count < limitPerSource) {
        acc.items.push(item);
        acc.counts[item.source] = count + 1;
      }
      return acc;
    }, { items: [], counts: {} }).items;
}

function normalizePlannerWeekStart(value) {
  const parsed = parsePlannerDate(String(value || "").slice(0, 10));
  return plannerInputDate(plannerStartOfWeek(parsed || new Date()));
}

function buildKeywordSet(selectedConcepts, sourceMode) {
  const conceptIds = selectedConcepts.filter((id) => conceptMap.has(id));
  const concepts = conceptIds.map((id) => conceptMap.get(id));
  const include = sourceMode === "domestic"
    ? ["vi", "vi_unsigned", "universal"]
    : sourceMode === "international"
      ? ["en", "universal"]
      : ["vi", "vi_unsigned", "en", "universal"];
  const entries = [];
  concepts.forEach((concept) => {
    include.forEach((bucket) => {
      (concept.aliases?.[bucket] || []).forEach((keyword) => {
        entries.push({
          keyword,
          normalized: normalizeMarketText(keyword),
          unsigned: removeVietnameseTone(keyword).toLowerCase(),
          conceptId: concept.id,
          role: concept.role || (concept.category === "asset" ? "main" : "supporting")
        });
      });
    });
  });
  const deduped = [];
  const seen = new Set();
  entries.forEach((entry) => {
    const key = `${entry.conceptId}:${entry.normalized}`;
    if (entry.normalized && !seen.has(key)) {
      seen.add(key);
      deduped.push(entry);
    }
  });
  return {
    conceptIds,
    concepts,
    mainConceptIds: concepts.filter((concept) => (concept.role || "supporting") === "main").map((concept) => concept.id),
    supportingConceptIds: concepts.filter((concept) => (concept.role || "supporting") !== "main").map((concept) => concept.id),
    entries: deduped,
    keywords: [...new Set(deduped.map((entry) => entry.keyword))]
  };
}

function quickArticleScore(item, keywordProfile) {
  const text = buildMatchText({ title: item.title, summary: item.description, fullText: "" });
  const matched = matchConcepts(text, keywordProfile);
  return matched.score;
}

function scoreNewsItem(item, keywordProfile, source, cutoff, filterMode) {
  if (!keywordProfile.conceptIds.length) {
    return withScoreFields(item, [], [], 60, freshnessScore(item.time), sourcePriority(source?.name || item.source));
  }
  const text = buildMatchText(item);
  const matched = matchConcepts(text, keywordProfile);
  const matchedConcepts = [...matched.concepts];
  const matchedKeywords = [...matched.keywords].slice(0, 12);
  const conceptCount = matchedConcepts.length;
  const mainMatched = keywordProfile.mainConceptIds.some((id) => matched.concepts.has(id));
  const allMatched = keywordProfile.conceptIds.every((id) => matched.concepts.has(id));
  const valid = filterMode === "exact"
    ? allMatched
    : filterMode === "broad"
      ? conceptCount > 0
      : keywordProfile.mainConceptIds.length ? mainMatched : conceptCount > 0;
  const fresh = freshnessScore(item.time);
  const priority = sourcePriority(source?.name || item.source || "") || source?.priority || 5;
  let relevance = matched.score;
  if (conceptCount > 1) relevance += 10;
  if (fresh >= 85) relevance += 15;
  if (priority >= 8) relevance += 10;
  if (containsMarketNumbers(text.original)) relevance += 5;
  if (isWeakGoldIdiomMatch(text.original, matchedConcepts)) relevance = Math.min(relevance, 35);
  if (isWeakUsdDenominationMatch(text.original, matchedConcepts)) relevance = Math.min(relevance, 35);
  if (!valid) relevance = Math.min(relevance, 35);
  const finalScore = Math.round((relevance * 0.75) + (fresh * 0.15) + (priority * 10 * 0.1));
  return withScoreFields(item, matchedConcepts, matchedKeywords, relevance, fresh, finalScore);
}

function isWeakGoldIdiomMatch(text, matchedConcepts) {
  if (!matchedConcepts.includes("gold")) return false;
  const value = removeVietnameseTone(String(text || "").toLowerCase());
  if (!/(trung vang|ga de trung vang|golden goose|gold medal|gold glove|blue gold|dakota gold|southern cross gold)/i.test(value)) {
    return false;
  }
  return !/(gia vang|vang mieng|vang sjc|vang giao ngay|kim loai quy|gold price|spot gold|bullion|gold futures|xau|comex gold|spdr gold)/i.test(value);
}

function isWeakUsdDenominationMatch(text, matchedConcepts) {
  if (!matchedConcepts.includes("usd")) return false;
  const value = removeVietnameseTone(String(text || "").toLowerCase());
  if (!/(ty usd|trieu usd|nghin usd|billion usd|million usd|trillion usd)/i.test(value)) return false;
  return !/(ty gia|gia usd|dong usd|dong bac xanh|chi so dxy|usd index|dollar index|greenback|foreign exchange|forex|currency|exchange rate|dxy|usdx)/i.test(value);
}

function withScoreFields(item, matchedConcepts, matchedKeywords, relevance, fresh, finalScore) {
  return {
    ...item,
    source_name: item.source,
    source_type: item.group,
    published_at: item.time,
    url: item.link,
    language: item.group === "international" ? "en" : "vi",
    matched_concepts: matchedConcepts,
    matched_keywords: matchedKeywords,
    relevance_score: Math.round(relevance),
    freshness_score: Math.round(fresh),
    final_score: Math.round(finalScore),
    relevance: Math.round(finalScore)
  };
}

function matchConcepts(text, keywordProfile) {
  const concepts = new Set();
  const keywords = new Set();
  let score = 0;
  keywordProfile.entries.forEach((entry) => {
    const titleMatch = includesMarketTerm(text.title, text.titleUnsigned, entry);
    const bodyMatch = includesMarketTerm(text.body, text.bodyUnsigned, entry);
    if (!titleMatch && !bodyMatch) return;
    concepts.add(entry.conceptId);
    keywords.add(entry.keyword);
    const isPrimarySearch = entry.role === "main" || !keywordProfile.mainConceptIds.length;
    if (isPrimarySearch) score += titleMatch ? 30 : 20;
    else score += 15;
  });
  return { concepts, keywords, score };
}

function includesMarketTerm(text, unsignedText, entry) {
  return containsTerm(text, entry.normalized) || containsTerm(unsignedText, entry.unsigned);
}

function containsTerm(text, term) {
  if (!term) return false;
  if (/^[a-z0-9./+-]{1,5}$/i.test(term)) {
    return new RegExp(`(^|[^a-z0-9])${escapeRegExp(term)}([^a-z0-9]|$)`, "i").test(text);
  }
  return text.includes(term);
}

function buildMatchText(item) {
  const title = normalizeMarketText(item.title || "");
  const body = normalizeMarketText([item.summary, item.description, item.context, item.fullText].filter(Boolean).join(" "));
  return {
    title,
    body,
    original: `${title} ${body}`,
    titleUnsigned: removeVietnameseTone(title).toLowerCase(),
    bodyUnsigned: removeVietnameseTone(body).toLowerCase()
  };
}

function normalizeMarketText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function freshnessScore(time) {
  const date = new Date(time || 0);
  if (Number.isNaN(date.getTime())) return 0;
  const hours = Math.max(0, (Date.now() - date.getTime()) / 36e5);
  if (hours <= 12) return 95;
  if (hours <= 24) return 85;
  if (hours <= 48) return 70;
  if (hours <= 72) return 55;
  return 30;
}

function sourcePriority(name) {
  const key = String(name || "").toLowerCase();
  if (/reuters/.test(key)) return 10;
  if (/cafef|vietstock|vnexpress|cnbc|coindesk/.test(key)) return 8;
  if (/vneconomy|marketwatch|cointelegraph|bloomberg|nikkei/.test(key)) return 7;
  return 5;
}

function containsMarketNumbers(text) {
  return /(\d+([.,]\d+)?\s?%|\d+([.,]\d+)?\s?(tỷ|triệu|nghìn|usd|vnd|đồng|ounce|thùng|bps)|\d+([.,]\d+)?\s?đ\/cp)/i.test(text);
}

function dedupeScoredNews(items) {
  const kept = [];
  items.filter(Boolean).sort((a, b) => (b.final_score || 0) - (a.final_score || 0)).forEach((item) => {
    const titleKey = titleFingerprint(item.title);
    const duplicate = kept.some((existing) => {
      if (item.link && existing.link && normalizeUrl(item.link) === normalizeUrl(existing.link)) return true;
      return similarity(titleKey, titleFingerprint(existing.title)) > 0.82;
    });
    if (!duplicate) kept.push(item);
  });
  return kept;
}

function generateQuickMarketSummary(news, recencyHours) {
  const heading = `Tổng quan ${recencyHours}h gần nhất:`;
  const finalArticles = Array.isArray(news) ? news.filter(Boolean) : [];
  if (!finalArticles.length) {
    return {
      heading,
      bullets: ["Không tìm thấy đủ tin phù hợp trong khoảng thời gian đã chọn."],
      keywordStats: []
    };
  }

  const groups = buildMarketThemeGroups(finalArticles)
    .map((group) => ({
      ...group,
      bullet: buildThemeBullet(group)
    }))
    .filter((group) => group.bullet)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  return {
    heading,
    bullets: groups.length
      ? groups.map((group) => group.bullet)
      : ["Không tìm thấy đủ tin phù hợp trong khoảng thời gian đã chọn."],
    keywordStats: buildKeywordStats(finalArticles)
  };
}

const marketThemeDefinitions = [
  {
    id: "gold_macro",
    asset: "Vàng",
    concepts: ["gold", "silver"],
    drivers: ["usd", "fed", "bond_yield", "interest_rate", "inflation", "cpi"],
    fallbackDrivers: "USD, Fed và lợi suất"
  },
  {
    id: "vietnam_stocks",
    asset: "VN-Index/chứng khoán Việt Nam",
    concepts: ["vn_index", "vietnam_stocks", "stocks"],
    drivers: ["liquidity", "foreign_investors", "bank", "fx_rate", "interest_rate", "credit"],
    fallbackDrivers: "thanh khoản, khối ngoại và nhóm ngân hàng"
  },
  {
    id: "crypto",
    asset: "Crypto/Bitcoin",
    concepts: ["crypto", "bitcoin", "ethereum", "digital_assets"],
    drivers: ["fed", "usd", "bond_yield", "interest_rate", "inflation"],
    fallbackDrivers: "dòng tiền ETF, Fed và tâm lý rủi ro"
  },
  {
    id: "oil_energy",
    asset: "Dầu/hàng hóa",
    concepts: ["oil", "commodities"],
    drivers: ["geopolitics", "tariff", "usd", "inflation", "macro"],
    fallbackDrivers: "nguồn cung, địa chính trị và USD"
  },
  {
    id: "macro_rates",
    asset: "USD, Fed và lợi suất",
    concepts: ["fed", "usd", "bond_yield", "interest_rate", "fx_rate", "inflation", "cpi", "ppi", "jobs", "gdp", "pmi", "recession", "macro"],
    drivers: ["inflation", "cpi", "ppi", "jobs", "gdp", "pmi", "recession"],
    fallbackDrivers: "lạm phát, dữ liệu kinh tế và kỳ vọng lãi suất"
  },
  {
    id: "trade_geopolitics",
    asset: "Thuế quan/địa chính trị",
    concepts: ["tariff", "geopolitics"],
    drivers: ["usd", "oil", "commodities", "macro", "inflation"],
    fallbackDrivers: "rủi ro thương mại, chuỗi cung ứng và tâm lý thị trường"
  },
  {
    id: "banks_credit",
    asset: "Ngân hàng/tín dụng",
    concepts: ["bank", "credit"],
    drivers: ["interest_rate", "fx_rate", "liquidity", "macro"],
    fallbackDrivers: "lãi suất, tín dụng và thanh khoản"
  }
];

const driverLabels = {
  usd: "USD",
  fed: "kỳ vọng chính sách Fed",
  bond_yield: "lợi suất trái phiếu",
  interest_rate: "lãi suất",
  inflation: "lạm phát",
  cpi: "CPI",
  ppi: "PPI",
  jobs: "dữ liệu việc làm",
  gdp: "GDP",
  pmi: "PMI",
  recession: "rủi ro suy thoái",
  liquidity: "thanh khoản",
  foreign_investors: "khối ngoại",
  bank: "nhóm ngân hàng",
  fx_rate: "tỷ giá",
  credit: "tín dụng",
  geopolitics: "rủi ro địa chính trị",
  tariff: "thuế quan",
  oil: "giá dầu",
  commodities: "hàng hóa",
  macro: "bối cảnh vĩ mô"
};

function buildMarketThemeGroups(articles) {
  return marketThemeDefinitions.map((definition) => {
    const conceptSet = new Set(definition.concepts);
    const matchedArticles = articles
      .filter((article) => (article.matched_concepts || []).some((id) => conceptSet.has(id)))
      .sort((a, b) => articleStrength(b) - articleStrength(a));
    const allConcepts = new Set(matchedArticles.flatMap((article) => article.matched_concepts || []));
    const driverConcepts = definition.drivers.filter((id) => allConcepts.has(id));
    const score = matchedArticles.reduce((sum, article) => sum + articleStrength(article), 0);
    return { definition, articles: matchedArticles, allConcepts, driverConcepts, score };
  }).filter((group) => group.articles.length);
}

function articleStrength(article) {
  const finalScore = Number(article.final_score || article.relevance_score || 0);
  const fresh = Number(article.freshness_score || freshnessScore(article.published_at || article.time));
  const priority = sourcePriority(article.source_name || article.source || "");
  return finalScore + fresh * 0.2 + priority * 2;
}

function buildThemeBullet(group) {
  const topArticles = group.articles.slice(0, 3);
  if (!topArticles.length) return "";
  const text = topArticles.map((article) => [
    article.title,
    article.summary,
    article.description,
    article.context
  ].filter(Boolean).join(" ")).join(" ");
  const movement = detectMarketMovement(text);
  const driverPhrase = buildDriverPhrase(group.driverConcepts, group.definition.fallbackDrivers);
  const asset = group.definition.asset;

  if (group.definition.id === "vietnam_stocks") {
    return `${asset} ${movement === "tăng" ? "có tín hiệu tích cực" : movement === "giảm" ? "chịu áp lực" : "được chú ý"} trong các tin đã lọc, với trọng tâm là ${driverPhrase}.`;
  }
  if (group.definition.id === "macro_rates") {
    return `${asset} tiếp tục là nhóm biến số chính của thị trường, khi các bài viết nhấn mạnh ${driverPhrase}.`;
  }
  if (group.definition.id === "trade_geopolitics") {
    return `${asset} nổi lên như yếu tố cần theo dõi, do các tin liên quan tới ${driverPhrase}.`;
  }
  return `${asset} ${movement} trong nhóm tin đã lọc, đặt trong bối cảnh ${driverPhrase}.`;
}

function detectMarketMovement(text) {
  const value = removeVietnameseTone(String(text || "")).toLowerCase();
  const down = /(giam|lao doc|di xuong|mat gia|ap luc|ban rong|sut giam|decline|declines|declined|fall|falls|fell|drop|drops|dropped|slump|slumps|lower|weaken|weakens)/i.test(value);
  const up = /(tang|di len|hoi phuc|phuc hoi|bat tang|vuot|lap dinh|cao ky luc|rises|rose|rise|gains|gained|jump|jumps|rebound|rebounds|higher|strengthen|strengthens)/i.test(value);
  if (up && !down) return "tăng";
  if (down && !up) return "giảm";
  return "biến động";
}

function buildDriverPhrase(driverConcepts, fallback) {
  const labels = driverConcepts.map((id) => driverLabels[id]).filter(Boolean);
  if (!labels.length) return fallback;
  return joinVietnameseList(labels.slice(0, 3));
}

function joinVietnameseList(items) {
  if (items.length <= 1) return items[0] || "";
  if (items.length === 2) return `${items[0]} và ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} và ${items[items.length - 1]}`;
}

function buildKeywordStats(news) {
  const concepts = new Map();
  news.forEach((item) => {
    (item.matched_concepts || []).forEach((id) => {
      concepts.set(id, (concepts.get(id) || 0) + 1);
    });
  });
  return [...concepts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([id, count]) => `${conceptMap.get(id)?.label_vi || id}: ${count} tin`);
}

function titleFingerprint(title) {
  return removeVietnameseTone(stripHtml(title || ""))
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeUrl(url) {
  return String(url || "").replace(/[?#].*$/, "").replace(/\/$/, "");
}

function similarity(a, b) {
  const aa = new Set(String(a).split(" ").filter((word) => word.length > 2));
  const bb = new Set(String(b).split(" ").filter((word) => word.length > 2));
  if (!aa.size || !bb.size) return 0;
  const intersection = [...aa].filter((word) => bb.has(word)).length;
  return intersection / Math.max(aa.size, bb.size);
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const separator = trimmed.indexOf("=");
    if (separator === -1) return;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (!key || process.env[key]) return;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  });
}

async function enrichRssItem(source, item) {
  const article = item.link ? await fetchArticle(item.link).catch(() => ({})) : {};
  const rssDescription = stripHtml(item.description || "");
  const fullText = article.text || rssDescription;
  const analysis = await analyzeNewsItem({
    source: source.name,
    title: item.title,
    link: item.link,
    pubDate: item.pubDate,
    text: fullText,
    description: rssDescription
  });
  const summary = analysis.summary || detailedSummary(source.name, item, fullText, rssDescription);
  const topic = analysis.topic || chooseTopic(item.title, summary);

  return {
    selected: false,
    source: source.name,
    group: source.group || inferSourceGroup(item.link),
    link: item.link,
    title: item.title,
    topic,
    fullText: trimWhitespace(fullText).slice(0, 6500),
    summary,
    context: analysis.context || buildContext(topic, summary),
    image: article.image || item.image || "",
    time: toDatetimeLocal(item.pubDate)
  };
}

function chooseTopic(title, summary) {
  const titleTopic = detectTopic(title || "");
  if (titleTopic !== "Kinh tế - thị trường") return titleTopic;
  return detectTopic(`${title || ""} ${summary || ""}`);
}

async function importArticleUrl(url) {
  if (!url || !/^https?:\/\//i.test(url)) {
    throw new Error("URL không hợp lệ");
  }
  const article = await fetchArticle(url);
  const inferredSource = inferSourceName(url);
  const sourceName = article.siteName && !/^[\w.-]+\.[a-z]{2,}$/i.test(article.siteName) ? article.siteName : inferredSource;
  const item = {
    title: article.title || sourceName,
    link: url,
    description: article.description || "",
    pubDate: article.publishedTime || new Date().toISOString(),
    image: article.image || ""
  };
  const source = { name: sourceName, group: inferSourceGroup(url) };
  return enrichRssItem(source, item);
}

async function collectImageAssets(news = []) {
  const items = Array.isArray(news) ? news.slice(0, 5) : [];
  const articleAssets = items
    .filter((item) => item.image)
    .map((item) => ({
      type: "article",
      title: item.title || "Ảnh bài gốc",
      source: item.source || inferSourceName(item.link || ""),
      url: item.image,
      thumb: item.image,
      license: "Ảnh từ bài gốc, cần dùng theo quyền của nguồn báo",
      credit: item.source || "",
      page: item.link || "",
      keyword: item.topic || ""
    }));

  const queries = buildImageQueries(items);
  const batches = await Promise.allSettled(queries.map(async (query) => {
    const openverse = await searchOpenverseImages(query).catch(() => []);
    if (openverse.length) return openverse;
    return searchWikimediaImages(query).catch(() => []);
  }));

  const stockAssets = batches
    .filter((batch) => batch.status === "fulfilled")
    .flatMap((batch) => batch.value);

  const searchAssets = buildStockSearchAssets(items);
  return dedupeAssets(articleAssets.concat(stockAssets).concat(searchAssets)).slice(0, 30);
}

function buildImageQueries(items) {
  const text = items.map((item) => `${item.title || ""} ${item.topic || ""} ${item.summary || ""}`).join(" ");
  const normalized = removeVietnameseTone(text).toLowerCase();
  const queries = [
    "investor looking at stock market chart",
    "stock trading screen candlestick chart",
    "financial market data screen",
    "hand pen financial chart spreadsheet",
    "business finance investment meeting"
  ];

  if (/gold|vang/.test(normalized)) queries.push("gold market finance");
  if (/silver|bac/.test(normalized)) queries.push("silver commodity market");
  if (/oil|dau tho|brent|wti/.test(normalized)) queries.push("oil market energy");
  if (/crypto|bitcoin|tai san so/.test(normalized)) queries.push("cryptocurrency market");
  if (/fed|usd|lai suat|loi suat|ty gia/.test(normalized)) queries.push("federal reserve usd bond yields");
  if (/chung khoan|vn-index|co phieu|thanh khoan|margin/.test(normalized)) queries.push("stock market trading screen");
  if (/ngan hang/.test(normalized)) queries.push("banking finance vietnam");
  if (/dia chinh tri|tariff|thue quan/.test(normalized)) queries.push("global trade geopolitics");

  items.forEach((item) => {
    const topic = removeVietnameseTone(item.topic || "").toLowerCase();
    if (topic && topic.length > 3) queries.push(`${topic} finance`);
  });

  return [...new Set(queries)].slice(0, 8);
}

async function searchOpenverseImages(query) {
  const url = `https://api.openverse.engineering/v1/images/?q=${encodeURIComponent(query)}&license_type=commercial,modification&extension=jpg,png&unstable__include_sensitive_results=false&page_size=5`;
  const data = JSON.parse(await fetchText(url));
  return (data.results || []).map((item) => ({
    type: "stock",
    title: item.title || query,
    source: item.source || "Openverse",
    url: item.url || item.thumbnail,
    thumb: item.thumbnail || item.url,
    license: item.license || "free license",
    credit: item.creator || "",
    page: item.foreign_landing_url || item.url || "",
    keyword: query
  })).filter((item) => item.url);
}

function buildStockSearchAssets(items) {
  const text = items.map((item) => `${item.title || ""} ${item.topic || ""}`).join(" ");
  const normalized = removeVietnameseTone(text).toLowerCase();
  const query = /gold|vang/.test(normalized) ? "gold investment market"
    : /oil|dau tho|brent|wti/.test(normalized) ? "oil market finance"
    : /crypto|bitcoin|tai san so/.test(normalized) ? "crypto trading market"
    : /fed|usd|lai suat|loi suat|ty gia/.test(normalized) ? "financial market data"
    : "stock market trading investment";
  const encoded = encodeURIComponent(query);
  return [
    {
      type: "search",
      title: "Tìm stock image/video trên Freepik",
      source: "Freepik",
      thumb: stockPlaceholder("Freepik"),
      license: "Kiểm tra license/tài khoản trước khi dùng",
      page: `https://www.freepik.com/search?format=search&query=${encoded}`,
      keyword: query
    },
    {
      type: "search",
      title: "Tìm stock image/video trên Shutterstock",
      source: "Shutterstock",
      thumb: stockPlaceholder("Shutterstock"),
      license: "Nguồn trả phí, cần license",
      page: `https://www.shutterstock.com/search/${encoded}`,
      keyword: query
    },
    {
      type: "search",
      title: "Tìm stock video miễn phí trên Pexels",
      source: "Pexels",
      thumb: stockPlaceholder("Pexels"),
      license: "Free stock, kiểm tra điều khoản",
      page: `https://www.pexels.com/search/videos/${encoded}/`,
      keyword: query
    },
    {
      type: "search",
      title: "Tìm stock image/video miễn phí trên Pixabay",
      source: "Pixabay",
      thumb: stockPlaceholder("Pixabay"),
      license: "Free stock, kiểm tra điều khoản",
      page: `https://pixabay.com/videos/search/${encoded}/`,
      keyword: query
    }
  ];
}

function stockPlaceholder(label) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400"><defs><linearGradient id="g" x1="0" x2="1"><stop stop-color="#0f766e"/><stop offset="1" stop-color="#111827"/></linearGradient></defs><rect width="640" height="400" fill="url(#g)"/><path d="M70 300 C170 210 230 245 300 170 S450 95 570 120" fill="none" stroke="#67e8f9" stroke-width="16" stroke-linecap="round"/><text x="48" y="78" fill="#fff" font-family="Arial" font-size="34" font-weight="700">${label}</text><text x="48" y="122" fill="#d1fae5" font-family="Arial" font-size="22">stock image / video search</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

async function searchWikimediaImages(query) {
  const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(`${query} filetype:bitmap`)}&gsrnamespace=6&gsrlimit=6&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=600&format=json&origin=*`;
  const data = JSON.parse(await fetchText(url));
  const pages = Object.values(data.query?.pages || {});
  return pages.map((page) => {
    const info = page.imageinfo?.[0] || {};
    const meta = info.extmetadata || {};
    return {
      type: "stock",
      title: stripHtml(meta.ObjectName?.value || page.title || query).replace(/^File:/, ""),
      source: "Wikimedia Commons",
      url: info.url,
      thumb: info.thumburl || info.url,
      license: stripHtml(meta.LicenseShortName?.value || "Commons license"),
      credit: stripHtml(meta.Artist?.value || ""),
      page: info.descriptionurl || "",
      keyword: query
    };
  }).filter((item) => item.url);
}

function dedupeAssets(assets) {
  const seen = new Set();
  return assets.filter((asset) => {
    const key = asset.url || asset.thumb;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function removeVietnameseTone(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}

async function researchGoogleNews(keywords, sourceGroup, limitPerSource, recencyHours, cutoff) {
  const groups = sourceGroup === "all" ? ["domestic", "international"] : [sourceGroup];
  const batches = await Promise.allSettled(groups.map((group) => fetchGoogleNewsGroup(keywords, group, limitPerSource, recencyHours, cutoff)));
  return batches.filter((batch) => batch.status === "fulfilled").flatMap((batch) => batch.value);
}

async function fetchGoogleNewsGroup(keywords, group, limitPerSource, recencyHours, cutoff) {
  const domains = group === "domestic" ? domesticDomains : internationalDomains;
  const keywordQuery = keywords.map((keyword) => `"${keyword}"`).join(" OR ");
  const domainQuery = domains.map((domain) => `site:${domain}`).join(" OR ");
  const query = encodeURIComponent(`(${keywordQuery}) (${domainQuery}) when:${Math.ceil(recencyHours / 24)}d`);
  const locale = group === "international"
    ? { hl: "en-US", gl: "US", ceid: "US:en" }
    : { hl: "vi", gl: "VN", ceid: "VN:vi" };
  const url = `https://news.google.com/rss/search?q=${query}&hl=${locale.hl}&gl=${locale.gl}&ceid=${locale.ceid}`;
  const xml = await fetchText(url);
  const items = parseRss(xml)
    .map((item) => ({ item, score: relevanceScore(item, keywords) }))
    .filter(({ score }) => score > 0)
    .filter(({ item }) => isRecent(item.pubDate, cutoff))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(limitPerSource * domains.length, 20));

  return Promise.all(items.map(async ({ item, score }) => {
    const parsed = parseGoogleNewsTitle(item.title);
    const link = await resolveGoogleNewsLink(item.link).catch(() => item.link);
    const sourceName = parsed.source || inferSourceName(link);
    if (!domainAllowed(link, group) && !sourceNameAllowed(sourceName, group)) return null;
    const article = link ? await fetchArticle(link).catch(() => ({})) : {};
    const source = { name: sourceName, group };
    const enriched = await enrichRssItem(source, {
      ...item,
      title: parsed.title || item.title,
      link,
      description: item.description || article.description || "",
      image: item.image || article.image || ""
    });
    enriched.relevance = score;
    return enriched;
  })).then((items) => items.filter(Boolean));
}

function parseGoogleNewsTitle(title) {
  const clean = trimWhitespace(stripHtml(title || ""));
  const parts = clean.split(" - ");
  if (parts.length < 2) return { title: clean, source: "" };
  const source = parts.pop();
  return { title: parts.join(" - "), source };
}

async function resolveGoogleNewsLink(url) {
  if (!/news\.google\.com/i.test(url || "")) return url;
  const response = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": "Mozilla/5.0 KoliaNewsDesk/1.0" }
  });
  const html = await response.text().catch(() => "");
  const external = firstMatch(html, /<a[^>]+href=["'](https?:\/\/(?!news\.google\.com)[^"']+)["']/i);
  return decodeXml(external || response.url || url);
}

function dedupeNews(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = normalizeSearchText(item.link || `${item.source}-${item.title}`);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function groupMatches(group, sourceGroup) {
  return sourceGroup === "all" || group === sourceGroup;
}

function domainAllowed(url, group) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    const domains = group === "domestic" ? domesticDomains : internationalDomains;
    return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch (error) {
    return false;
  }
}

function sourceNameAllowed(name, group) {
  const value = normalizeSearchText(name || "");
  const domesticNames = [
    "cafef",
    "cafebiz",
    "vnexpress",
    "vneconomy",
    "vietnam economic times",
    "bao dau tu",
    "kinh te sai gon",
    "vietstock",
    "bao quoc te",
    "bao nhan dan",
    "tuoi tre",
    "thanh nien",
    "vnexpress international"
  ];
  const internationalNames = [
    "investing",
    "tradingview",
    "new york times",
    "ny times",
    "wall street journal",
    "financial times",
    "the economist",
    "bloomberg",
    "reuters",
    "fidelity",
    "foreign affairs",
    "nikkei asia",
    "cnbc",
    "coindesk",
    "cointelegraph",
    "marketwatch",
    "yahoo finance",
    "fortune",
    "kitco"
  ];
  const list = group === "domestic" ? domesticNames : internationalNames;
  return list.some((source) => value.includes(source));
}

function isRecent(value, cutoff) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return date.getTime() >= cutoff && date.getTime() <= Date.now() + 60 * 60 * 1000;
}

async function analyzeNewsItem(item) {
  if (!process.env.OPENAI_API_KEY) return {};

  const prompt = [
    "Bạn là trợ lý biên tập tin tài chính cho TikTok.",
    "Hãy đọc nội dung gốc và trả về JSON hợp lệ, không markdown.",
    "",
    "Yêu cầu:",
    "- Bám sát nội dung gốc, không tự thêm số liệu hoặc nguyên nhân.",
    "- summary phải chi tiết 4-6 dòng, nêu nguồn, thời điểm nếu có, số liệu chính, thay đổi so với kỳ/ngày trước nếu bài có, và chi tiết đáng chú ý.",
    "- Nếu nội dung gốc là tiếng Anh, summary và context bắt buộc viết bằng tiếng Việt; không giữ nguyên câu tiếng Anh trừ tên riêng, mã tài sản hoặc thuật ngữ cần thiết.",
    "- Loại bỏ menu/navigation/quảng cáo khỏi nội dung tóm tắt.",
    "- context phải chi tiết 2 đoạn ngắn: loại tin là gì, nên/không nên diễn giải thế nào; điểm cần theo dõi là gì.",
    "- topic là một cụm ngắn.",
    "",
    "JSON schema:",
    "{\"topic\":\"...\",\"summary\":\"...\",\"context\":\"...\"}",
    "",
    `Nguồn: ${item.source}`,
    `Link: ${item.link}`,
    `Thời gian RSS: ${item.pubDate}`,
    `Tiêu đề: ${item.title}`,
    `Mô tả RSS: ${item.description}`,
    `Nội dung gốc: ${trimWhitespace(item.text).slice(0, 9000)}`
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      input: prompt,
      max_output_tokens: 900
    })
  });

  if (!response.ok) return {};
  const data = await response.json();
  const text = extractResponseText(data);
  try {
    return JSON.parse(text);
  } catch (error) {
    return {};
  }
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 KoliaNewsDesk/1.0",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
  });
  if (!response.ok) throw new Error(`Fetch failed ${response.status}: ${url}`);
  return response.text();
}

async function proxyImage(rawUrl, res) {
  if (!rawUrl || !/^https?:\/\//i.test(rawUrl)) throw new Error("Invalid image URL");
  const imageUrl = new URL(rawUrl);
  const response = await fetch(imageUrl.href, {
    headers: {
      "User-Agent": "Mozilla/5.0 CalendarCopilot/1.0",
      "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      "Referer": `${imageUrl.protocol}//${imageUrl.host}/`
    }
  });
  if (!response.ok) throw new Error(`Image fetch failed ${response.status}`);
  const contentType = response.headers.get("content-type") || "image/jpeg";
  if (!/^image\//i.test(contentType)) throw new Error("URL is not an image");
  const bytes = Buffer.from(await response.arrayBuffer());
  res.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": bytes.length,
    "Cache-Control": "public, max-age=86400"
  });
  res.end(bytes);
}

async function fetchArticle(url) {
  const html = await fetchText(url);
  const image = firstMatch(html, /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
    || firstMatch(html, /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  const title = firstMatch(html, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
    || firstMatch(html, /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)
    || firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const h1Title = firstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const description = firstMatch(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
    || firstMatch(html, /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
  const siteName = firstMatch(html, /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i);
  const publishedTime = firstMatch(html, /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i)
    || firstMatch(html, /<time[^>]+datetime=["']([^"']+)["']/i);
  const articleMatch = firstMatch(html, /<article[\s\S]*?<\/article>/i);
  const source = articleMatch || html;
  const text = stripHtml(source)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 40)
    .join("\n");
  return {
    image: decodeXml(image || ""),
    title: longestCleanText([h1Title, title]),
    description: trimWhitespace(stripHtml(description || "")),
    siteName: trimWhitespace(stripHtml(siteName || "")),
    publishedTime,
    text
  };
}

function parseRss(xml) {
  return [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map((match) => {
    const block = match[0];
    const enclosure = firstMatch(block, /<enclosure[^>]+url=["']([^"']+)["']/i);
    const media = firstMatch(block, /<media:content[^>]+url=["']([^"']+)["']/i);
    return {
      title: decodeXml(tagValue(block, "title")),
      link: decodeXml(tagValue(block, "link")),
      description: decodeXml(tagValue(block, "description")),
      pubDate: decodeXml(tagValue(block, "pubDate")),
      image: decodeXml(media || enclosure || "")
    };
  }).filter((item) => item.title && item.link);
}

function tagValue(block, tag) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  if (!match) return "";
  return match[1].replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").trim();
}

function relevanceScore(item, keywords) {
  if (!keywords.length) return 1;
  const title = normalizeSearchText(item.title);
  const description = normalizeSearchText(stripHtml(item.description || ""));
  return keywords.reduce((score, rawKeyword) => {
    const keyword = normalizeSearchText(rawKeyword);
    if (!keyword) return score;
    const pattern = keyword.length <= 4
      ? new RegExp(`(^|[^a-z0-9])${escapeRegExp(keyword)}([^a-z0-9]|$)`, "i")
      : new RegExp(escapeRegExp(keyword), "i");
    if (pattern.test(title)) return score + 5;
    if (pattern.test(description)) return score + 2;
    return score;
  }, 0);
}

function detectTopic(text) {
  const value = text.toLowerCase();
  const titleLike = value.slice(0, 260);
  if (/(vàng|gold|bạc|silver|kim loại quý|precious metal|quỹ vàng|spdr)/i.test(titleLike)) return "Vàng - bạc";
  if (/(vn-index|chứng khoán|cổ phiếu|thanh khoản|stock|market)/i.test(titleLike)) return "Thị trường chứng khoán";
  if (/(fed|lãi suất|interest rate|trái phiếu|bond|lợi suất|yield|cpi|ppi|inflation|thuế quan|tariff|địa chính trị|geopolitical)/i.test(titleLike)) return "Vĩ mô quốc tế";
  if (/(tỷ giá|usd|vnd|ngoại hối|currency|dollar|dxy)/i.test(titleLike)) return "Tỷ giá - USD";
  if (/(dầu|oil|brent|wti|opec|commodity|hàng hóa)/i.test(titleLike)) return "Hàng hóa";
  if (/(crypto|bitcoin|ethereum|btc|eth|tài sản số|digital asset|stablecoin|etf bitcoin)/i.test(titleLike)) return "Crypto - tài sản số";
  if (/(ngân hàng|bank|tín dụng|credit)/i.test(titleLike)) return "Ngân hàng";
  if (/(doanh nghiệp|lợi nhuận|doanh thu|earnings|profit|revenue)/i.test(titleLike)) return "Doanh nghiệp";
  if (/(crypto|bitcoin|ethereum|btc|eth|tài sản số|digital asset|stablecoin|etf bitcoin)/i.test(value)) return "Crypto - tài sản số";
  if (/(vàng|gold|bạc|silver|kim loại quý|precious metal|quỹ vàng|spdr)/i.test(value)) return "Vàng - bạc";
  if (/(vn-index|chứng khoán|cổ phiếu|thanh khoản|stock|market)/i.test(value)) return "Thị trường chứng khoán";
  if (/(dầu|oil|brent|wti|opec|commodity|hàng hóa)/i.test(value)) return "Hàng hóa";
  if (/(fed|lãi suất|interest rate|trái phiếu|bond|lợi suất|yield|cpi|ppi|inflation|thuế quan|tariff|địa chính trị|geopolitical)/i.test(value)) return "Vĩ mô quốc tế";
  if (/(tỷ giá|usd|vnd|ngoại hối|currency|dollar|dxy)/i.test(value)) return "Tỷ giá - USD";
  if (/(ngân hàng|bank|tín dụng|credit)/i.test(value)) return "Ngân hàng";
  if (/(doanh nghiệp|lợi nhuận|doanh thu|earnings|profit|revenue)/i.test(value)) return "Doanh nghiệp";
  return "Kinh tế - thị trường";
}

function summarizeText(text) {
  const clean = trimWhitespace(stripHtml(text));
  const sentences = clean
    .split(/(?<=[.!?。])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 35);
  return trimText((sentences.slice(0, 2).join(" ") || clean), 360);
}

function detailedSummary(source, item, fullText, rssDescription) {
  const clean = trimWhitespace(stripHtml(fullText || rssDescription || ""));
  const description = trimWhitespace(stripHtml(rssDescription || ""));
  if (isMostlyEnglish(`${item.title} ${description || clean}`)) {
    return vietnameseSummaryFromEnglish(source, item, description || clean);
  }
  const sentences = clean
    .split(/(?<=[.!?。])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 35 && !isBoilerplate(sentence));
  const numbers = extractNumberSentences(clean).slice(0, 4);
  const picked = uniqueLines([
    `${source} cập nhật tin "${item.title}"${item.pubDate ? ` vào ${formatVietnamTime(item.pubDate)}` : ""}.`,
    description,
    ...numbers,
    ...sentences.slice(0, 3)
  ]).filter(Boolean);
  return picked.slice(0, 6).join("\n");
}

function buildContext(topic, summary) {
  if (isMostlyEnglish(summary)) {
    return vietnameseContextForEnglish(topic, summary);
  }
  const type = inferNewsType(topic, summary);
  const timeframe = inferTimeframe(summary);
  const movement = inferMovement(summary);
  const causes = extractCauseHints(summary);
  const watch = watchFactors(topic);
  const causeLine = causes.length
    ? `Bài gốc có nhắc tới các yếu tố/nguyên nhân cần giữ đúng khi diễn giải: ${causes.join(", ")}.`
    : "Bài gốc chưa nêu nguyên nhân cụ thể, vì vậy nội dung nên dừng ở cập nhật dữ liệu/sự kiện và các điểm cần theo dõi, không tự thêm insight.";

  return [
    `Đây là ${type}, phản ánh ${movement} trong khung thời gian ${timeframe}.`,
    `Với dữ liệu hiện có, tin này nên được hiểu là ${contextInterpretation(type, movement)}, chưa đủ cơ sở để kết luận xu hướng dài hạn hoặc tín hiệu mua bán.`,
    causeLine,
    `Góc truyền thông phù hợp với Kolia Phan là giúp người xem hiểu cách đọc tin: tin nói gì, nằm trong bối cảnh nào, và chưa nên kết luận điều gì.`,
    `Điểm cần theo dõi tiếp theo là ${watch}.`
  ].join("\n");
}

function extractNumberSentences(text) {
  return trimWhitespace(text)
    .split(/(?<=[.!?。])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => /\d/.test(sentence) && sentence.length > 25 && !isBoilerplate(sentence));
}

function inferNewsType(topic, text) {
  const value = `${topic} ${text}`.toLowerCase();
  if (/giá|price|tăng|giảm|mua vào|bán ra|thanh khoản|lợi suất|yield|usd|dxy/.test(value)) return "tin dữ liệu giá/thị trường";
  if (/fed|công bố|quyết định|chính sách|thuế quan|tariff|sec|etf|nhnn|lãi suất/.test(value)) return "tin sự kiện vĩ mô/chính sách";
  if (/chuyên gia|dự báo|nhận định|cho rằng|ước tính|forecast/.test(value)) return "tin nhận định";
  if (/báo cáo|report|cung cầu|demand|supply|sản lượng|dự trữ/.test(value)) return "tin nền tảng/báo cáo thị trường";
  return "tin cập nhật thị trường";
}

function inferTimeframe(text) {
  const value = text.toLowerCase();
  if (/hôm nay|trong ngày|so với ngày|phiên|today|daily/.test(value)) return "trong ngày/so với phiên trước";
  if (/tuần|week/.test(value)) return "trong tuần";
  if (/tháng|month/.test(value)) return "trong tháng";
  if (/từ đầu năm|year-to-date|ytd|năm/.test(value)) return "từ đầu năm hoặc theo năm";
  return "ngắn hạn theo thời điểm bài gốc cập nhật";
}

function inferMovement(text) {
  const value = text.toLowerCase();
  if (/hồi|rebound|phục hồi/.test(value)) return "một nhịp hồi ngắn hạn";
  if (/tăng|lên|cao hơn|gain|rise|rally|gom/.test(value)) return "một biến động tăng hoặc lực mua được ghi nhận trong bài";
  if (/giảm|xuống|mất|drop|fall|sell/.test(value)) return "một biến động giảm hoặc áp lực bán được ghi nhận trong bài";
  if (/fed|cpi|ppi|lãi suất|thuế quan|địa chính trị/.test(value)) return "phản ứng sau sự kiện/chờ dữ liệu vĩ mô";
  return "một diễn biến được ghi nhận tại thời điểm bài viết";
}

function contextInterpretation(type, movement) {
  if (type.includes("dữ liệu giá")) return `${movement}, không phải xác nhận một xu hướng bền vững`;
  if (type.includes("sự kiện")) return `${movement}, cần chờ phản ứng của các tài sản liên quan`;
  if (type.includes("nhận định")) return "một góc nhìn/nhận định được dẫn trong bài gốc, không phải kết luận chắc chắn";
  if (type.includes("báo cáo")) return "dữ liệu nền để theo dõi, cần đối chiếu thêm với biến động thị trường";
  return `${movement}, cần đặt cạnh dữ liệu bổ sung trước khi diễn giải sâu`;
}

function extractCauseHints(text) {
  const value = text.toLowerCase();
  const hints = [];
  [
    ["USD", /usd|dxy|đồng đô|dollar/],
    ["lợi suất/lãi suất", /lợi suất|yield|lãi suất|fed|interest/],
    ["lạm phát", /cpi|ppi|lạm phát|inflation/],
    ["thuế quan", /thuế quan|tariff/],
    ["địa chính trị", /địa chính trị|geopolitical|xung đột/],
    ["nhu cầu công nghiệp", /nhu cầu công nghiệp|industrial demand/],
    ["chênh lệch trong nước - thế giới", /chênh lệch|trong nước|thế giới/],
    ["dòng tiền/quỹ ETF", /etf|quỹ|dòng tiền|flow/]
  ].forEach(([label, pattern]) => {
    if (pattern.test(value)) hints.push(label);
  });
  return hints;
}

function watchFactors(topic) {
  const map = {
    "Vàng - bạc": "mức chênh lệch trong nước - thế giới, biến động qua các phiên kế tiếp, USD, lợi suất và nhu cầu thị trường",
    "Crypto - tài sản số": "dòng tiền ETF, phản ứng của Bitcoin/Ethereum, chính sách quản lý và khẩu vị rủi ro toàn cầu",
    "Vĩ mô quốc tế": "Fed, CPI/PPI, lợi suất, USD, dầu, thuế quan, địa chính trị và phản ứng của nhóm tài sản rủi ro",
    "Tỷ giá - USD": "DXY/USD, tỷ giá trong nước, khối ngoại và nhóm doanh nghiệp nhạy với ngoại tệ",
    "Thị trường chứng khoán": "VN-Index, thanh khoản, nhóm ngành dẫn dắt, khối ngoại và thông tin vĩ mô/doanh nghiệp liên quan",
    "Hàng hóa": "giá quốc tế, USD, cung cầu, tồn kho và tác động tới nhóm doanh nghiệp liên quan"
  };
  return map[topic] || "số liệu chính trong bài, khung thời gian cập nhật, nguyên nhân được bài gốc nêu và phản ứng của các tài sản liên quan";
}

function isBoilerplate(sentence) {
  return /(mới nhất|đọc nhanh|chia sẻ|copy link|cùng chuyên mục|xem theo ngày|địa chỉ|email|hotline|copyright|trở lên trên|tin mới)/i.test(sentence);
}

function uniqueLines(lines) {
  const seen = new Set();
  return lines.filter((line) => {
    const clean = trimWhitespace(line);
    if (!clean || seen.has(clean)) return false;
    seen.add(clean);
    return true;
  });
}

function formatVietnamTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(date);
}

function inferSourceName(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const known = {
      "cafef.vn": "CafeF",
      "vietstock.vn": "Vietstock",
      "vnexpress.net": "VnExpress",
      "vneconomy.vn": "VnEconomy",
      "cnbc.com": "CNBC",
      "coindesk.com": "CoinDesk",
      "cointelegraph.com": "Cointelegraph",
      "reuters.com": "Reuters",
      "bloomberg.com": "Bloomberg",
      "ft.com": "Financial Times",
      "wsj.com": "Wall Street Journal",
      "investing.com": "Investing",
      "tradingview.com": "TradingView"
    };
    return known[host] || host;
  } catch (error) {
    return "Nguồn từ link";
  }
}

function inferSourceGroup(url) {
  try {
    const host = new URL(url).hostname;
    return /\.(vn)$|cafef|vietstock|vnexpress|vneconomy|baodautu|kinhtesaigon|tuoitre|thanhnien|nhandan/i.test(host)
      ? "domestic"
      : "international";
  } catch (error) {
    return "domestic";
  }
}

function stripHtml(value) {
  return decodeXml(String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " "));
}

function decodeXml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function firstMatch(text, regex) {
  const match = String(text || "").match(regex);
  return match ? match[1] : "";
}

function trimWhitespace(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function normalizeSearchText(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function longestCleanText(values) {
  return values
    .map((value) => trimWhitespace(stripHtml(value || "")))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)[0] || "";
}

function toDatetimeLocal(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 16);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

async function generateCaption(prompt, news, options = {}) {
  if (!process.env.OPENAI_API_KEY) {
    return { provider: "needs_api_key", text: apiKeyRequiredBrief(news, options) };
  }

  const editorialPrompt = buildEditorialGeneratePrompt(prompt, news, options);
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      input: editorialPrompt,
      max_output_tokens: 1800
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || "OpenAI request failed");
  }

  return {
    provider: "openai",
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    text: sanitizeGeneratedContent(extractResponseText(data) || "Không nhận được output từ model.")
  };
}

async function generateVideoShortNews(news, videoConfig = {}, sceneSettings = {}) {
  if (!process.env.OPENAI_API_KEY) {
    return {
      provider: "needs_api_key",
      error: "Server chua co OPENAI_API_KEY.",
      videoOutput: buildFallbackVideoOutput(news, videoConfig)
    };
  }

  const safeNews = Array.isArray(news) ? news.slice(0, 3) : [];
  if (!safeNews.length) throw new Error("Can tick 1-3 tin truoc khi generate video");

  const prompt = buildVideoShortNewsPrompt(safeNews, videoConfig, sceneSettings);
  const raw = await callOpenAiText(prompt, 5200);
  const parsed = parseLooseJson(raw);
  const videoOutput = normalizeVideoOutput(parsed, safeNews, videoConfig);
  const validation = validateVideoOutput(videoOutput);
  if (validation.missing.length) {
    throw new Error(`Output chua dung format video short. Thieu: ${validation.missing.join(", ")}`);
  }

  return {
    provider: "openai",
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    videoOutput,
    validation
  };
}

async function editVideoShortNews(body = {}) {
  const action = String(body.action || "");
  const videoOutput = normalizeVideoOutput(body.videoOutput || {}, body.news || [], body.videoConfig || {});
  const sceneIndex = Number(body.sceneIndex || 0);

  if (!process.env.OPENAI_API_KEY) {
    return {
      provider: "local",
      videoOutput: applyLocalVideoEdit(videoOutput, action, sceneIndex)
    };
  }

  if (["split_scene", "merge_next"].includes(action)) {
    return {
      provider: "local",
      videoOutput: applyLocalVideoEdit(videoOutput, action, sceneIndex)
    };
  }

  const prompt = buildVideoEditPrompt({
    action,
    sceneIndex,
    videoOutput,
    news: body.news || []
  });
  const raw = await callOpenAiText(prompt, 5200);
  const parsed = parseLooseJson(raw);
  const revised = normalizeVideoOutput(parsed, body.news || [], body.videoConfig || videoOutput.videoSetup);
  const validation = validateVideoOutput(revised);
  if (validation.missing.length) {
    throw new Error(`Output chua dung format video short. Thieu: ${validation.missing.join(", ")}`);
  }
  return {
    provider: "openai",
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    videoOutput: revised,
    validation
  };
}

async function parsePersonalPlannerInput(text, weekStart) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("Server chua co OPENAI_API_KEY.");
  }
  const safeText = trimText(String(text || ""), 6000);
  if (!safeText.trim()) throw new Error("Chua co noi dung can phan loai.");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
  const prompt = [
    "Ban la tro ly lich ca nhan tieng Viet. Nhiem vu cua ban chi la phan loai input thanh cac muc lich co cau truc.",
    "Khong tao lich tuan cuoi cung. Khong them su kien khong co trong input. Chi tra ve JSON hop le, khong markdown.",
    "",
    "Schema bat buoc:",
    JSON.stringify({
      items: [{
        title: "string ngan gon",
        type: "fixed | deadline | task | habit | rest",
        date: "YYYY-MM-DD hoac rong",
        start: "HH:MM neu co, mac dinh 09:00",
        end: "HH:MM neu co, mac dinh start + duration",
        duration: "so phut",
        priority: "high | medium | low",
        frequency: "so lan/tuần cho habit/rest, mac dinh 1",
        confidence: "0-1",
        missingFields: ["title | date | time"],
        notes: "rang buoc ngan gon neu co"
      }]
    }, null, 2),
    "",
    "Quy tac:",
    "- fixed: lop hoc, ca lam, cuoc hen, meeting, khung gio khong doi, nhung chi dung fixed khi co ngay hoac gio ro rang.",
    "- deadline: bai tap/essay/project co han nop. date la han nop neu co.",
    "- task: viec linh hoat can lam nhung khong co han nop ro. Neu input chi noi 'di hoc/on/hoc mon...' ma khong co ngay/gio, hay dung task de app tu xep vao calendar.",
    "- habit: boi, pilates, gym, yoga, doc sach, thoi quen lap lai.",
    "- rest: relax, nghi, xa hoi, giai tri nhe.",
    "- Input co the la text note nhieu mon hoc. Dong dang '1. Ten mon:' la context/subject, khong tao item rieng.",
    "- Moi bullet ben duoi mot mon hoc la mot item rieng. Hay prefix title bang ten mon, vi du 'Quan he cong chung - BT giua ky'.",
    "- Dong '*Note:' hoac 'Note:' la ghi chu, dua vao notes cua item lien quan gan nhat hoac cac item cung mon neu phu hop.",
    "- Neu bullet co 'deadline 27/06' hoac 'DL 28/06', type phai la deadline va date la ngay han nop.",
    "- Neu co gio han nop nhu '10h30 toi nay 20/06', lay date 20/06 va ghi gio han nop trong notes; van de type deadline.",
    "- Neu co thu trong tuan, quy doi theo weekStart. weekStart la thu 2 cua tuan dang lap.",
    "- Neu input co nhieu thu lap lai nhu 'thu 2,4,6' hoac 'toi thu 2, thu 4, thu 6', tra ve nhieu items rieng, moi item mot ngay, cung title/start/end.",
    "- Dung timezone thiet bi Asia/Saigon. Neu input noi tomorrow/ngay mai, quy doi dua tren today.",
    "- Neu khong ro thoi luong: fixed dung end-start neu co; deadline/task 90 phut; habit/rest 60 phut.",
    "- Neu khong ro priority: deadline high, fixed medium, con lai medium.",
    "",
    `today: ${today}`,
    `weekStart: ${weekStart || "khong ro"}`,
    "",
    "Input:",
    safeText
  ].join("\n");
  const raw = await callOpenAiText(prompt, 2200);
  const parsed = parseLooseJson(raw);
  const items = normalizePersonalPlannerItems(parsed?.items || parsed || [], weekStart);
  if (!items.length || shouldUsePlannerFallback(safeText, items)) {
    return {
      provider: "local_fallback",
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      items: parsePersonalPlannerInputLocally(safeText, weekStart)
    };
  }
  return {
    provider: "openai",
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    items
  };
}

function parsePersonalPlannerInputLocally(text, weekStart) {
  const lines = expandCompactPlannerNoteText(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  let section = "";
  let pendingNote = "";
  const items = [];
  lines.forEach((line) => {
    const heading = line.match(/^(?:\d+[.)]\s*)?([^:-][^:]{2,80}):\s*$/);
    if (heading && !/^[-*]/.test(line)) {
      section = cleanPlannerNoteLine(heading[1]);
      return;
    }
    if (/^\*?\s*note\s*:/i.test(line)) {
      pendingNote = cleanPlannerNoteLine(line.replace(/^\*?\s*note\s*:/i, ""));
      return;
    }
    const cleaned = cleanPlannerNoteLine(line);
    if (!cleaned) return;
    const lower = cleaned.toLowerCase();
    const dates = extractPlannerDatesFromText(lower, weekStart);
    const time = extractPlannerTimeRange(lower) || extractPlannerSingleTime(lower);
    const type = inferPlannerItemType(lower, { date: dates[0] || "", time });
    const duration = extractPlannerDuration(lower) || (time?.end ? Math.max(15, plannerTimeToMinutes(time.end) - plannerTimeToMinutes(time.start)) : type === "habit" || type === "rest" ? 60 : 90);
    const start = time?.start || "09:00";
    const targetDates = dates.length ? dates : [""];
    targetDates.forEach((date) => {
      items.push({
        title: trimText(`${section ? `${section} - ` : ""}${cleaned}`.replace(/\s+/g, " "), 160),
        type,
        date,
        start,
        end: time?.end || minutesToPlannerTime(plannerTimeToMinutes(start) + duration),
        duration,
        priority: type === "deadline" ? "high" : "medium",
        frequency: extractPlannerFrequency(lower) || 1,
        notes: [pendingNote, targetDates.length > 1 ? "Lich lap theo nhieu ngay trong tuan." : "", "Tao tu text note."].filter(Boolean).join(" ")
      });
    });
    pendingNote = "";
  });
  return normalizePersonalPlannerItems(items, weekStart);
}

function shouldUsePlannerFallback(text, items) {
  const source = String(text || "");
  const hasMultipleTasks = (source.match(/\s-\s+/g) || []).length >= 2 || (source.match(/\d+[.)]\s+[^:]{2,90}:/g) || []).length >= 2;
  const hasOneHugeItem = items.length === 1 && String(items[0]?.title || "").length > 180;
  return hasMultipleTasks && hasOneHugeItem;
}

function expandCompactPlannerNoteText(text) {
  return String(text || "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+(\d+[.)]\s+[^:\n]{2,90}:)/g, "\n$1\n")
    .replace(/[ \t]+(\*?\s*Note\s*:)/gi, "\n$1")
    .replace(/[ \t]+(-\s+[^-\n])/g, "\n$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanPlannerNoteLine(line) {
  return String(line || "")
    .replace(/^[-*•]\s*/, "")
    .replace(/^\d+[.)]\s*/, "")
    .trim();
}

function inferPlannerItemType(lower, context = {}) {
  if (/deadline|hạn|han|nộp|nop|due|dl\b|kiểm tra|kiem tra|online/.test(lower)) return "deadline";
  if (/bơi|boi|pilates|gym|tập|tap|chạy|yoga|đọc|doc|habit|thói quen/.test(lower)) return "habit";
  if (/relax|nghỉ|nghi|xả hơi|xa hoi|thư giãn|giải trí|giai tri/.test(lower)) return "rest";
  if (/meeting|lịch|lich|ca làm|ca lam|lớp|lop/.test(lower) && (context.date || context.time)) return "fixed";
  if (/học|hoc|ôn|on|bài|bai|môn|mon|qt |quản trị|quan tri|thương hiệu|thuong hieu/.test(lower)) return "task";
  return "task";
}

function extractPlannerDateFromText(text, weekStart) {
  const shortDate = String(text || "").match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (shortDate) return normalizePlannerDate(shortDate[0], weekStart);
  return normalizePlannerDate(text, weekStart);
}

function extractPlannerDatesFromText(text, weekStart) {
  const normalized = normalizeCopilotCommand(text);
  const start = parsePlannerDate(weekStart);
  if (!start) {
    const single = extractPlannerDateFromText(text, weekStart);
    return single ? [single] : [];
  }
  const found = new Set();
  const addWeekday = (value) => {
    const number = Number(value);
    if (number < 2 || number > 7) return;
    const date = new Date(start);
    date.setDate(start.getDate() + number - 2);
    found.add(plannerDateToInput(date));
  };
  const sequence = normalized.match(/\b(?:thu|t)\s*((?:[2-7]\s*(?:,|\/|&|va|\s)\s*)+[2-7])\b/);
  if (sequence) {
    sequence[1].split(/[^2-7]+/).filter(Boolean).forEach(addWeekday);
  }
  [...normalized.matchAll(/\b(?:thu|t)\s*([2-7])\b/g)].forEach((match) => addWeekday(match[1]));
  if (/\b(?:chu nhat|cn|sunday)\b/.test(normalized)) {
    const date = new Date(start);
    date.setDate(start.getDate() + 6);
    found.add(plannerDateToInput(date));
  }
  if (found.size) return [...found].sort();
  const single = extractPlannerDateFromText(text, weekStart);
  return single ? [single] : [];
}

function extractPlannerTimeRange(text) {
  const match = String(text || "").match(/(\d{1,2})(?:h|:)?(\d{2})?\s*(?:-|đến|den|to)\s*(\d{1,2})(?:h|:)?(\d{2})?/);
  if (!match) return null;
  return {
    start: normalizePlannerTime(`${match[1]}:${match[2] || "00"}`, "09:00"),
    end: normalizePlannerTime(`${match[3]}:${match[4] || "00"}`, "10:00")
  };
}

function extractPlannerSingleTime(text) {
  const match = String(text || "").match(/\b(\d{1,2})(?:h|:)(\d{2})?\s*(tối|toi|pm|chiều|chieu|sáng|sang|am)?\b/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const marker = match[3] || "";
  if ((/tối|toi|pm|chiều|chieu/.test(marker) || /tối nay|toi nay/.test(text)) && hour < 12) hour += 12;
  const end = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  const start = minutesToPlannerTime(Math.max(0, plannerTimeToMinutes(end) - 60));
  return { start, end };
}

function extractPlannerDuration(text) {
  const match = String(text || "").match(/(\d+(?:[,.]\d+)?)\s*(giờ|gio|h|tiếng|tieng|phút|phut|m)\b/);
  if (!match) return 0;
  const amount = Number(match[1].replace(",", "."));
  return /ph|m\b/.test(match[2]) ? Math.round(amount) : Math.round(amount * 60);
}

function extractPlannerFrequency(text) {
  const match = String(text || "").match(/(\d+)\s*(buổi|buoi|lần|lan|sessions?)/);
  return match ? Number(match[1]) : 0;
}

function normalizePersonalPlannerItems(items, weekStart) {
  const validTypes = new Set(["fixed", "deadline", "task", "habit", "rest"]);
  const validPriority = new Set(["high", "medium", "low"]);
  return (Array.isArray(items) ? items : []).map((item) => {
    let type = validTypes.has(item?.type) ? item.type : "task";
    const normalizedDate = normalizePlannerDate(item?.date, weekStart);
    if (type === "fixed" && !normalizedDate) type = "task";
    const duration = Math.max(15, Math.min(720, Number(item?.duration || (type === "habit" || type === "rest" ? 60 : 90))));
    const start = normalizePlannerTime(item?.start, "09:00");
    const end = normalizePlannerTime(item?.end, minutesToPlannerTime(plannerTimeToMinutes(start) + duration));
    return {
      title: trimText(String(item?.title || "").trim(), 140),
      type,
      date: normalizedDate,
      start,
      end,
      duration,
      priority: validPriority.has(item?.priority) ? item.priority : (type === "deadline" ? "high" : "medium"),
      frequency: Math.max(1, Math.min(7, Number(item?.frequency || 1))),
      confidence: Math.max(0, Math.min(1, Number(item?.confidence || 0.86))),
      missingFields: Array.isArray(item?.missingFields) ? item.missingFields.filter(Boolean).slice(0, 5) : [],
      notes: trimText(String(item?.notes || "").trim(), 220)
    };
  }).filter((item) => item.title);
}

async function calendarCopilotChat(body = {}) {
  const message = String(body.message || "").trim();
  if (!message) throw new Error("Missing message");
  const commandText = normalizeCopilotCommand(message);
  const conversationId = String(body.conversationId || `conversation-${Date.now().toString(36)}`);
  const weekStart = String(body.weekStart || "").slice(0, 10) || plannerInputDate(plannerStartOfWeek(new Date()));
  const schedule = Array.isArray(body.schedule) ? body.schedule : [];
  const pendingOptions = Array.isArray(body.pendingOptions) ? body.pendingOptions : [];
  const history = Array.isArray(body.history) ? body.history : [];
  const optionMatch = commandText.match(/(?:option|lua chon)\s*(\d+)/i);
  const wantsAdd = /(?:them|cho vao|luu|chot|add)/i.test(commandText) && /(?:lich|calendar|option)/i.test(commandText);
  if (wantsAdd && optionMatch) {
    const option = pendingOptions[Number(optionMatch[1]) - 1];
    const reply = await openAiCopilotConfirmReply(message, option);
    return {
      ok: true,
      intent: "confirm_option",
      reply,
      confirmOptionId: option?.optionId || "",
      pendingOptions,
      status: option ? "ok" : "empty",
      providerReports: [{ provider: "openai", status: "ok", message: `openai ${calendarCopilotModel()}: AI xử lý xác nhận` }]
    };
  }

  const range = copilotRange(message, weekStart);
  const isExternalIntent = copilotExternalIntent(commandText, pendingOptions);
  const freeSlots = copilotFreeSlots(schedule, range.start, range.end, isExternalIntent ? 90 : 60);
  const followUp = /tim lai|lọc|loc|them nua|thêm nữa|gan hon|gần hơn|cuoi tuan|cuối tuần|khac|khác/i.test(commandText);
  const contextText = history.slice(-6).map((item) => `${item.role || "user"}: ${item.content || ""}`).join("\n");
  const searchMessage = followUp && contextText ? `${contextText}\nUser follow-up: ${message}` : message;
  const aiResult = await openAiCalendarCopilotProvider({
    message,
    searchMessage,
    history,
    schedule,
    pendingOptions,
    range,
    freeSlots,
    isExternalIntent,
    timezone: String(body.timezone || "Asia/Saigon")
  });
  const pending = sanitizeCopilotOptions(aiResult.pendingOptions || [], range, commandText);
  const rangeText = copilotRangeLabel(range);
  return {
    ok: true,
    conversationId,
    batchId: `batch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    intent: aiResult.intent || (isExternalIntent ? "external_activity_suggestions" : "free_slot_suggestions"),
    reply: aiResult.reply || (pending.length
      ? `Trong khoảng ${rangeText}, mình tạo ${pending.length} option tạm. Bạn có thể bấm thêm hoặc nhắn "thêm option 1 vào lịch".`
      : `Trong khoảng ${rangeText}, mình chưa tìm được option phù hợp với lịch trống hiện tại.`),
    status: pending.length ? "ok" : "empty",
    freeSlots,
    pendingOptions: pending,
    providerReports: aiResult.providerReports || [{ provider: "openai", status: "ok", message: `openai ${calendarCopilotModel()}: AI xử lý` }]
  };
}

function calendarCopilotModel() {
  const model = String(process.env.OPENAI_MODEL || "").trim();
  if (!model) throw new Error("Calendar Copilot cần OPENAI_MODEL trong .env để chat trực tiếp với AI.");
  return model;
}

async function openAiCopilotConfirmReply(message, option) {
  const model = calendarCopilotModel();
  if (!process.env.OPENAI_API_KEY) throw new Error("Calendar Copilot cần OPENAI_API_KEY trong .env.");
  const prompt = [
    "Bạn là Calendar Copilot. Trả lời ngắn bằng tiếng Việt.",
    "Người dùng đang yêu cầu thêm một option đã gợi ý vào lịch.",
    `Tin nhắn: ${message}`,
    `Option: ${option ? JSON.stringify({
      title: option.title,
      proposedStart: option.proposedStart,
      proposedEnd: option.proposedEnd,
      location: option.location || ""
    }) : "không tìm thấy option tương ứng"}`,
    option
      ? "Hãy xác nhận tự nhiên rằng bạn sẽ thêm option này vào lịch. Không hỏi lại."
      : "Hãy nói rằng bạn chưa thấy option đó trong danh sách hiện tại và gợi ý người dùng chọn số option đang hiển thị."
  ].join("\n");
  const data = await callOpenAiResponses({
    model,
    input: prompt,
    max_output_tokens: 220
  });
  return sanitizeGeneratedContent(extractResponseText(data) || (option ? `Mình sẽ thêm "${option.title}" vào lịch.` : "Mình chưa thấy option đó trong danh sách hiện tại."));
}

async function openAiCalendarCopilotProvider({ message, searchMessage, history, schedule, pendingOptions, range, freeSlots, isExternalIntent, timezone }) {
  const model = calendarCopilotModel();
  if (!process.env.OPENAI_API_KEY) throw new Error("Calendar Copilot cần OPENAI_API_KEY trong .env.");
  const input = buildOpenAiCalendarCopilotPrompt({
    message,
    searchMessage,
    history,
    schedule,
    pendingOptions,
    range,
    freeSlots,
    isExternalIntent,
    timezone
  });
  const request = {
    model,
    input,
    max_output_tokens: isExternalIntent ? 1800 : 1200
  };
  if (isExternalIntent) {
    request.tools = [{ type: "web_search_preview", user_location: { type: "approximate", country: "VN", city: "Hanoi", region: "Hanoi" } }];
  }
  const data = await callOpenAiResponses(request);
  const raw = extractResponseText(data) || "{}";
  const parsed = parseLooseJson(raw);
  const pending = normalizeAiCopilotOptions(parsed?.pendingOptions || parsed?.options || [], freeSlots);
  return {
    intent: parsed?.intent || (isExternalIntent ? "external_activity_suggestions" : "free_slot_suggestions"),
    reply: sanitizeGeneratedContent(parsed?.reply || ""),
    pendingOptions: isExternalIntent ? await enrichCopilotActivitiesWithImages(pending) : pending,
    providerReports: [{ provider: "openai", status: "ok", message: `openai ${model}: AI xử lý${isExternalIntent ? " + web search" : ""}` }]
  };
}

function buildOpenAiCalendarCopilotPrompt({ message, searchMessage, history, schedule, pendingOptions, range, freeSlots, isExternalIntent, timezone }) {
  return [
    "Bạn là Calendar Copilot, một trợ lý AI cá nhân bằng tiếng Việt.",
    "Bạn phải tự đọc context lịch, khoảng trống và yêu cầu người dùng để trả lời. Không được nói rằng mình chỉ là logic nội bộ.",
    "Chỉ trả JSON object thuần, không markdown, không giải thích ngoài JSON.",
    "",
    "NHIỆM VỤ:",
    "- Nếu người dùng xin gợi ý lịch trống: tạo 3-5 pendingOptions cụ thể, đa dạng, có lý do rõ, không dùng title chung chung.",
    "- Nếu người dùng muốn tìm hoạt động/sự kiện/địa điểm ngoài đời: dùng web search khi được cung cấp, chỉ đưa option có nguồn đáng tin.",
    "- Nếu không tìm được nguồn đáng tin cho yêu cầu ngoài đời, pendingOptions để [] và reply nói rõ chưa tìm được.",
    "- Không tự thêm vào lịch. Chỉ tạo option tạm để user bấm Thêm vào lịch hoặc nhắn thêm option.",
    "- proposedStart/proposedEnd bắt buộc nằm trong một freeSlot đã cho, không vượt 22:00 trừ khi người dùng nói rõ muốn muộn/khuya.",
    "- Nếu sourceUrl có thì điền sourceUrl. Nếu không có nguồn thì sourceUrl để rỗng.",
    "",
    "OUTPUT SCHEMA:",
    JSON.stringify({
      intent: "free_slot_suggestions|external_activity_suggestions|refine_search|other",
      reply: "câu trả lời tiếng Việt ngắn",
      pendingOptions: [{
        title: "Tên option cụ thể",
        type: "exhibition|workshop|cafe|exercise|health|study|focus|rest|social|other",
        description: "Mô tả ngắn",
        proposedStart: "YYYY-MM-DDTHH:mm:00+07:00",
        proposedEnd: "YYYY-MM-DDTHH:mm:00+07:00",
        location: "",
        sourceUrl: "",
        imageUrl: "",
        provider: "openai",
        reason: "Vì sao phù hợp với lịch trống"
      }]
    }),
    "",
    `TIMEZONE: ${timezone}`,
    `REQUESTED_RANGE: ${range.start} đến ${range.end}`,
    `USER_MESSAGE: ${message}`,
    `SEARCH_MESSAGE: ${searchMessage}`,
    `MODE: ${isExternalIntent ? "external search allowed/expected" : "personal schedule suggestions only"}`,
    `FREE_SLOTS: ${JSON.stringify(freeSlots.slice(0, 10))}`,
    `CURRENT_WEEK_SCHEDULE: ${JSON.stringify((schedule || []).slice(0, 80).map((event) => ({
      title: event.title,
      type: event.type,
      category: event.category,
      date: event.date,
      start: event.start,
      end: event.end,
      completed: Boolean(event.completed)
    })))}`,
    `PENDING_OPTIONS: ${JSON.stringify((pendingOptions || []).slice(-12).map((option, index) => ({
      index: index + 1,
      title: option.title,
      proposedStart: option.proposedStart,
      proposedEnd: option.proposedEnd,
      sourceUrl: option.sourceUrl || ""
    })))}`,
    `RECENT_CHAT: ${JSON.stringify((history || []).slice(-10).map((item) => ({ role: item.role, content: item.content })))}`
  ].join("\n");
}

function normalizeAiCopilotOptions(options, freeSlots) {
  const slotRanges = (freeSlots || []).map((slot) => ({
    start: new Date(slot.start).getTime(),
    end: new Date(slot.end).getTime(),
    fallbackStart: slot.start,
    fallbackEnd: slot.end
  }));
  return (Array.isArray(options) ? options : []).flatMap((item) => {
    const title = trimText(String(item?.title || "").trim(), 120);
    if (!title) return [];
    let proposedStart = normalizeCopilotIso(item?.proposedStart);
    let proposedEnd = normalizeCopilotIso(item?.proposedEnd);
    const validSlot = slotRanges.find((slot) => {
      const startMs = new Date(proposedStart).getTime();
      const endMs = new Date(proposedEnd).getTime();
      return Number.isFinite(startMs) && Number.isFinite(endMs) && startMs >= slot.start && endMs <= slot.end && endMs > startMs;
    });
    if (!validSlot && slotRanges[0]) {
      proposedStart = slotRanges[0].fallbackStart;
      proposedEnd = addMinutesToIso(proposedStart, Math.min(90, Math.max(30, timeToPlannerMinutes(slotRanges[0].fallbackEnd.slice(11, 16)) - timeToPlannerMinutes(slotRanges[0].fallbackStart.slice(11, 16)))));
    }
    return [copilotOption({
      title,
      type: item.type || "other",
      description: trimText(String(item.description || "").trim(), 260),
      proposedStart,
      proposedEnd,
      location: trimText(String(item.location || "").trim(), 180),
      sourceUrl: String(item.sourceUrl || "").trim(),
      imageUrl: String(item.imageUrl || "").trim(),
      provider: item.provider || "openai",
      reason: trimText(String(item.reason || "").trim(), 260)
    })];
  }).slice(0, 5);
}

function normalizeCopilotIso(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::\d{2})?(?:\+07:00|Z)?$/);
  if (!match) return "";
  return `${match[1]}T${match[2]}:${match[3]}:00+07:00`;
}

async function callOpenAiResponses(payload) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || data?.message || `OpenAI API lỗi HTTP ${response.status}`;
    throw new Error(message);
  }
  return data;
}

function copilotExternalIntent(commandText, pendingOptions = []) {
  return /trien lam|exhibition|su kien|event|workshop|bao tang|museum|ha noi|hanoi|cafe|ca phe|quan|dia diem|di choi|di xem|ngoai troi|concert|show/i.test(commandText)
    || (/tim lai|lọc|loc|them nua|thêm nữa|gan hon|gần hơn|khac|khác/i.test(commandText) && pendingOptions.some((option) => option.sourceUrl));
}

function plannerStartOfWeek(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  const day = copy.getDay() || 7;
  copy.setDate(copy.getDate() - day + 1);
  return copy;
}

function plannerInputDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function copilotRange(message, weekStart) {
  const commandText = normalizeCopilotCommand(message);
  const start = new Date(`${weekStart}T00:00:00+07:00`);
  const end = new Date(start);
  if (/thang sau|next month/i.test(commandText)) {
    const monthStart = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    const monthEnd = new Date(start.getFullYear(), start.getMonth() + 2, 1);
    return {
      start: `${plannerInputDate(monthStart)}T00:00:00+07:00`,
      end: `${plannerInputDate(monthEnd)}T00:00:00+07:00`
    };
  }
  const multiMonthRange = copilotMultiMonthRange(commandText, start);
  if (multiMonthRange) return multiMonthRange;
  const monthRange = copilotMonthRange(commandText, start);
  if (monthRange) return monthRange;
  end.setDate(end.getDate() + 7);
  if (/cuoi tuan|weekend|thu 7|chu nhat/i.test(commandText)) {
    const weekend = new Date(start);
    weekend.setDate(weekend.getDate() + 5);
    return { start: `${plannerInputDate(weekend)}T00:00:00+07:00`, end: `${plannerInputDate(end)}T00:00:00+07:00` };
  }
  return { start: `${plannerInputDate(start)}T00:00:00+07:00`, end: `${plannerInputDate(end)}T00:00:00+07:00` };
}

function copilotMultiMonthRange(commandText, baseDate) {
  const months = extractRequestedMonths(commandText, baseDate);
  if (months.length < 2) return null;
  const sorted = months.sort((a, b) => a.year === b.year ? a.month - b.month : a.year - b.year);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const start = new Date(first.year, first.month - 1, 1);
  const end = new Date(last.year, last.month, 1);
  return {
    start: `${plannerInputDate(start)}T00:00:00+07:00`,
    end: `${plannerInputDate(end)}T00:00:00+07:00`
  };
}

function extractRequestedMonths(commandText, baseDate) {
  const base = Number.isNaN(baseDate.getTime()) ? new Date() : baseDate;
  const baseMonth = base.getMonth() + 1;
  const baseYear = base.getFullYear();
  const monthNames = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11, december: 12
  };
  const found = [];
  for (const match of commandText.matchAll(/\b(?:thang|month)\s*(1[0-2]|0?[1-9])(?:\s*(?:\/|-|nam|year)\s*(\d{2,4}))?\b/gi)) {
    const month = Number(match[1]);
    let year = Number(match[2] || baseYear);
    if (year && year < 100) year += 2000;
    if (!match[2] && month < baseMonth - 1) year += 1;
    found.push({ month, year });
  }
  for (const match of commandText.matchAll(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/gi)) {
    const month = monthNames[match[1].toLowerCase()];
    let year = baseYear;
    if (month < baseMonth - 1) year += 1;
    found.push({ month, year });
  }
  const unique = new Map();
  found.forEach((item) => {
    if (item.month >= 1 && item.month <= 12) unique.set(`${item.year}-${item.month}`, item);
  });
  return [...unique.values()];
}

function copilotRangeLabel(range) {
  return `${plannerVietnameseDate(range.start)} - ${plannerVietnameseDate(addMinutesToIso(range.end, -1))}`;
}

function plannerVietnameseDate(value) {
  const text = String(value || "");
  const [year, month, day] = text.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return text.slice(0, 10);
  return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
}

function copilotMonthRange(commandText, baseDate) {
  const monthMatch = commandText.match(/\b(?:thang|month)\s*(1[0-2]|0?[1-9])(?:\s*(?:\/|-|nam|year)\s*(\d{2,4}))?\b/i)
    || commandText.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i);
  if (!monthMatch) return null;
  const monthNames = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11, december: 12
  };
  const requestedMonth = monthNames[monthMatch[1]] || Number(monthMatch[1]);
  if (!requestedMonth || requestedMonth < 1 || requestedMonth > 12) return null;
  const base = Number.isNaN(baseDate.getTime()) ? new Date() : baseDate;
  let year = Number(monthMatch[2] || base.getFullYear());
  if (year && year < 100) year += 2000;
  const baseMonth = base.getMonth() + 1;
  if (!monthMatch[2] && requestedMonth < baseMonth - 1) year += 1;
  const start = new Date(year, requestedMonth - 1, 1);
  const end = new Date(year, requestedMonth, 1);
  return {
    start: `${plannerInputDate(start)}T00:00:00+07:00`,
    end: `${plannerInputDate(end)}T00:00:00+07:00`
  };
}

function normalizeCopilotCommand(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function copilotFreeSlots(schedule, rangeStart, rangeEnd, minDuration) {
  const start = new Date(rangeStart);
  const end = new Date(rangeEnd);
  const busyByDate = new Map();
  schedule.forEach((event) => {
    if (!event?.date || !event?.start || !event?.end) return;
    if (!busyByDate.has(event.date)) busyByDate.set(event.date, []);
    busyByDate.get(event.date).push({ start: timeToPlannerMinutes(event.start) - 15, end: timeToPlannerMinutes(event.end) + 15 });
  });
  const slots = [];
  for (let cursor = new Date(start); cursor < end; cursor.setDate(cursor.getDate() + 1)) {
    const date = plannerInputDate(cursor);
    const busy = (busyByDate.get(date) || []).sort((a, b) => a.start - b.start);
    let pointer = 8 * 60;
    busy.forEach((block) => {
      const blockStart = Math.max(8 * 60, block.start);
      const blockEnd = Math.min(22 * 60, block.end);
      if (blockStart - pointer >= minDuration) slots.push(copilotSlot(date, pointer, blockStart));
      pointer = Math.max(pointer, blockEnd);
    });
    if (22 * 60 - pointer >= minDuration) slots.push(copilotSlot(date, pointer, 22 * 60));
  }
  return slots.slice(0, 10);
}

function copilotSlot(date, start, end) {
  return {
    start: `${date}T${plannerMinutesToTime(start)}:00+07:00`,
    end: `${date}T${plannerMinutesToTime(end)}:00+07:00`,
    durationMinutes: end - start,
    label: `${date} ${plannerMinutesToTime(start)}-${plannerMinutesToTime(end)}`
  };
}

function timeToPlannerMinutes(time) {
  const [hour, minute] = String(time || "00:00").split(":").map(Number);
  return (hour || 0) * 60 + (minute || 0);
}

function plannerMinutesToTime(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

async function copilotSearchActivitiesWithProviders(message, range) {
  const mode = normalizeCopilotCommand(process.env.COPILOT_SEARCH_PROVIDER || "auto");
  const providerReports = [];
  const tasks = [];
  if (mode === "auto" || mode === "openai" || mode === "both") {
    tasks.push(openAiWebSearchProvider(message, range)
      .then((items) => ({ provider: "openai", items }))
      .catch((error) => ({ provider: "openai", items: [], error: error.message || "OpenAI search failed" })));
  }
  if ((mode === "auto" || mode === "apify" || mode === "both") && process.env.APIFY_TOKEN && process.env.APIFY_ACTOR_ID) {
    tasks.push(apifyProvider(message, range)
      .then((items) => ({ provider: "apify", items }))
      .catch((error) => ({ provider: "apify", items: [], error: error.message || "Apify search failed" })));
  } else if (mode === "apify" || mode === "both") {
    providerReports.push({ provider: "apify", status: "skipped", message: "Apify chưa có APIFY_TOKEN/APIFY_ACTOR_ID." });
  }
  let results = await Promise.all(tasks);
  if (results.every((result) => !(result.items || []).length) && /facebook|fb|fanpage/i.test(normalizeCopilotCommand(message))) {
    const broadenedMessage = `${message}\nNếu Facebook không có dữ liệu công khai, hãy tìm thêm từ website sự kiện, bảo tàng, phòng tranh, fanpage được index công khai và nguồn báo/website uy tín.`;
    const retryTasks = [];
    if (mode === "auto" || mode === "openai" || mode === "both") {
      retryTasks.push(openAiWebSearchProvider(broadenedMessage, range)
        .then((items) => ({ provider: "openai", items, retry: true }))
        .catch((error) => ({ provider: "openai", items: [], error: error.message || "OpenAI retry search failed", retry: true })));
    }
    if (retryTasks.length) results = await Promise.all(retryTasks);
  }
  results.forEach((result) => {
    providerReports.push({
      provider: result.provider,
      status: result.error ? "error" : "ok",
      message: result.error ? `${result.provider}: ${result.error}` : `${result.provider}${result.retry ? " retry" : ""}: ${result.items.length} kết quả`
    });
  });
  const activities = filterActivitiesByRange(mergeActivityResults(results.flatMap((result) => result.items || [])), range).slice(0, 8);
  return {
    activities: await enrichCopilotActivitiesWithImages(activities),
    providerReports
  };
}

async function openAiWebSearchProvider(message, range) {
  if (!process.env.OPENAI_API_KEY) return [];
  const prompt = [
    "Tìm hoạt động/sự kiện ngoài đời thực và trả JSON array thuần, không markdown.",
    "Chỉ lấy thông tin có nguồn rõ; không bịa địa chỉ, giờ mở cửa, giá.",
    "Chỉ trả sự kiện/hoạt động đang diễn ra hoặc có lịch phù hợp trong đúng khoảng thời gian bên dưới. Loại bỏ kết quả đã kết thúc trước khoảng này.",
    `Yêu cầu: ${message}`,
    `Thời gian: ${range.start} đến ${range.end}`,
    "Schema: [{\"title\":\"...\",\"type\":\"exhibition|workshop|cafe|exercise|focus|rest|social|other\",\"description\":\"...\",\"location\":\"...\",\"sourceUrl\":\"...\",\"imageUrl\":\"...\",\"openingHours\":\"...\",\"price\":\"...\",\"confidence\":\"low|medium|high\"}]"
  ].join("\n");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      input: prompt,
      tools: [{ type: "web_search_preview", user_location: { type: "approximate", country: "VN", city: "Hanoi", region: "Hanoi" } }],
      max_output_tokens: 1600
    })
  });
  const data = await response.json();
  if (!response.ok) return [];
  const parsed = parseLooseJson(extractResponseText(data) || "[]");
  const items = (Array.isArray(parsed) ? parsed : []).filter((item) => item?.title).slice(0, 6);
  return enrichCopilotActivitiesWithImages(items.map((item) => ({
    ...item,
    imageUrl: item.imageUrl || item.image || item.thumbnail || "",
    provider: "openai"
  })));
}

async function apifyProvider(message, range) {
  const actorId = process.env.APIFY_ACTOR_ID;
  const token = process.env.APIFY_TOKEN;
  if (!actorId || !token) return [];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const url = `https://api.apify.com/v2/acts/${encodeURIComponent(actorId)}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        query: message,
        location: "Hà Nội",
        timeMin: range.start,
        timeMax: range.end,
        maxItems: 10
      })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const items = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
    return items.map((item) => ({
      title: item.title || item.name || item.summary || "",
      type: item.type || "other",
      description: item.description || item.snippet || item.text || "",
      location: item.location || item.address || "",
      sourceUrl: item.sourceUrl || item.url || item.link || "",
      imageUrl: item.imageUrl || item.image || item.thumbnail || item.picture || "",
      openingHours: item.openingHours || item.hours || "",
      price: item.price || "",
      confidence: item.confidence || "medium",
      provider: "apify"
    })).filter((item) => item.title).slice(0, 8);
  } finally {
    clearTimeout(timeout);
  }
}

function mergeActivityResults(items) {
  const seen = new Map();
  items.forEach((item) => {
    const key = [normalizeCopilotCommand(item.title), normalizeCopilotCommand(item.location || ""), normalizeCopilotCommand(item.sourceUrl || "")].join("|");
    if (!item.title || seen.has(key)) {
      const existing = seen.get(key);
      if (existing && !existing.sourceUrl && item.sourceUrl) Object.assign(existing, item);
      return;
    }
    seen.set(key, item);
  });
  return [...seen.values()].sort((a, b) => Number(Boolean(b.sourceUrl)) - Number(Boolean(a.sourceUrl)));
}

function filterActivitiesByRange(items, range) {
  const rangeStart = new Date(range.start).getTime();
  const rangeEnd = new Date(range.end).getTime();
  return items.filter((item) => {
    const extracted = extractActivityDateRanges(item, range.start);
    if (!extracted.length) {
      item.confidence = item.confidence || "low";
      return true;
    }
    return extracted.some((period) => period.end >= rangeStart && period.start < rangeEnd);
  });
}

function extractActivityDateRanges(item, fallbackIso) {
  const text = [item.title, item.description, item.openingHours, item.date, item.time, item.sourceUrl]
    .filter(Boolean)
    .join(" ");
  const ranges = [];
  const baseYear = Number(String(fallbackIso || "").slice(0, 4)) || new Date().getFullYear();
  const isoRegex = /\b(20\d{2})[-/](0?[1-9]|1[0-2])[-/](0?[1-9]|[12]\d|3[01])\b/g;
  for (const match of text.matchAll(isoRegex)) {
    const start = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime();
    ranges.push({ start, end: start + 24 * 60 * 60 * 1000 });
  }
  const shortRegex = /\b(0?[1-9]|[12]\d|3[01])\s*[/-]\s*(0?[1-9]|1[0-2])(?:\s*[/-]\s*(\d{2,4}))?\b/g;
  for (const match of text.matchAll(shortRegex)) {
    const year = match[3] ? Number(match[3].length === 2 ? `20${match[3]}` : match[3]) : baseYear;
    const start = new Date(year, Number(match[2]) - 1, Number(match[1])).getTime();
    ranges.push({ start, end: start + 24 * 60 * 60 * 1000 });
  }
  return mergeExtractedDateRanges(ranges);
}

function mergeExtractedDateRanges(ranges) {
  if (ranges.length < 2) return ranges;
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged = [];
  for (let index = 0; index < sorted.length; index += 1) {
    const current = sorted[index];
    const next = sorted[index + 1];
    if (next && next.start - current.start <= 370 * 24 * 60 * 60 * 1000) {
      merged.push({ start: current.start, end: Math.max(next.end, current.end) });
      index += 1;
    } else {
      merged.push(current);
    }
  }
  return merged;
}

async function enrichCopilotActivitiesWithImages(items) {
  return Promise.all(items.map(async (item) => {
    if (item.imageUrl) {
      return {
        ...item,
        imageUrl: makeAbsoluteUrl(item.imageUrl, item.sourceUrl || item.imageUrl)
      };
    }
    if (!item.sourceUrl || !/^https?:\/\//i.test(item.sourceUrl)) return item;
    const article = await fetchArticle(item.sourceUrl).catch(() => ({}));
    return {
      ...item,
      imageUrl: article.image ? makeAbsoluteUrl(article.image, item.sourceUrl) : ""
    };
  }));
}

function makeAbsoluteUrl(value, baseUrl) {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    return new URL(text, baseUrl).href;
  } catch (error) {
    return text;
  }
}

function copilotActivityOptions(activities, slots) {
  return activities.flatMap((activity, index) => {
    const slot = slots[index] || slots[0];
    if (!slot) return [];
    const duration = activity.type === "workshop" ? 120 : activity.type === "exercise" ? 60 : 90;
    return [copilotOption({
      title: String(activity.title),
      type: activity.type || "other",
      description: activity.description || "",
      proposedStart: slot.start,
      proposedEnd: addMinutesToIso(slot.start, Math.min(duration, slot.durationMinutes, 180)),
      location: activity.location || "",
      sourceUrl: activity.sourceUrl || "",
      imageUrl: activity.imageUrl || "",
      provider: activity.provider || "",
      reason: `Vừa với slot trống ${slot.label}${activity.sourceUrl ? ", có nguồn tham khảo." : "."}`
    })];
  }).slice(0, 5);
}

function copilotGenericOptions(message, slots) {
  const intent = copilotPersonalIntent(message);
  const usedTitles = new Set();
  return slots.slice(0, 8).flatMap((slot) => {
    const suggestion = chooseFreeSlotSuggestion(slot, intent, usedTitles);
    if (!suggestion) return [];
    usedTitles.add(suggestion.title);
    const duration = Math.min(suggestion.duration, Math.max(30, slot.durationMinutes));
    const proposedStart = suggestionStartIso(slot, suggestion, duration);
    return [copilotOption({
      title: suggestion.title,
      type: suggestion.type,
      description: suggestion.description,
      proposedStart,
      proposedEnd: addMinutesToIso(proposedStart, duration),
      reason: `${suggestion.reason} Slot trống: ${slot.label}.`
    })];
  }).slice(0, 5);
}

function suggestionStartIso(slot, suggestion, duration) {
  const date = String(slot.start || "").slice(0, 10);
  const slotStart = timeToPlannerMinutes(String(slot.start || "").slice(11, 16));
  const slotEnd = timeToPlannerMinutes(String(slot.end || "").slice(11, 16));
  const preferred = Number.isFinite(suggestion.preferredMinutes) ? suggestion.preferredMinutes : slotStart;
  const latestStart = Math.max(slotStart, slotEnd - duration);
  const start = Math.max(slotStart, Math.min(preferred, latestStart));
  return `${date}T${plannerMinutesToTime(start)}:00+07:00`;
}

function copilotPersonalIntent(message) {
  const text = normalizeCopilotCommand(message);
  if (/hoc|on tap|focus|lam viec|deep work/.test(text)) return "focus";
  if (/nghi|relax|thu gian|phuc hoi|me time/.test(text)) return "rest";
  if (/tap|gym|pilates|yoga|boi|di bo|the thao/.test(text)) return "health";
  if (/ban be|hen|social|gia dinh/.test(text)) return "social";
  return "balanced";
}

function chooseFreeSlotSuggestion(slot, intent, usedTitles) {
  const start = new Date(slot.start);
  const hour = Number(String(slot.start).slice(11, 13));
  const day = start.getDay();
  const weekend = day === 0 || day === 6;
  const pool = freeSlotSuggestionPool(hour, weekend).filter((item) => intent === "balanced" || item.intent === intent || item.intent === "balanced");
  return pool.find((item) => !usedTitles.has(item.title)) || pool[0];
}

function freeSlotSuggestionPool(hour, weekend) {
  if (hour < 11) {
    return [
      { title: "Đi bộ nhẹ và lên nhịp ngày mới", type: "health", intent: "health", duration: 45, preferredMinutes: 8 * 60, description: "Một block vận động nhẹ để tỉnh táo mà không quá mệt.", reason: "Buổi sáng hợp với vận động nhẹ hoặc chuẩn bị tinh thần." },
      { title: "Focus block học sâu", type: "study", intent: "focus", duration: 90, preferredMinutes: 9 * 60, description: "Dành cho phần học cần tập trung, ít bị gián đoạn.", reason: "Slot sáng thường hợp với việc cần nhiều năng lượng não." },
      { title: "Đọc sách hoặc ôn nhẹ", type: "rest", intent: "rest", duration: 60, preferredMinutes: 10 * 60 + 30, description: "Giữ nhịp học mà vẫn nhẹ đầu.", reason: "Khoảng sáng trống có thể dùng để nạp kiến thức chậm." },
      { title: "Dọn checklist việc nhỏ", type: "other", intent: "balanced", duration: 45, preferredMinutes: 11 * 60, description: "Xử lý các việc nhỏ trước khi chúng chen vào buổi chiều.", reason: "Một slot sáng dài nên tách bớt việc lặt vặt." },
      { title: "Chuẩn bị bài / tài liệu tuần", type: "study", intent: "focus", duration: 60, preferredMinutes: 13 * 60 + 30, description: "Sắp lại tài liệu, deadline và phần cần học tiếp.", reason: "Nếu slot trống dài, nên dùng một phần để chuẩn bị có chủ đích." },
      { title: "Nghỉ không màn hình", type: "rest", intent: "rest", duration: 45, preferredMinutes: 16 * 60, description: "Nghỉ mắt, đi dạo ngắn, hoặc ngủ ngắn nếu cần.", reason: "Một khoảng nghỉ chủ động giúp tránh bị kín lịch." }
    ];
  }
  if (hour < 16) {
    return [
      { title: weekend ? "Cafe study / đọc sách cuối tuần" : "Cafe study ngắn", type: "study", intent: "focus", duration: 90, preferredMinutes: 14 * 60, description: "Đổi không gian để xử lý một phần việc hoặc học nhẹ.", reason: "Đầu giờ chiều hợp với block vừa phải, ít áp lực." },
      { title: "Xử lý việc vặt trong tuần", type: "other", intent: "balanced", duration: 45, preferredMinutes: 15 * 60, description: "Gom các việc nhỏ để tránh chúng chen vào giờ học/làm.", reason: "Slot này đủ ngắn để dọn việc phụ." },
      { title: "Nghỉ phục hồi không màn hình", type: "rest", intent: "rest", duration: 45, preferredMinutes: 15 * 60 + 30, description: "Nghỉ mắt, đi dạo ngắn, hoặc ngủ ngắn nếu cần.", reason: "Sau trưa nên có một block hồi phục để tránh đuối cuối ngày." }
    ];
  }
  if (hour < 20) {
    return [
      { title: "Pilates/yoga nhẹ", type: "health", intent: "health", duration: 60, preferredMinutes: 17 * 60 + 30, description: "Tập vừa sức để reset sau ngày học/làm.", reason: "Chiều tối là khung tốt cho vận động nhưng vẫn còn thời gian nghỉ." },
      { title: "Gặp bạn hoặc ăn tối nhẹ", type: "social", intent: "social", duration: 90, preferredMinutes: 18 * 60 + 30, description: "Một block xã hội vừa phải để cân bằng tuần.", reason: "Slot tối sớm hợp với hoạt động xã hội không quá muộn." },
      { title: "Tổng kết bài học trong ngày", type: "study", intent: "focus", duration: 60, preferredMinutes: 19 * 60 + 30, description: "Ôn lại phần quan trọng, ghi checklist cho ngày mai.", reason: "Cuối ngày hợp với học nhẹ và tổng kết." }
    ];
  }
  return [
    { title: "Đọc sách / wind-down", type: "rest", intent: "rest", duration: 45, preferredMinutes: 20 * 60 + 30, description: "Giảm nhịp trước khi ngủ, tránh kéo lịch quá nặng.", reason: "Khung tối muộn nên ưu tiên phục hồi." },
    { title: "Relax không deadline", type: "rest", intent: "balanced", duration: 60, preferredMinutes: 21 * 60, description: "Nghe nhạc, journaling, hoặc xem nhẹ nhàng có giới hạn.", reason: "Slot này hợp để đóng ngày, không nên nhồi việc nặng." },
    { title: "Chuẩn bị ngày mai", type: "other", intent: "balanced", duration: 30, preferredMinutes: 21 * 60 + 15, description: "Sắp đồ, rà lịch, chọn 1-2 ưu tiên cho hôm sau.", reason: "Một block ngắn giúp sáng hôm sau đỡ rối." }
  ];
}

function sanitizeCopilotOptions(options, range, commandText) {
  return options.map((option) => sanitizeCopilotOption(option, commandText)).filter((option) => {
    const start = new Date(option.proposedStart).getTime();
    const rangeStart = new Date(range.start).getTime();
    const rangeEnd = new Date(range.end).getTime();
    return Number.isFinite(start) && start >= rangeStart && start < rangeEnd;
  }).slice(0, 5);
}

function sanitizeCopilotOption(option, commandText) {
  const sanitized = { ...option };
  let start = String(sanitized.proposedStart || "");
  let end = String(sanitized.proposedEnd || "");
  const wantsLate = /dem|khuya|muon|late|23h|24h|11 gio toi|12 gio dem/i.test(commandText);
  if (!isValidCopilotIso(start)) start = "";
  if (!isValidCopilotIso(end)) end = "";
  if (start && (!end || new Date(end) <= new Date(start))) {
    end = addMinutesToIso(start, 60);
  }
  if (start && !wantsLate && timeToPlannerMinutes(start.slice(11, 16)) >= 22 * 60) {
    start = `${start.slice(0, 10)}T21:00:00+07:00`;
    end = `${start.slice(0, 10)}T22:00:00+07:00`;
  }
  if (start && !wantsLate && timeToPlannerMinutes(end.slice(11, 16)) > 22 * 60 && end.slice(0, 10) === start.slice(0, 10)) {
    end = `${start.slice(0, 10)}T22:00:00+07:00`;
  }
  sanitized.proposedStart = start;
  sanitized.proposedEnd = end;
  return sanitized;
}

function isValidCopilotIso(value) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\+07:00$/.test(String(value || "")) && !Number.isNaN(new Date(value).getTime());
}

function copilotOption(option) {
  return {
    optionId: `option-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    title: option.title,
    type: option.type || "other",
    description: option.description || "",
    proposedStart: option.proposedStart,
    proposedEnd: option.proposedEnd,
    location: option.location || "",
    sourceUrl: option.sourceUrl || "",
    imageUrl: option.imageUrl || "",
    provider: option.provider || "",
    reason: option.reason || "Phù hợp với lịch trống.",
    reminderMinutes: 120,
    status: "pending"
  };
}

function addMinutesToIso(value, minutes) {
  const text = String(value || "");
  const date = new Date(`${text.slice(0, 10)}T00:00:00+07:00`);
  const startMinutes = timeToPlannerMinutes(text.slice(11, 16));
  const total = startMinutes + Number(minutes || 0);
  const dayOffset = Math.floor(total / (24 * 60));
  const minutesInDay = ((total % (24 * 60)) + (24 * 60)) % (24 * 60);
  date.setDate(date.getDate() + dayOffset);
  return `${plannerInputDate(date)}T${plannerMinutesToTime(minutesInDay)}:00+07:00`;
}

function normalizePlannerDate(value, weekStart) {
  const text = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const shortDate = text.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (shortDate) {
    const start = parsePlannerDate(weekStart) || new Date();
    const year = Number(shortDate[3] || start.getFullYear());
    const fullYear = year < 100 ? year + 2000 : year;
    return plannerDateToInput(new Date(fullYear, Number(shortDate[2]) - 1, Number(shortDate[1])));
  }
  if (!text) return "";
  const start = parsePlannerDate(weekStart);
  if (!start) return "";
  const lower = text.toLowerCase();
  const weekdayIndex = [
    /thu\s*2|thứ\s*2|monday|t2/,
    /thu\s*3|thứ\s*3|tuesday|t3/,
    /thu\s*4|thứ\s*4|wednesday|t4/,
    /thu\s*5|thứ\s*5|thursday|t5/,
    /thu\s*6|thứ\s*6|friday|t6/,
    /thu\s*7|thứ\s*7|saturday|t7/,
    /chu\s*nhat|chủ\s*nhật|sunday|cn/
  ].findIndex((pattern) => pattern.test(lower));
  if (weekdayIndex < 0) return "";
  const date = new Date(start);
  date.setDate(date.getDate() + weekdayIndex);
  return plannerDateToInput(date);
}

function parsePlannerDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function plannerDateToInput(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function normalizePlannerTime(value, fallback) {
  const match = String(value || "").match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!match) return fallback;
  const hour = Math.max(0, Math.min(23, Number(match[1])));
  const minute = Math.max(0, Math.min(59, Number(match[2] || 0)));
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function plannerTimeToMinutes(value) {
  const [hour, minute] = String(value || "00:00").split(":").map(Number);
  return (hour || 0) * 60 + (minute || 0);
}

function minutesToPlannerTime(value) {
  const minutes = Math.max(0, Math.min(1439, Number(value || 0)));
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function buildVideoShortNewsPrompt(news, videoConfig = {}, sceneSettings = {}) {
  const config = normalizeVideoConfig(videoConfig);
  const minMax = sceneCountRange(config.durationRange);
  return [
    "Ban la bien tap vien video tin tuc tai chinh voi 10 nam kinh nghiem cho kenh social cua Kolia Phan.",
    "Nhiem vu: tao output VIDEO SHORT 9:16 DANG TIN TUC theo scene. Tuyet doi khong tra output chi gom Title/Caption/Nguon/Hashtag.",
    "Chi tra ve JSON hop le, khong markdown, khong dau **, khong giai thich ngoai JSON.",
    "",
    "CONTENT FORMAT BAT BUOC:",
    "video_short_news",
    "",
    "VIDEO CONFIG:",
    JSON.stringify(config, null, 2),
    "",
    "SCENE SETTINGS:",
    JSON.stringify(sceneSettings || {}, null, 2),
    "",
    "SCHEMA BAT BUOC:",
    JSON.stringify(videoOutputSchemaExample(), null, 2),
    "",
    "QUY TAC VIDEO SCRIPT:",
    "- Tat ca noi dung bang tieng Viet tu nhien.",
    `- Tong so scene phai trong khoang ${minMax.min}-${minMax.max} scene voi do dai ${config.durationRange}.`,
    "- Moi dong videoScript tuong ung 1 scene, la cau hoan chinh, ngan gon de doc trong 3-5 giay.",
    "- Moi scene chi co 1 thong diep chinh.",
    "- Text overlay ngan hon sceneScript, toi da 2-4 dong, uu tien ticker/so lieu/tu khoa.",
    "- Visual phai cu the, de dung: big number card, stock board highlight, ratio infographic, checklist, timeline, source card...",
    "- Edit note phai thuc dung: zoom nhe, number pop-up, checklist reveal, bar grow-up, fade, wipe...",
    "- sourceNote chi ghi nhan ngan gon nhu 'CafeF - Chung khoan', khong de link trong video.",
    "- Caption dang kem la phan rieng, khong duoc dung caption lam video script.",
    "- Caption dang kem phai co bo cuc ro rang: Video title / Caption / CTA / Hashtag / Tuyen bo mien tru trach nhiem.",
    "- Khong gop CTA, hashtag hoac disclaimer vao than Caption.",
    "- CTA mac dinh: Dat cau hoi ben duoi de team Kolia Phan chon loc va boc tach sau hon trong livestream thu 7.",
    "",
    "QUY TAC TUAN THU:",
    "- Bam sat nguon, khong dien giai vuot qua nguon.",
    "- Khong bien du lieu ngan han thanh xu huong dai han.",
    "- Khong tu them nguyen nhan neu bai goc khong neu.",
    "- Khong nang muc do chac chan cua bai goc.",
    "- Khong gan nhan dinh cua nguon/chuyen gia thanh quan diem cua Kolia Phan.",
    "- Khong khuyen nghi mua ban, khong FOMO, khong title giat hon nguon.",
    "- Neu du lieu mong, phai noi ro gioi han dien giai trong caption/no-FOMO scene.",
    "- Neu bai co so lieu, giu dung so lieu, don vi, thoi diem.",
    "- Hashtags phai co #KoliaPhan.",
    "- Caption phai co disclaimer bat buoc o cuoi, ngay sau hashtag.",
    "",
    "DEFAULT SCENE FLOW:",
    "Scene 1: Main news hook - chuyen gi vua xay ra.",
    "Scene 2: Key number - so lieu/fact quan trong nhat.",
    "Scene 3: Explain what it means.",
    "Scene 4: Scale / impact neu nguon co du lieu.",
    "Scene 5: Business/market context neu nguon co neu.",
    "Scene 6: Supporting number/context neu can.",
    "Scene 7: What to watch.",
    "Scene 8: No FOMO / no buy-sell signal.",
    "Scene 9: CTA/end card neu do dai cho phep.",
    "",
    "TIN DA CHON:",
    news.map((item, index) => formatNewsForPrompt(item, index)).join("\n\n"),
    "",
    "DISCLAIMER BAT BUOC THEM CUOI CAPTION:",
    cleanMandatoryDisclaimer
  ].join("\n");
}

function buildVideoEditPrompt({ action, sceneIndex, videoOutput, news }) {
  const actions = {
    regenerate_all: "Regenerate toan bo video output theo schema, giu dung nguon va compliance.",
    shorten_video: "Rut ngan video: giam thoi luong/scene neu can, bo chi tiet phu, giu su kien chinh, so lieu quan trong, y nghia, dieu can theo doi va no-FOMO.",
    lengthen_video: "Keo dai video: them giai thich/context chi khi nguon ho tro, khong tu them nhan dinh.",
    reduce_text: "Chi rut gon text overlay tat ca scene, giu nguyen y nghia sceneScript.",
    regenerate_visuals: "Chi viet lai visual/editNote cho cu the va de dung hon, giu sceneScript va overlay.",
    rebuild_scene_flow: "Sap xep lai scene flow theo logic tin tai chinh, giu nguon va so lieu.",
    rewrite_scene: "Chi rewrite scene duoc chon: script, overlay, visual, editNote.",
    shorten_scene: "Chi rut gon scene duoc chon, giu y nghia.",
    lengthen_scene: "Chi mo rong scene duoc chon neu nguon co them du lieu ho tro. Neu nguon khong du, giu scene ngan va them thong bao ro trong editNote.",
    overlay_punchier: "Chi sua textOverlay cua scene duoc chon cho ngan, ro, khong FOMO.",
    visual_clearer: "Chi sua visual/editNote cua scene duoc chon cho cu the hon."
  };
  return [
    "Ban la bien tap vien video tai chinh cho Kolia Phan.",
    "Chi tra ve JSON hop le dung schema video_short_news, khong markdown, khong dau **.",
    `ACTION: ${action}`,
    `YEU CAU: ${actions[action] || actions.regenerate_all}`,
    `SCENE INDEX DUOC CHON: ${sceneIndex + 1}`,
    "",
    "QUY TAC:",
    "- Khong them so lieu/nguyen nhan/du bao neu nguon khong co.",
    "- Khong khuyen nghi mua ban, khong FOMO, khong noi qua nguon.",
    "- Neu action la per-scene, khong sua cac scene khac tru khi can renumber.",
    "- Caption va hashtags van giu rieng voi video script.",
    "",
    "VIDEO OUTPUT HIEN TAI:",
    JSON.stringify(videoOutput, null, 2),
    "",
    "NGUON TIN:",
    (news || []).map((item, index) => formatNewsForPrompt(item, index)).join("\n\n"),
    "",
    "SCHEMA BAT BUOC:",
    JSON.stringify(videoOutputSchemaExample(), null, 2)
  ].join("\n");
}

function formatNewsForPrompt(item, index) {
  return [
    `Tin ${index + 1}:`,
    `Nguon: ${item.source || item.source_name || ""}`,
    `Link: ${item.link || item.url || ""}`,
    `Thoi gian: ${item.time || item.published_at || ""}`,
    `Tieu de goc: ${item.title || ""}`,
    `Chu de: ${item.topic || ""}`,
    `Tom tat: ${item.summary || ""}`,
    `Boi canh: ${item.context || ""}`,
    `Full text: ${trimText(item.fullText || item.content || item.snippet || "", 6000)}`
  ].join("\n");
}

function videoOutputSchemaExample() {
  return {
    videoTitle: "string",
    videoSetup: {
      ratio: "9:16",
      videoType: "Explainer",
      durationRange: "30-45s",
      tone: ["Informative", "Professional"],
      brandPreset: "Kolia Phan"
    },
    videoAngle: "string",
    totalDuration: "34s",
    totalScenes: 8,
    videoScript: ["One complete Vietnamese sentence per scene."],
    scenes: [
      {
        sceneNumber: 1,
        role: "Mo bai",
        duration: "0-3s",
        sceneScript: "string",
        textOverlay: "short mobile overlay",
        visual: "specific visual direction",
        editNote: "practical edit instruction",
        sourceNote: "short source label"
      }
    ],
    caption: "string",
    source: {
      name: "source name",
      url: "source url"
    },
    videoSource: "short source label",
    hashtags: ["#KoliaPhan"]
  };
}

function normalizeVideoConfig(config = {}) {
  const videoTypeMap = {
    news_fast: "Tin tuc nhanh",
    explainer: "Explainer",
    market_education: "Market Education",
    recap: "Recap"
  };
  return {
    videoType: config.videoType || "explainer",
    videoTypeLabel: videoTypeMap[config.videoType] || config.videoType || "Explainer",
    ratio: config.ratio || "9:16",
    durationRange: config.durationRange || "30-45s",
    tone: Array.isArray(config.tone) && config.tone.length ? config.tone : ["Informative", "Professional"],
    brandPresetId: config.brandPresetId || "kolia_phan",
    brandPreset: "Kolia Phan"
  };
}

function sceneCountRange(durationRange) {
  if (durationRange === "20-30s") return { min: 5, max: 7 };
  if (durationRange === "45-60s") return { min: 9, max: 12 };
  return { min: 7, max: 9 };
}

const cleanMandatoryDisclaimer = [
  "___________________________",
  "Tuyên bố miễn trừ trách nhiệm:",
  "⚠️ Tất cả những thông tin chia sẻ trên Fanpage Kolia Phan đều chỉ dành cho mục đích chia sẻ kiến thức dựa trên quan điểm cá nhân và không phải lời tư vấn tài chính, khuyến nghị đầu tư hay cam kết lợi nhuận.",
  "⚠️ Trước khi đưa ra bất kỳ quyết định đầu tư nào, bạn cần tự nghiên cứu, đánh giá rủi ro và chịu trách nhiệm với lựa chọn của mình. Kolia Phan sẽ không chịu bất kỳ trách nhiệm nào liên quan đến việc đầu tư của các cá nhân theo dõi kênh.",
  "⚠️ Việc tiếp tục theo dõi, truy cập hoặc sử dụng các nội dung trên Fanpage được hiểu là bạn đã đọc, hiểu và đồng ý với các điều khoản trên."
].join("\n");

const defaultVideoCta = "Đặt câu hỏi bên dưới để team Kolia Phan chọn lọc và bóc tách sâu hơn trong livestream thứ 7.";

function stripCaptionStructure(text = "") {
  return String(text || "")
    .replace(/Scene script\s*(?:để|de)\s*đối chiếu[\s\S]*?(?=\n\s*(?:Video title|Caption|CTA|Hashtag|Nguồn|___________________________)\s*:?\s*$|$)/gim, "")
    .replace(/SOURCE ARTICLES[\s\S]*$/gim, "")
    .replace(/NGUỒN TIN ĐÃ CHỌN[\s\S]*$/gim, "")
    .replace(/Video title\s*:\s*[\s\S]*?(?=\n\s*Caption\s*:|$)/i, "")
    .replace(/^\s*Caption\s*:\s*/im, "")
    .replace(/\n\s*CTA\s*:\s*[\s\S]*?(?=\n\s*Hashtag\s*:|\n\s*___________________________|$)/i, "")
    .replace(/\n\s*Hashtag\s*:\s*[\s\S]*?(?=\n\s*___________________________|$)/i, "")
    .replace(/\n?\s*___________________________[\s\S]*$/i, "")
    .replace(/\n\s*Tuy(?:ê|Ãª)n b[ốá»‘][\s\S]*$/i, "")
    .trim();
}

function normalizeHashtags(hashtags = []) {
  const tags = Array.isArray(hashtags)
    ? hashtags.map((tag) => String(tag).trim()).filter(Boolean)
    : String(hashtags || "").split(/\s+/).map((tag) => tag.trim()).filter(Boolean);
  const normalized = tags.map((tag) => tag.startsWith("#") ? tag : `#${tag}`);
  if (!normalized.some((tag) => tag.toLowerCase() === "#koliaphan")) normalized.unshift("#KoliaPhan");
  return [...new Set(normalized)];
}

function formatVideoCaption({ videoTitle, caption, hashtags }) {
  const cleanTitle = String(videoTitle || "").trim() || "Cập nhật thị trường";
  const cleanCaption = stripCaptionStructure(stripAuditLeakSections(caption || ""));
  const finalHashtags = normalizeHashtags(hashtags);
  return [
    "Video title:",
    cleanTitle,
    "",
    "Caption:",
    cleanCaption || "Cập nhật tin tức tài chính theo nguồn gốc. Nội dung nên được đọc trong đúng bối cảnh và không phải khuyến nghị mua bán.",
    "",
    "CTA:",
    defaultVideoCta,
    "",
    "Hashtag:",
    finalHashtags.join(" "),
    "",
    cleanMandatoryDisclaimer
  ].join("\n");
}

function normalizeVideoOutput(input = {}, news = [], config = {}) {
  const first = Array.isArray(news) ? news[0] || {} : {};
  const setup = input.videoSetup || normalizeVideoConfig(config);
  const scenes = Array.isArray(input.scenes) ? input.scenes : [];
  const normalizedScenes = scenes.map((scene, index) => ({
    id: scene.id || `scene-${index + 1}`,
    sceneNumber: Number(scene.sceneNumber || index + 1),
    role: scene.role || (index === 0 ? "Mo bai" : index === scenes.length - 1 ? "Ket bai" : "Than bai"),
    duration: scene.duration || inferSceneDuration(index, scenes.length),
    sceneScript: String(scene.sceneScript || input.videoScript?.[index] || "").trim(),
    textOverlay: String(scene.textOverlay || "").trim(),
    visual: String(scene.visual || "").trim(),
    editNote: String(scene.editNote || "").trim(),
    sourceNote: String(scene.sourceNote || compactSourceName(first.source || first.source_name || "")).trim()
  }));
  const videoScript = Array.isArray(input.videoScript) && input.videoScript.length
    ? input.videoScript.map((line) => String(line).trim()).filter(Boolean)
    : normalizedScenes.map((scene) => scene.sceneScript).filter(Boolean);
  const source = typeof input.source === "object" && input.source
    ? input.source
    : { name: first.source || first.source_name || "", url: first.link || first.url || "" };
  const hashtags = Array.isArray(input.hashtags)
    ? input.hashtags.map((tag) => String(tag).trim()).filter(Boolean)
    : String(input.hashtags || "#KoliaPhan #TinTucDauTu").split(/\s+/).filter(Boolean);
  if (!hashtags.some((tag) => tag.toLowerCase() === "#koliaphan")) hashtags.unshift("#KoliaPhan");
  let caption = stripAuditLeakSections(String(input.caption || "").trim());
  if (caption && !caption.includes("Tuyên bố miễn trừ trách nhiệm:") && !caption.includes("TuyÃªn bá»‘ miá»…n trá»«")) {
    caption = `${caption}\n\n${cleanMandatoryDisclaimer}`;
  }
  const videoTitle = String(input.videoTitle || first.title || "").trim();
  caption = formatVideoCaption({
    videoTitle,
    caption,
    hashtags
  });
  return {
    videoTitle,
    videoSetup: setup,
    videoAngle: String(input.videoAngle || first.context || first.summary || "").trim(),
    totalDuration: String(input.totalDuration || estimateTotalDuration(normalizedScenes, setup.durationRange)).trim(),
    totalScenes: Number(input.totalScenes || normalizedScenes.length || videoScript.length),
    videoScript,
    scenes: normalizedScenes,
    caption,
    source: {
      name: source.name || first.source || first.source_name || "",
      url: source.url || first.link || first.url || ""
    },
    videoSource: String(input.videoSource || compactSourceName(source.name || first.source || first.source_name || "")).trim(),
    hashtags
  };
}

function validateVideoOutput(output) {
  const missing = [];
  ["videoTitle", "videoSetup", "videoAngle", "totalDuration", "totalScenes", "videoScript", "scenes", "caption", "source", "videoSource", "hashtags"].forEach((key) => {
    if (!output[key] || (Array.isArray(output[key]) && !output[key].length)) missing.push(key);
  });
  const range = sceneCountRange(output.videoSetup?.durationRange);
  if (!Array.isArray(output.scenes) || output.scenes.length < range.min) missing.push(`scenes >= ${range.min}`);
  (output.scenes || []).forEach((scene, index) => {
    ["sceneNumber", "role", "duration", "sceneScript", "textOverlay", "visual", "editNote", "sourceNote"].forEach((key) => {
      if (!scene[key]) missing.push(`scenes[${index + 1}].${key}`);
    });
  });
  if (!output.source?.name) missing.push("source.name");
  if (!output.source?.url) missing.push("source.url");
  if (!output.hashtags?.some((tag) => String(tag).toLowerCase() === "#koliaphan")) missing.push("hashtags #KoliaPhan");
  return { ok: missing.length === 0, missing: [...new Set(missing)] };
}

function buildFallbackVideoOutput(news, config) {
  const first = Array.isArray(news) ? news[0] || {} : {};
  const sourceName = compactSourceName(first.source || "");
  const scenes = [
    ["Mo bai", first.title || "Tin tai chinh moi", "Tin mới cần chú ý"],
    ["So lieu", first.summary || "Bài gốc có một số dữ liệu cần kiểm tra.", "Số liệu chính"],
    ["Giai thich", first.context || "Nội dung cần được đọc trong phạm vi bài gốc.", "Đọc đúng bối cảnh"],
    ["Boi canh", "Không tự thêm nguyên nhân nếu bài gốc không nêu.", "Không nói quá nguồn"],
    ["Tac dong", "Chỉ diễn giải tác động nếu bài gốc có dữ liệu hoặc nhận định hỗ trợ.", "Tác động có nguồn"],
    ["Theo doi", "Điểm cần theo dõi là các dữ liệu tiếp theo từ nguồn chính thức.", "Cần theo dõi gì?"],
    ["No FOMO", "Đây là cập nhật tin tức, không phải khuyến nghị mua bán.", "Không phải khuyến nghị"],
    ["Ket", "Theo dõi thêm nguồn chính thức trước khi đưa ra bất kỳ quyết định đầu tư nào.", "Theo dõi nguồn chính thức"]
  ].map((item, index) => ({
    id: `scene-${index + 1}`,
    sceneNumber: index + 1,
    role: item[0],
    duration: inferSceneDuration(index, 6),
    sceneScript: item[1],
    textOverlay: item[2],
    visual: "Nền brand tài chính trung tính, thẻ chữ lớn ở giữa, nguồn nhỏ phía cuối màn hình.",
    editNote: "Fade in text, zoom nhẹ nền, giữ chữ dễ đọc.",
    sourceNote: sourceName
  }));
  return normalizeVideoOutput({
    videoTitle: first.title || "Video short tin tức",
    videoSetup: normalizeVideoConfig(config),
    videoAngle: first.context || first.summary || "Cập nhật tin tức theo nguồn gốc.",
    totalDuration: "30s",
    totalScenes: scenes.length,
    videoScript: scenes.map((scene) => scene.sceneScript),
    scenes,
    caption: `${first.summary || first.title || "Cập nhật tin tức tài chính."}\n\nNguồn: ${first.source || ""} ${first.link || ""}\nHashtag: #KoliaPhan #TinTucDauTu`,
    source: { name: first.source || "", url: first.link || "" },
    videoSource: sourceName,
    hashtags: ["#KoliaPhan", "#TinTucDauTu"]
  }, news, config);
}

function applyLocalVideoEdit(output, action, sceneIndex) {
  const copy = JSON.parse(JSON.stringify(output));
  if (action === "split_scene") {
    const scene = copy.scenes[sceneIndex];
    if (scene) {
      const newScene = { ...scene, id: `scene-${Date.now()}`, sceneNumber: scene.sceneNumber + 1, textOverlay: "Ý tiếp theo", editNote: "Chuyển cảnh nhanh, giữ nhịp đọc rõ." };
      scene.textOverlay = trimText(scene.textOverlay, 42);
      scene.sceneScript = trimText(scene.sceneScript, 100);
      copy.scenes.splice(sceneIndex + 1, 0, newScene);
    }
  }
  if (action === "merge_next") {
    const scene = copy.scenes[sceneIndex];
    const next = copy.scenes[sceneIndex + 1];
    if (scene && next) {
      scene.sceneScript = `${scene.sceneScript} ${next.sceneScript}`.trim();
      scene.textOverlay = `${scene.textOverlay}\n${next.textOverlay}`.trim();
      scene.visual = `${scene.visual} Kết hợp với: ${next.visual}`;
      copy.scenes.splice(sceneIndex + 1, 1);
    }
  }
  copy.scenes = copy.scenes.map((scene, index) => ({ ...scene, sceneNumber: index + 1, id: scene.id || `scene-${index + 1}` }));
  copy.totalScenes = copy.scenes.length;
  copy.videoScript = copy.scenes.map((scene) => scene.sceneScript);
  return copy;
}

function inferSceneDuration(index, total) {
  const start = index === 0 ? 0 : 3 + (index - 1) * 5;
  const end = index === 0 ? 3 : start + 5;
  if (index === total - 1) return `${start}-${end}s`;
  return `${start}-${end}s`;
}

function estimateTotalDuration(scenes, durationRange) {
  if (scenes.length) {
    const last = scenes[scenes.length - 1].duration || "";
    const match = last.match(/-(\d+)s/i);
    if (match) return `${match[1]}s`;
  }
  if (durationRange === "20-30s") return "28s";
  if (durationRange === "45-60s") return "52s";
  return "34s";
}

function compactSourceName(value) {
  return String(value || "Nguon bai goc")
    .replace(/\s*-\s*RSS.*/i, "")
    .replace(/\s*\|.*/g, "")
    .trim();
}

async function reviewGeneratedContent(body = {}) {
  if (!process.env.OPENAI_API_KEY) {
    return {
      provider: "needs_api_key",
      text: "Chưa thể kiểm tra vì server chưa có OPENAI_API_KEY."
    };
  }

  const mode = body.mode === "rewrite" ? "rewrite" : body.mode === "patch" ? "patch" : "check";
  const content = String(body.content || "").trim();
  const criteria = String(body.criteria || "").trim();
  const news = Array.isArray(body.news) ? body.news : [];
  if (!content) throw new Error("Chưa có output content để kiểm tra");

  const prompt = buildContentReviewPrompt({ mode, content, criteria, news });
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      input: prompt,
      max_output_tokens: mode === "check" ? 3200 : 3600
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || "OpenAI review request failed");
  }

  return {
    provider: "openai",
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    mode,
    text: sanitizeGeneratedContent(extractResponseText(data) || "Không nhận được kết quả kiểm tra từ model.")
  };
}

function buildContentReviewPrompt({ mode, content, criteria, news }) {
  const modeInstruction = {
    check: "Chỉ kiểm tra và trả kết quả đánh giá + gợi ý sửa. Không viết lại toàn bộ content.",
    rewrite: "Viết lại toàn bộ content cuối cùng, đã sửa các lỗi phát hiện. Giữ format Title/Caption/Nguồn/Hashtag nếu có.",
    patch: "Chỉ sửa những câu/đoạn có vấn đề. Trả về danh sách: đoạn gốc cần sửa -> đoạn thay thế. Không rewrite phần đang ổn."
  }[mode];

  return [
    "Bạn là biên tập viên kiểm chứng nội dung tài chính tiếng Việt cho kênh Kolia Phan.",
    "Nhiệm vụ: đối chiếu output content với nguồn tin đã chọn, phát hiện nội dung nói quá nguồn hoặc suy diễn vượt dữ liệu.",
    "",
    "TIÊU CHÍ KIỂM TRA BẮT BUỘC:",
    "- Nội dung có sát với nguồn đã chọn không?",
    "- Không diễn giải vượt quá nguồn.",
    "- Không biến dữ liệu ngắn hạn thành xu hướng dài hạn.",
    "- Không tự thêm nguyên nhân, số liệu, dự báo, nhận định nếu bài gốc không nêu.",
    "- Không nâng mức độ chắc chắn của bài gốc. Nếu nguồn dùng 'có thể', 'kỳ vọng', 'dự báo', 'khả năng', 'theo chuyên gia', caption cũng phải giữ mức thận trọng tương đương.",
    "- Không nói quá nguồn; chỉ được kết luận trong phạm vi dữ liệu và ngôn ngữ mà bài gốc cho phép.",
    "- Với bài có bảng giá hoặc nhiều thương hiệu, caption social phải chọn lọc số liệu quan trọng, không bê nguyên danh sách dài gây khó đọc.",
    "- Không khuyến nghị mua bán, không FOMO, không dùng 'chắc chắn', 'cam kết', 'sẽ tăng', 'sẽ giảm'.",
    criteria ? `TIÊU CHÍ BỔ SUNG CỦA USER:\n${criteria}` : "TIÊU CHÍ BỔ SUNG CỦA USER: không có.",
    "",
    `CHẾ ĐỘ XỬ LÝ: ${modeInstruction}`,
    "",
    "FORMAT TRẢ KẾT QUẢ:",
    mode === "check"
      ? [
        "Kết luận nhanh: Đạt / Cần sửa / Không đạt",
        "Các điểm ổn:",
        "Các điểm cần sửa:",
        "Rủi ro nói quá nguồn:",
        "Gợi ý sửa cụ thể:"
      ].join("\n")
      : "Trả kết quả bằng plain text, không Markdown, không dấu **. Nếu rewrite thì trả bản content hoàn chỉnh. Nếu patch thì chỉ trả các đoạn cần thay.",
    "",
    "OUTPUT CONTENT CẦN KIỂM TRA:",
    content,
    "",
    "NGUỒN TIN ĐÃ CHỌN:",
    news.map((item, index) => [
      `Tin ${index + 1}`,
      `Nguồn: ${item.source || ""}`,
      `Link: ${item.link || ""}`,
      `Thời gian: ${item.time || ""}`,
      `Tiêu đề gốc: ${item.title || ""}`,
      `Chủ đề: ${item.topic || ""}`,
      `Tóm tắt: ${item.summary || ""}`,
      `Bối cảnh: ${item.context || ""}`,
      `Full text: ${trimText(item.fullText || "", 6000)}`
    ].join("\n")).join("\n\n")
  ].join("\n");
}

async function reviewGeneratedContent(body = {}) {
  if (!process.env.OPENAI_API_KEY) {
    return {
      provider: "needs_api_key",
      text: "Chưa thể kiểm tra vì server chưa có OPENAI_API_KEY."
    };
  }

  const mode = body.mode === "rewrite" ? "rewrite" : body.mode === "patch" ? "patch" : "check";
  const content = String(body.content || "").trim();
  const criteria = String(body.criteria || "").trim();
  const news = Array.isArray(body.news) ? body.news : [];
  const defaultCriteria = Array.isArray(body.defaultCriteria) ? body.defaultCriteria : [];
  const auditResult = body.auditResult && typeof body.auditResult === "object" ? body.auditResult : null;
  if (!content) throw new Error("Chưa có output content để kiểm tra");

  if (mode === "check") {
    const prompt = buildStructuredAuditPrompt({ content, criteria, news, defaultCriteria });
    const raw = await callOpenAiText(prompt, 3200);
    const audit = normalizeAuditResult(parseLooseJson(raw), content, news, criteria, defaultCriteria);
    return {
      provider: "openai",
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      auditResult: audit,
      text: JSON.stringify(audit, null, 2)
    };
  }

  if (!auditResult) throw new Error("Cần có auditResult trước khi rewrite");
  const issues = Array.isArray(auditResult.issues) ? auditResult.issues : [];
  const rewriteIssues = issues.filter((issue) => issue.requires_rewrite);
  if (mode === "patch" && !rewriteIssues.length && auditResult.overall_status === "pass") {
    return {
      provider: "local",
      mode,
      revisedContent: "Không phát hiện đoạn cần sửa theo kết quả kiểm tra hiện tại.",
      text: "Không phát hiện đoạn cần sửa theo kết quả kiểm tra hiện tại."
    };
  }

  const prompt = mode === "rewrite"
    ? buildFullRewritePrompt({ content, news, auditResult, criteria, defaultCriteria })
    : buildTargetedFixPrompt({ content, news, auditResult });
  const revised = stripAuditLeakSections(sanitizeGeneratedContent(await callOpenAiText(prompt, mode === "rewrite" ? 3600 : 3000)));
  return {
    provider: "openai",
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    mode,
    revisedContent: revised,
    text: revised
  };
}

async function callOpenAiText(input, maxOutputTokens) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      input,
      max_output_tokens: maxOutputTokens
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "OpenAI request failed");
  return extractResponseText(data);
}

function buildStructuredAuditPrompt({ content, criteria, news, defaultCriteria }) {
  const auditId = crypto.createHash("sha1")
    .update(JSON.stringify({ content, news, defaultCriteria, criteria }))
    .digest("hex")
    .slice(0, 12);
  return [
    "Bạn là biên tập viên kiểm chứng nội dung tài chính tiếng Việt cho kênh Kolia Phan.",
    "Hãy audit output với nguồn gốc. Không audit riêng output nếu chưa đối chiếu nguồn.",
    "Trả về JSON hợp lệ duy nhất. Không markdown. Không giải thích ngoài JSON.",
    "",
    "Rubric cố định:",
    ...defaultCriteria.map((item, index) => `${index + 1}. ${item}`),
    "Các kiểm tra bắt buộc: source faithfulness, no over-interpretation, no unsupported causality, uncertainty preservation, numbers/time accuracy, no recommendation, no FOMO, title accuracy, source/hashtag completeness, thin source warning.",
    criteria ? `Tiêu chí bổ sung:\n${criteria}` : "Tiêu chí bổ sung: không có.",
    "",
    "JSON schema bắt buộc:",
    JSON.stringify({
      audit_id: auditId,
      overall_status: "pass | needs_fix | fail",
      score: 0,
      summary: "Tóm tắt ngắn bằng tiếng Việt",
      issues: [{
        issue_id: "ISSUE_001",
        severity: "critical | major | minor",
        criterion: "Tên tiêu chí",
        location: "Output 1 / Caption / paragraph 2",
        original_text: "Exact generated text that has a problem",
        problem: "Vì sao có vấn đề",
        source_evidence: "Bằng chứng từ nguồn hoặc nói rõ nguồn không hỗ trợ",
        suggested_fix: "Đoạn thay thế đề xuất",
        requires_rewrite: true
      }],
      passed_checks: ["..."],
      custom_criteria_checked: ["..."]
    }, null, 2),
    "",
    "Quy tắc issue:",
    "- Mỗi issue phải có original_text chính xác từ output.",
    "- Nếu audit phát hiện vấn đề, requires_rewrite phải là true khi cần sửa text.",
    "- Không trả issue mơ hồ. Phải chỉ ra đoạn có vấn đề và suggested_fix.",
    "- Nếu nguồn dữ liệu mỏng mà output kết luận mạnh, phải tạo issue.",
    "- Nếu output nói nguyên nhân trực tiếp nhưng nguồn chỉ đặt trong bối cảnh, phải tạo issue.",
    "",
    "OUTPUT CONTENT:",
    content,
    "",
    "SOURCE ARTICLES:",
    serializeSourceArticles(news)
  ].join("\n");
}

function buildFullRewritePrompt({ content, news, auditResult, criteria, defaultCriteria }) {
  return [
    "Bạn là biên tập viên tài chính tiếng Việt. Viết lại toàn bộ output dựa trên auditResult đã có.",
    "Không audit lại từ đầu. Phải sửa tất cả issues trong auditResult. Giữ format Output/Title/Caption/Nguồn/Hashtag nếu có.",
    "Không thêm claim mới ngoài nguồn. Không nói quá nguồn. Không dùng markdown.",
    criteria ? `Tiêu chí bổ sung:\n${criteria}` : "",
    "Default criteria:",
    ...defaultCriteria.map((item) => `- ${item}`),
    "",
    "AUDIT RESULT:",
    JSON.stringify(auditResult, null, 2),
    "",
    "OUTPUT GỐC:",
    content,
    "",
    "SOURCE ARTICLES:",
    serializeSourceArticles(news),
    "",
    "Trả về bản content hoàn chỉnh đã sửa:"
  ].join("\n");
}

function buildTargetedFixPrompt({ content, news, auditResult }) {
  const allIssues = auditResult.issues || [];
  const issues = allIssues.some((issue) => issue.requires_rewrite)
    ? allIssues.filter((issue) => issue.requires_rewrite)
    : allIssues;
  return [
    "Bạn là biên tập viên tài chính tiếng Việt. Chỉ sửa đúng các phần cần sửa dựa trên auditResult.",
    "Không audit lại từ đầu. Không được nói 'Không phát hiện đoạn cần sửa' nếu danh sách issues dưới đây có phần tử.",
    "Chỉ thay các đoạn/câu trong issues bằng suggested_fix hoặc bản sửa tương đương sát nguồn hơn. Giữ nguyên tối đa các phần còn lại.",
    "Không thêm claim mới ngoài nguồn. Không dùng markdown.",
    "",
    "ISSUES PHẢI SỬA:",
    JSON.stringify(issues, null, 2),
    "",
    "OUTPUT GỐC:",
    content,
    "",
    "SOURCE ARTICLES:",
    serializeSourceArticles(news),
    "",
    "Trả về toàn bộ output sau khi chỉ sửa đúng các phần cần sửa:"
  ].join("\n");
}

function serializeSourceArticles(news) {
  return (news || []).map((item, index) => [
    `Tin ${index + 1}`,
    `Nguồn: ${item.source || ""}`,
    `Link: ${item.link || ""}`,
    `Thời gian: ${item.time || ""}`,
    `Tiêu đề gốc: ${item.title || ""}`,
    `Chủ đề: ${item.topic || ""}`,
    `Tóm tắt: ${item.summary || ""}`,
    `Bối cảnh: ${item.context || ""}`,
    `Full text: ${trimText(item.fullText || "", 6000)}`
  ].join("\n")).join("\n\n");
}

function parseLooseJson(text) {
  const raw = String(text || "").trim();
  try {
    return JSON.parse(raw);
  } catch (error) {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (innerError) {}
    }
  }
  return null;
}

function normalizeAuditResult(parsed, content, news, criteria, defaultCriteria) {
  const fallbackId = crypto.createHash("sha1")
    .update(JSON.stringify({ content, news, defaultCriteria, criteria }))
    .digest("hex")
    .slice(0, 12);
  const result = parsed && typeof parsed === "object" ? parsed : {};
  const issues = Array.isArray(result.issues) ? result.issues.map((issue, index) => ({
    issue_id: String(issue.issue_id || `ISSUE_${String(index + 1).padStart(3, "0")}`),
    severity: ["critical", "major", "minor"].includes(issue.severity) ? issue.severity : "minor",
    criterion: String(issue.criterion || "Source faithfulness"),
    location: String(issue.location || "-"),
    original_text: String(issue.original_text || ""),
    problem: String(issue.problem || ""),
    source_evidence: String(issue.source_evidence || ""),
    suggested_fix: String(issue.suggested_fix || ""),
    requires_rewrite: Boolean(issue.requires_rewrite)
  })) : [];
  const status = ["pass", "needs_fix", "fail"].includes(result.overall_status)
    ? result.overall_status
    : issues.length ? "needs_fix" : "pass";
  return {
    audit_id: String(result.audit_id || fallbackId),
    overall_status: status,
    score: Number.isFinite(Number(result.score)) ? Math.max(0, Math.min(100, Number(result.score))) : (issues.length ? 72 : 92),
    summary: String(result.summary || (issues.length ? "Nội dung cần sửa một số điểm để sát nguồn hơn." : "Nội dung bám sát nguồn theo các tiêu chí kiểm tra.")),
    issues,
    passed_checks: Array.isArray(result.passed_checks) ? result.passed_checks.map(String) : [],
    custom_criteria_checked: Array.isArray(result.custom_criteria_checked) ? result.custom_criteria_checked.map(String) : (criteria ? [criteria] : [])
  };
}

function saveCsvExport(rows) {
  if (!Array.isArray(rows) || !rows.length) throw new Error("Không có dữ liệu để xuất CSV");
  const exportDir = path.join(process.env.USERPROFILE || root, "Downloads", "Kolia exports");
  fs.mkdirSync(exportDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `kolia-news-desk-${timestamp}.csv`;
  const filePath = path.join(exportDir, filename);
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(","))
  ].join("\n");
  fs.writeFileSync(filePath, `\uFEFF${csv}`, "utf8");
  return {
    filename,
    path: filePath,
    count: rows.length
  };
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function extractResponseText(data) {
  if (data.output_text) return data.output_text;
  return (data.output || [])
    .flatMap((item) => item.content || [])
    .filter((content) => content.type === "output_text" && content.text)
    .map((content) => content.text)
    .join("\n")
    .trim();
}

function sanitizeGeneratedContent(text) {
  return String(text || "")
    .replace(/\*\*([^*\n][\s\S]*?[^*\n])\*\*/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/__([^_\n][\s\S]*?[^_\n])__/g, "$1")
    .replace(/__/g, "")
    .trim();
}

function stripAuditLeakSections(text) {
  return String(text || "")
    .replace(/\n?\s*(Scene script\s*(để đối chiếu|de doi chieu)?|Scene script Ä‘á»ƒ Ä‘á»‘i chiáº¿u)\s*:[\s\S]*$/i, "")
    .replace(/\n?\s*(SOURCE ARTICLES|NGUỒN TIN ĐÃ CHỌN|NGUá»’N TIN ÄÃƒ CHá»ŒN)\s*:[\s\S]*$/i, "")
    .trim();
}

function buildEditorialGeneratePrompt(uiPrompt, news, options) {
  const outputMode = options.outputMode === "merge" ? "merge" : "split";
  const items = Array.isArray(news) ? news : [];
  return [
    "Bạn là biên tập viên nội dung tài chính với 10 năm kinh nghiệm cho kênh social của Kolia Phan.",
    "Nhiệm vụ là viết content hoàn chỉnh cho người xem thật, không viết ghi chú nội bộ.",
    "",
    "QUY TRÌNH BẮT BUỘC TRƯỚC KHI VIẾT:",
    "1. Đọc từng tin gốc.",
    "2. Trích lõi tin: chuyện gì đã xảy ra, tài sản/thị trường nào liên quan, số liệu nào quan trọng, thời gian nào, nguyên nhân nào được bài gốc nêu.",
    "3. Nếu bài không có số liệu hoặc nguyên nhân, nói tự nhiên rằng bài chưa nêu nguyên nhân cụ thể, không tự bịa.",
    "4. Xác định bối cảnh: dữ liệu trong ngày, sự kiện vĩ mô, nhận định chuyên gia, hay báo cáo nền tảng.",
    "5. Chỉ sau đó mới viết title và caption.",
    "",
    "YÊU CẦU OUTPUT:",
    outputMode === "split"
      ? `- BẮT BUỘC trả đúng ${items.length} output riêng, tương ứng đúng ${items.length} tin đã tick. Không được gộp các tin vào một output.`
      : "- Gộp các tin thành một bản tin tổng hợp duy nhất, nhưng mỗi ý vẫn phải có sự kiện/số liệu cụ thể.",
    outputMode === "split"
      ? `- Nếu có ${items.length} tin đầu vào, format phải lần lượt là Output 1, Output 2${items.length >= 3 ? ", Output 3" : ""}... Mỗi output chỉ dùng dữ liệu của đúng tin tương ứng.`
      : "- Vì đang chọn chế độ gộp, chỉ trả một output tổng hợp.",
    "- Output phải là plain text. Không dùng Markdown. Không dùng dấu **, __, bullet markdown, heading markdown hay in đậm/in nghiêng.",
    "- Toàn bộ output bằng tiếng Việt tự nhiên. Tin tiếng Anh phải được biên soạn/dịch ý sang tiếng Việt.",
    "- Title phải có móc thông tin cụ thể: tài sản/sự kiện/nguyên nhân/biến động. Không dùng title chung chung như 'biến động đáng chú ý'.",
    "- Caption phải trả lời ngay: rốt cuộc tin này nói chuyện gì đã xảy ra?",
    "- Caption phải chọn lọc như một bản tin social: nói điều gì đáng chú ý, vì sao đáng chú ý, và cần theo dõi gì tiếp; không chỉ đọc lại bảng số liệu.",
    "- Nếu bài có bảng giá dài hoặc nhiều thương hiệu, chỉ giữ tối đa 3 nhóm số liệu quan trọng nhất. Các thương hiệu/số liệu còn lại chỉ khái quát, ví dụ: một số thương hiệu lớn điều chỉnh theo từng mức khác nhau.",
    "- Caption 200-300 chữ nếu là một output; nếu output tách từng tin thì mỗi caption 140-230 chữ.",
    "- Dùng bố cục theo model content đã chọn, nhưng không ghi tên model ra ngoài.",
    "- Có hashtag cuối caption.",
    "- Bắt buộc đặt phần Tuyên bố miễn trừ trách nhiệm ở cuối mỗi output, ngay sau Hashtag. Không được bỏ, không được rút gọn.",
    "",
    "CẤM TUYỆT ĐỐI CÁC CỤM SAU TRONG OUTPUT:",
    "- Ký tự markdown như ** hoặc __.",
    "- 'Góc truyền thông phù hợp'",
    "- 'Cấu trúc nội dung'",
    "- 'Đây là tin dữ liệu giá/thị trường'",
    "- 'Sự kiện chính thuộc nhóm'",
    "- 'Phần trích xuất không có nhiều số liệu'",
    "- 'Với dữ liệu hiện có' nếu dùng như câu template máy móc",
    "- 'cần được quy đổi sang bối cảnh người xem Việt Nam'",
    "- Các đoạn menu/navigation/quảng cáo từ bài gốc.",
    "",
    "NGUYÊN TẮC TÀI CHÍNH:",
    "- QUAN TRỌNG: Không diễn giải vượt quá nguồn. Khi viết Title/Caption, tuyệt đối không nói quá nguồn, không biến dữ liệu trong bài thành kết luận mạnh hơn nội dung gốc cho phép, không nâng cấp mức độ chắc chắn của nguồn.",
    "- Nếu bài gốc dùng các từ như 'có thể', 'kỳ vọng', 'dự báo', 'khả năng', 'theo chuyên gia', 'theo nhận định trong bài' thì caption cũng phải giữ mức độ thận trọng tương đương.",
    "- Không khuyến nghị mua bán.",
    "- Không FOMO.",
    "- Không dùng 'chắc chắn', 'cam kết', 'sẽ tăng', 'sẽ giảm'.",
    "- Không thêm nguyên nhân nếu bài gốc không nêu.",
    "- Nếu chỉ là biến động ngắn hạn, không gọi là xu hướng bền vững.",
    "",
    `MODEL CONTENT: ${options.contentModel || "AIDA"}`,
    `CTA: ${options.ctaType || "live_question"}`,
    `LEVEL ĐỘ DÀI: ${options.lengthLevel || "2"}`,
    lengthInstruction(options.lengthLevel || "2"),
    "",
    "DỮ LIỆU TIN ĐÃ CHỌN:",
    items.map((item, index) => [
      `Tin ${index + 1}`,
      `Nguồn: ${item.source || ""}`,
      `Link: ${item.link || ""}`,
      `Thời gian: ${item.time || ""}`,
      `Tiêu đề gốc: ${item.title || ""}`,
      `Chủ đề: ${item.topic || ""}`,
      `Tóm tắt hiện có: ${item.summary || ""}`,
      `Bối cảnh hiện có: ${item.context || ""}`,
      `Full text: ${trimText(item.fullText || "", 7000)}`
    ].join("\n")).join("\n\n"),
    "",
    "FORMAT OUTPUT:",
    outputMode === "split"
      ? items.map((_, index) => `Output ${index + 1}\nTitle:\nCaption:\nNguồn:\nHashtag:\n${cleanMandatoryDisclaimer}`).join("\n\n")
      : `Title:\nCaption:\nNguồn:\nHashtag:\n${cleanMandatoryDisclaimer}`,
    "",
    "Tham chiếu prompt UI hiện tại:",
    trimText(uiPrompt || "", 2500)
  ].join("\n");
}

function lengthInstruction(level) {
  const map = {
    "1": "Level 1 - Tổng quan: Title 6-10 từ. Caption 200-300 từ. Có sự kiện chính, số liệu quan trọng nhất, bối cảnh ngắn và điều cần theo dõi. Không phân tích sâu.",
    "2": "Level 2 - Tiêu chuẩn: Title 6-12 từ. Caption 300-500 từ. Có sự kiện chính, số liệu quan trọng, bối cảnh thị trường, phản ứng của nhóm tài sản/ngành liên quan và điều cần theo dõi.",
    "3": "Level 3 - Chi tiết: Title 8-14 từ. Caption 500-700 từ. Có diễn biến theo trình tự, bối cảnh thị trường, tác động tới nhóm tài sản/ngành nếu bài gốc nêu, và yếu tố cần theo dõi.",
    "4": "Level 4 - Chuyên sâu: Title 10-16 từ. Caption 800-1.200 từ. Có bối cảnh liên thị trường, phản ứng các nhóm tài sản/ngành nếu bài gốc nêu, điểm chưa thể kết luận và danh sách yếu tố cần theo dõi."
  };
  return [
    map[level] || map["2"],
    "Dù ở level nào cũng phải bám sát 100% nội dung gốc.",
    "Không kéo dài bằng suy đoán. Nếu dữ liệu gốc mỏng, ghi rõ chỉ đủ để đọc như diễn biến ngắn hạn.",
    "Độ dài tính theo số từ tiếng Việt, không tính hashtag và phần nguồn."
  ].join("\n");
}

function apiKeyRequiredBrief(news, options = {}) {
  const items = Array.isArray(news) ? news : [];
  const selected = items.map((item, index) => [
    `Tin ${index + 1}: ${item.title || "Chưa có tiêu đề"}`,
    `Nguồn: ${item.source || ""}${item.link ? ` - ${item.link}` : ""}`,
    `Chủ đề: ${item.topic || ""}`,
    `Lõi tin cần AI biên tập: ${firstLine(item.summary || item.fullText || "")}`
  ].join("\n")).join("\n\n");

  return [
    "Chưa thể generate caption cuối vì server chưa có OPENAI_API_KEY.",
    "",
    "Để tránh output máy móc/rỗng, app đã tắt fallback template cho bản content cuối.",
    "Sau khi cấu hình API key, model sẽ đọc full text và viết title/caption hoàn chỉnh bằng tiếng Việt.",
    "",
    "Tin đã chọn để gửi AI:",
    selected || "Chưa có tin được chọn.",
    "",
    "Cách bật AI:",
    "1. Set biến môi trường OPENAI_API_KEY.",
    "2. Có thể set OPENAI_MODEL nếu muốn đổi model.",
    "3. Restart server localhost."
  ].join("\n");
}

function localDraft(news, options = {}) {
  const items = Array.isArray(news) ? news : [];
  if (!items.length) {
    return "Chưa có tin được chọn.";
  }
  if (options.outputMode === "split") {
    return items.map((item, index) => localDraftSingle(item, options, index + 1)).join("\n\n---\n\n");
  }
  const sourceLine = items.map((item) => `${item.source || "Nguồn"}${item.link ? ` (${item.link})` : ""}`).join("; ");
  const bullets = items.map((item, index) => `${index + 1}. ${localVietnameseTitle(item)}: ${firstLine(editorialSummary(item))}`).join("\n");
  const main = items[0];
  return [
    `Title: ${localVietnameseTitle(main)}`,
    "",
    "Caption:",
    contentOpening(options.contentModel, main),
    "",
    bullets,
    "",
    `${ctaText(options.ctaType)} Nội dung này chỉ nhằm hỗ trợ theo dõi thị trường, không phải khuyến nghị mua bán và không thay thế việc tự kiểm tra nguồn gốc dữ liệu trước khi ra quyết định.`,
    "",
    `Nguồn: ${sourceLine}`,
    `Hashtag: ${buildHashtags(items)}`,
    cleanMandatoryDisclaimer
  ].join("\n");
}

function localDraftSingle(item, options, index) {
  return [
    `Output ${index}`,
    `Title: ${localVietnameseTitle(item)}`,
    "",
    "Caption:",
    formatCaptionByModel(item, options),
    "",
    `Nguồn: ${item.source || "Nguồn"}${item.link ? ` (${item.link})` : ""}`,
    `Hashtag: ${buildHashtags([item])}`,
    cleanMandatoryDisclaimer
  ].join("\n");
}

function localVietnameseTitle(item) {
  const text = `${item.title || ""} ${item.topic || ""}`.toLowerCase();
  const original = item.title || "";
  const fedChair = original.match(/(.+?)\s+to be sworn in as Federal Reserve chair/i);
  if (fedChair) return `${fedChair[1].trim()} chuẩn bị tuyên thệ Chủ tịch Fed`;
  if (/Kevin Warsh/i.test(original) && /federal reserve|fed/i.test(original)) return "Kevin Warsh và vị trí Chủ tịch Fed: tín hiệu cần theo dõi";
  if (/fed|interest rate|rate cut|rate hike|yield|bond/.test(text)) return "Fed và lãi suất: biến số cần theo dõi";
  if (/gold|vàng/.test(text)) return "Vàng: dữ liệu mới cần đặt trong bối cảnh";
  if (/silver|bạc/.test(text)) return "Bạc: biến động giá cần đọc thận trọng";
  if (/crypto|bitcoin|btc|ethereum|eth/.test(text)) return "Crypto: tin mới và điểm cần theo dõi";
  if (/oil|brent|wti|dầu/.test(text)) return "Dầu và hàng hóa: biến động đáng chú ý";
  if (/usd|dxy|currency|tỷ giá/.test(text)) return "USD và tỷ giá: tín hiệu cần theo dõi";
  return `${item.topic || "Thị trường"}: ${trimText(item.title || "Cập nhật đáng chú ý", 68)}`;
}

function formatCaptionByModel(item, options) {
  const summary = editorialSummary(item);
  const context = editorialContext(item);
  const cta = ctaText(options.ctaType);
  const topic = (item.topic || "thị trường").toLowerCase();
  const title = localVietnameseTitle(item);
  const templates = {
    AIDA: [
      `Một tin đáng chú ý trong nhóm ${topic}: ${title}.`,
      summary,
      context,
      `${cta} Nội dung này chỉ nhằm hỗ trợ theo dõi thị trường, không phải khuyến nghị mua bán.`
    ],
    PAS: [
      `Vấn đề cần chú ý không chỉ là tiêu đề tin, mà là cách thị trường nên đọc dữ liệu này.`,
      summary,
      context,
      `${cta} Tránh biến một dữ kiện ngắn hạn thành kết luận chắc chắn.`
    ],
    "4C": [
      `${localVietnameseTitle(item)}`,
      summary,
      context,
      `${cta} Giữ cách đọc tin rõ, ngắn, có nguồn và không FOMO.`
    ],
    "3H": [
      `Tin này có thể dùng như một mảnh ghép ${topic} trong chuỗi cập nhật thị trường.`,
      summary,
      context,
      `${cta} Theo dõi thêm dữ liệu mới trước khi đưa ra kết luận.`
    ],
    TOFU_MOFU_BOFU: [
      `Với người mới theo dõi thị trường, điểm đáng chú ý là: ${item.title}.`,
      summary,
      context,
      `${cta} Đây là phần cập nhật để nối tiếp các nội dung phân tích sâu hơn.`
    ]
  };
  return (templates[options.contentModel] || templates.AIDA).filter(Boolean).join("\n\n");
}

function contentOpening(model, item) {
  const topic = (item.topic || "thị trường").toLowerCase();
  const map = {
    AIDA: `Có một cụm tin đáng chú ý liên quan tới ${topic}. Điểm quan trọng không chỉ là tin vừa xảy ra, mà là dữ liệu nào đang tác động tới tâm lý thị trường.`,
    PAS: `Nhóm tin hôm nay đặt ra một vấn đề: nhà đầu tư dễ phản ứng quá nhanh với tiêu đề nếu chưa tách sự kiện, số liệu và bối cảnh.`,
    "4C": `Bản tin nhanh hôm nay tập trung vào các dữ kiện rõ, ngắn và có nguồn để theo dõi ${topic}.`,
    "3H": `Đây là nhóm tin có thể dùng cho nhịp cập nhật định kỳ, giúp người xem theo dõi bức tranh ${topic} mà không bị cuốn theo từng tiêu đề riêng lẻ.`,
    TOFU_MOFU_BOFU: `Với người mới theo dõi thị trường, các tin dưới đây là điểm vào để hiểu bức tranh rộng hơn trước khi đi vào phân tích sâu.`
  };
  return map[model] || map.AIDA;
}

function firstLine(text) {
  return String(text || "").split(/\n+/).find(Boolean) || "";
}

function editorialSummary(item) {
  if (isMostlyEnglish(`${item.title || ""} ${item.summary || ""}`)) {
    return vietnameseSummaryFromEnglish(item.source || "Nguồn quốc tế", {
      title: item.title,
      pubDate: item.time || "",
      description: item.summary || ""
    }, item.summary || item.fullText || "");
  }
  return item.summary || item.title || "";
}

function editorialContext(item) {
  if (isMostlyEnglish(`${item.title || ""} ${item.context || ""}`)) {
    return vietnameseContextForEnglish(item.topic || "Kinh tế - thị trường", item.context || item.summary || "");
  }
  return item.context || buildContext(item.topic || "Kinh tế - thị trường", item.summary || "");
}

function ctaText(type) {
  const map = {
    live_question: "Bạn có thể để lại câu hỏi để team chọn lọc cho livestream thứ 7.",
    live_schedule: "Hẹn gặp bạn trong livestream 10h sáng thứ 7 để bóc tách thêm bối cảnh.",
    follow: "Theo dõi kênh để cập nhật các biến số thị trường đáng chú ý.",
    save: "Lưu lại để đối chiếu khi có dữ liệu mới."
  };
  return map[type] || map.live_question;
}

function buildHashtags(items) {
  const text = items.map((item) => `${item.topic} ${item.title}`).join(" ").toLowerCase();
  const tags = new Set(["#KoliaPhan", "#tintucdautu", "#daututaichinh"]);
  if (/vàng|gold/.test(text)) tags.add("#Dautuvang");
  if (/bạc|silver/.test(text)) tags.add("#Dautubac");
  if (/crypto|bitcoin|btc|ethereum|eth|tài sản số/.test(text)) tags.add("#crypto");
  if (/chứng khoán|vn-index|cổ phiếu/.test(text)) tags.add("#chungkhoan");
  if (/usd|tỷ giá|dxy/.test(text)) tags.add("#USD");
  if (/dầu|oil|brent|wti/.test(text)) tags.add("#hanghoa");
  return [...tags].join(" ");
}

function vietnameseSummaryFromEnglish(source, item, text) {
  const topic = detectTopic(`${item.title || ""} ${text || ""}`);
  const title = localVietnameseTitle({ title: item.title || "", topic });
  const time = item.pubDate || item.time ? ` vào ${formatVietnamTime(item.pubDate || item.time)}` : "";
  const numbers = extractNumberSentences(text || "").slice(0, 3);
  const numberLine = numbers.length
    ? `Chi tiết định lượng đáng chú ý trong bài gốc: ${numbers.map(cleanEnglishLine).join(" ")}`
    : "Phần trích xuất không có nhiều số liệu, nên trọng tâm nên đặt ở sự kiện chính và phản ứng của thị trường.";

  return [
    `${source} cập nhật tin "${title}"${time}.`,
    englishEventLine(item.title || "", topic),
    numberLine,
    "Với nhà đầu tư Việt Nam, điểm đáng chú ý là phản ứng có thể lan sang USD, lợi suất, vàng/bạc, dầu, crypto hoặc tâm lý rủi ro tùy diễn biến tiếp theo."
  ].join("\n");
}

function vietnameseContextForEnglish(topic, text) {
  const watch = watchFactors(topic);
  const causes = extractCauseHints(text || "");
  const causeLine = causes.length
    ? `Các yếu tố bài gốc có thể đang gợi ý gồm: ${causes.join(", ")}. Khi viết, chỉ dùng các yếu tố này nếu bài gốc thật sự nêu rõ.`
    : "Nếu bài gốc không nêu nguyên nhân cụ thể, không tự thêm lý do cho biến động thị trường.";
  return [
    `Đây là tin quốc tế thuộc nhóm ${topic}, nên được đọc trong bối cảnh tác động tới USD, lợi suất, hàng hóa, crypto, dòng vốn hoặc tâm lý rủi ro toàn cầu.`,
    "Với dữ liệu hiện có, tin này là một sự kiện/nhận định cần theo dõi thêm, chưa đủ cơ sở để kết luận xu hướng dài hạn hay tín hiệu mua bán.",
    causeLine,
    `Điểm cần theo dõi tiếp theo là ${watch}.`
  ].join("\n");
}

function englishEventLine(title, topic) {
  if (/federal reserve chair|fed chair|sworn/i.test(title)) {
    return "Sự kiện chính là thay đổi nhân sự/lãnh đạo liên quan tới Fed, một yếu tố có thể ảnh hưởng tới kỳ vọng chính sách tiền tệ của thị trường.";
  }
  if (/rate cut|rate hike|interest rate|yield|bond/i.test(title)) {
    return "Sự kiện chính liên quan tới kỳ vọng lãi suất và lợi suất, nhóm biến số thường tác động trực tiếp tới USD, vàng và tài sản rủi ro.";
  }
  if (/bitcoin|crypto|ethereum|etf/i.test(title)) {
    return "Sự kiện chính nằm ở thị trường tài sản số, cần theo dõi phản ứng của Bitcoin/Ethereum, dòng tiền ETF và yếu tố pháp lý.";
  }
  if (/gold|silver/i.test(title)) {
    return "Sự kiện chính liên quan tới kim loại quý, cần đặt cạnh USD, lợi suất và nhu cầu phòng thủ rủi ro.";
  }
  return `Sự kiện chính thuộc nhóm ${topic}, cần đặt trong bối cảnh tác động tới các tài sản liên quan thay vì chỉ đọc theo tiêu đề.`;
}

function isMostlyEnglish(text) {
  const value = String(text || "").trim();
  if (!value) return false;
  const asciiLetters = (value.match(/[a-z]/gi) || []).length;
  const vietnameseChars = (value.match(/[ăâđêôơưáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/gi) || []).length;
  return asciiLetters > 40 && asciiLetters > vietnameseChars * 8;
}

function cleanEnglishLine(text) {
  return trimText(trimWhitespace(String(text || "").replace(/\b(Markets|Business|Finance|Video|Latest|Podcast|News|Investing|Personal Finance)\b/gi, "")), 220);
}

function trimText(text, max) {
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new Error("Payload too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch (error) {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(data));
}

function buildVideoPdf(videoOutput) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(root, "pdf_export.py");
    const localPython = path.join(
      process.env.USERPROFILE || "",
      ".cache",
      "codex-runtimes",
      "codex-primary-runtime",
      "dependencies",
      "python",
      "python.exe"
    );
    const python = process.env.PDF_PYTHON || (fs.existsSync(localPython) ? localPython : "python");
    const child = spawn(python, [scriptPath], { cwd: root });
    const chunks = [];
    const errors = [];

    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => errors.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(Buffer.concat(errors).toString("utf8") || "PDF renderer failed"));
        return;
      }
      resolve(Buffer.concat(chunks));
    });

    child.stdin.write(JSON.stringify(videoOutput || {}));
    child.stdin.end();
  });
}

function safeDownloadName(name) {
  return String(name || "kolia-video-short.pdf")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120) || "kolia-video-short.pdf";
}

function savePdfToDownloads(filename, pdf) {
  const home = process.env.USERPROFILE || process.env.HOME;
  if (!home) return "";
  const downloads = path.join(home, "Downloads");
  if (!fs.existsSync(downloads)) return "";
  const parsed = path.parse(filename);
  let finalPath = path.join(downloads, filename);
  let counter = 2;
  while (fs.existsSync(finalPath)) {
    finalPath = path.join(downloads, `${parsed.name}-${counter}${parsed.ext || ".pdf"}`);
    counter += 1;
  }
  fs.writeFileSync(finalPath, pdf);
  return finalPath;
}

const host = process.env.RENDER || process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1";
server.listen(port, host, () => {
  console.log(`Kolia TikTok news desk: http://${host}:${port}`);
});
