// NSE Data Proxy — Lightweight Version
// Only fetches NSE market data (no API key needed!)
// Run with: node proxy.js

const http  = require("http");
const https = require("https");

const PORT = 3001;

const NSE_ENDPOINTS = {
  "/gainers": "https://www.nseindia.com/api/live-analysis-variations?index=gainers",
  "/losers":  "https://www.nseindia.com/api/live-analysis-variations?index=losers",
  "/volume":  "https://www.nseindia.com/api/live-analysis-variations?index=volume",
  "/indices": "https://www.nseindia.com/api/allIndices",
};

let nseSessionCookie = "";

function corsHeaders(ct) {
  return {
    "Content-Type": ct,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function getNSECookie(cb) {
  const req = https.request({
    hostname: "www.nseindia.com", path: "/", method: "GET",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml",
    },
  }, (res) => {
    const c = res.headers["set-cookie"];
    if (c) nseSessionCookie = c.map(x => x.split(";")[0]).join("; ");
    console.log(nseSessionCookie ? "✅ NSE cookie obtained" : "⚠️  No NSE cookie");
    if (cb) cb();
  });
  req.on("error", e => { console.log("⚠️  Cookie error:", e.message); if (cb) cb(); });
  req.end();
}

function fetchNSE(url, res) {
  const u = new URL(url);
  const req = https.request({
    hostname: u.hostname, path: u.pathname + u.search, method: "GET",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
      "Accept": "application/json, text/plain, */*",
      "Referer": "https://www.nseindia.com/",
      "Cookie": nseSessionCookie,
    },
  }, (apiRes) => {
    let chunks = [];
    apiRes.on("data", c => chunks.push(c));
    apiRes.on("end", () => {
      res.writeHead(200, corsHeaders("application/json"));
      res.end(Buffer.concat(chunks).toString());
    });
  });
  req.on("error", e => {
    res.writeHead(500, corsHeaders("application/json"));
    res.end(JSON.stringify({ error: e.message }));
  });
  req.end();
}

const server = http.createServer((req, res) => {
  const urlPath = req.url.split("?")[0];

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders("text/plain"));
    res.end();
    return;
  }

  if (urlPath === "/health") {
    res.writeHead(200, corsHeaders("application/json"));
    res.end(JSON.stringify({ status: "ok", cookie: !!nseSessionCookie }));
    return;
  }

  if (NSE_ENDPOINTS[urlPath]) {
    console.log(`📡 ${new Date().toLocaleTimeString("en-IN")} → ${urlPath}`);
    if (!nseSessionCookie) getNSECookie(() => fetchNSE(NSE_ENDPOINTS[urlPath], res));
    else fetchNSE(NSE_ENDPOINTS[urlPath], res);
    return;
  }

  res.writeHead(404, corsHeaders("application/json"));
  res.end(JSON.stringify({ error: "Unknown endpoint" }));
});

server.listen(PORT, () => {
  console.log(`\n🚀 NSE Data Proxy running on http://localhost:${PORT}`);
  console.log(`\n📊 Available endpoints:`);
  Object.keys(NSE_ENDPOINTS).forEach(e => console.log(`   http://localhost:${PORT}${e}`));
  console.log(`\n🔑 Getting NSE session cookie...`);
  getNSECookie(() => console.log(`✅ Ready! Keep this window open.\n`));
});
