// NSE Intraday AI Proxy — Alpha Vantage Edition
// Fetches live NSE stock data using Alpha Vantage API
// Deploy on Railway, works from any server!

const http  = require("http");
const https = require("https");

const PORT    = process.env.PORT || 3001;
const AV_KEY  = "0JHTBA0WW9LA2QQK";
const AV_BASE = "https://www.alphavantage.co/query";

// Top NSE stocks to track
const NSE_STOCKS = [
  "RELIANCE.BSE", "TCS.BSE", "HDFCBANK.BSE", "INFY.BSE",
  "ICICIBANK.BSE", "SBIN.BSE", "AXISBANK.BSE", "KOTAKBANK.BSE",
  "BAJFINANCE.BSE", "WIPRO.BSE", "TATAMOTORS.BSE", "TATASTEEL.BSE",
  "NTPC.BSE", "SUNPHARMA.BSE", "ADANIPORTS.BSE",
];

// Cache to avoid hitting API limits
let cache = {};
let cacheTime = {};
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function corsHeaders(ct) {
  return {
    "Content-Type": ct,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function fetchAV(params) {
  return new Promise((resolve, reject) => {
    const qs = Object.entries({ ...params, apikey: AV_KEY })
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
    const url = `${AV_BASE}?${qs}`;
    const u = new URL(url);

    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: "GET",
      headers: { "User-Agent": "Mozilla/5.0" },
    }, (apiRes) => {
      let chunks = [];
      apiRes.on("data", c => chunks.push(c));
      apiRes.on("end", () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch(e) { reject(e); }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

// Get quote for a single stock
async function getQuote(symbol) {
  const now = Date.now();
  if (cache[symbol] && (now - cacheTime[symbol]) < CACHE_TTL) {
    return cache[symbol];
  }
  try {
    const data = await fetchAV({ function: "GLOBAL_QUOTE", symbol });
    const q = data["Global Quote"];
    if (!q || !q["05. price"]) return null;
    const result = {
      symbol: symbol.replace(".BSE", ""),
      ltp: parseFloat(q["05. price"]).toFixed(2),
      open: parseFloat(q["02. open"]).toFixed(2),
      high: parseFloat(q["03. high"]).toFixed(2),
      low:  parseFloat(q["04. low"]).toFixed(2),
      prevClose: parseFloat(q["08. previous close"]).toFixed(2),
      change: parseFloat(q["09. change"]).toFixed(2),
      changePct: parseFloat(q["10. change percent"]).replace("%",""),
      volume: parseInt(q["06. volume"]),
    };
    cache[symbol] = result;
    cacheTime[symbol] = now;
    return result;
  } catch(e) {
    console.log(`❌ Failed to fetch ${symbol}:`, e.message);
    return null;
  }
}

// Get top gainers/losers/active from Alpha Vantage
async function getTopMovers() {
  const now = Date.now();
  if (cache["TOP_MOVERS"] && (now - cacheTime["TOP_MOVERS"]) < CACHE_TTL) {
    return cache["TOP_MOVERS"];
  }
  try {
    const data = await fetchAV({ function: "TOP_GAINERS_LOSERS" });
    cache["TOP_MOVERS"] = data;
    cacheTime["TOP_MOVERS"] = now;
    return data;
  } catch(e) {
    return null;
  }
}

// Fetch multiple stocks in parallel (batches to respect rate limits)
async function fetchStocks(symbols) {
  const results = [];
  // Fetch 5 at a time to avoid rate limiting
  for (let i = 0; i < symbols.length; i += 5) {
    const batch = symbols.slice(i, i + 5);
    const batchResults = await Promise.all(batch.map(getQuote));
    results.push(...batchResults.filter(Boolean));
    if (i + 5 < symbols.length) {
      await new Promise(r => setTimeout(r, 1000)); // 1s delay between batches
    }
  }
  return results;
}

// Build market summary from quotes
function buildMarketData(quotes) {
  const sorted = [...quotes].sort((a,b) => parseFloat(b.changePct) - parseFloat(a.changePct));
  return {
    gainers: sorted.filter(q => parseFloat(q.changePct) > 0).slice(0, 8),
    losers:  sorted.filter(q => parseFloat(q.changePct) < 0).reverse().slice(0, 5),
    active:  [...quotes].sort((a,b) => b.volume - a.volume).slice(0, 8),
    all:     quotes,
  };
}

// ── SERVER ────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const urlPath = req.url.split("?")[0];

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders("text/plain"));
    res.end();
    return;
  }

  if (urlPath === "/health") {
    res.writeHead(200, corsHeaders("application/json"));
    res.end(JSON.stringify({ status: "ok", source: "AlphaVantage", time: new Date().toISOString() }));
    return;
  }

  // Get all market data at once
  if (urlPath === "/market") {
    console.log(`📡 ${new Date().toLocaleTimeString()} → Fetching market data...`);
    try {
      const quotes = await fetchStocks(NSE_STOCKS);
      const market = buildMarketData(quotes);
      res.writeHead(200, corsHeaders("application/json"));
      res.end(JSON.stringify({ status: "ok", data: market, timestamp: new Date().toISOString() }));
    } catch(e) {
      res.writeHead(500, corsHeaders("application/json"));
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Get single stock quote
  if (urlPath.startsWith("/quote/")) {
    const symbol = urlPath.replace("/quote/", "") + ".BSE";
    console.log(`📡 ${new Date().toLocaleTimeString()} → Quote: ${symbol}`);
    try {
      const quote = await getQuote(symbol);
      if (!quote) throw new Error("No data for " + symbol);
      res.writeHead(200, corsHeaders("application/json"));
      res.end(JSON.stringify(quote));
    } catch(e) {
      res.writeHead(404, corsHeaders("application/json"));
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Get gainers
  if (urlPath === "/gainers") {
    try {
      const quotes = await fetchStocks(NSE_STOCKS);
      const market = buildMarketData(quotes);
      res.writeHead(200, corsHeaders("application/json"));
      res.end(JSON.stringify({ data: market.gainers }));
    } catch(e) {
      res.writeHead(500, corsHeaders("application/json"));
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  res.writeHead(404, corsHeaders("application/json"));
  res.end(JSON.stringify({ error: "Unknown endpoint", available: ["/health", "/market", "/gainers", "/quote/RELIANCE"] }));
});

server.listen(PORT, () => {
  console.log(`\n🚀 NSE Intraday AI Proxy (Alpha Vantage) running on port ${PORT}`);
  console.log(`\n📊 Tracking ${NSE_STOCKS.length} NSE stocks`);
  console.log(`🔑 Alpha Vantage API: configured`);
  console.log(`\n✅ Ready!\n`);
});

