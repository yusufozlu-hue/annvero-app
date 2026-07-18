/**
 * Production login timing probe (no .env).
 * node scripts/probe-login-timing.mjs
 */
async function measure(url, n = 3) {
  const results = [];
  for (let i = 0; i < n; i++) {
    const t0 = Date.now();
    const chain = [];
    let current = url;
    let finalRes = null;
    for (let hops = 0; hops < 8; hops++) {
      const start = Date.now();
      const res = await fetch(current, {
        redirect: "manual",
        headers: { "cache-control": "no-cache", pragma: "no-cache" },
      });
      const ms = Date.now() - start;
      const loc = res.headers.get("location");
      chain.push({
        status: res.status,
        ms,
        location: loc,
        cache: res.headers.get("x-vercel-cache"),
      });
      if (res.status >= 300 && res.status < 400 && loc) {
        current = new URL(loc, current).href;
        continue;
      }
      finalRes = res;
      break;
    }
    let body = "";
    if (finalRes && finalRes.status === 200) {
      body = await finalRes.text();
    }
    results.push({
      total_ms: Date.now() - t0,
      chain,
      body_bytes: body.length,
      hasHeading: body.includes("Hesabınıza giriş"),
      hasEmail: body.includes("type=\"email\"") || body.includes("annvero-email"),
      hasRemember: body.includes("Beni hatırla"),
      hasAuthLoading: /Oturum kontrol|AuthLoading/i.test(body),
      hasNextQuery: body.includes("?next="),
    });
  }
  console.log("\n===", url, "===");
  console.log(JSON.stringify(results, null, 2));
}

for (const u of [
  "https://www.annvero.com/login",
  "https://www.annvero.com/",
  "https://annvero.com/login",
  "https://annvero.com/",
]) {
  await measure(u, 3);
}
