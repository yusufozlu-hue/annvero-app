import http from "node:http";
import {
  clearBrowserSession,
  storeBrowserSession,
  takeBrowserSession,
} from "./src/gibBrowserSessionStore.mjs";
import {
  completeGibLoginAndFetchTebligat,
  startGibLoginSession,
} from "./src/gibPortalAutomation.mjs";

const PORT = Number(process.env.PORT || 8787);
const SERVICE_TOKEN = String(process.env.GIB_AUTOMATION_SERVICE_TOKEN || "").trim();

function isAuthorized(req) {
  if (!SERVICE_TOKEN) return true;
  const header = String(req.headers.authorization || "");
  return header === `Bearer ${SERVICE_TOKEN}`;
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (!chunks.length) return {};

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Geçersiz JSON gövdesi.");
  }
}

async function handleStart(body = {}) {
  const sessionId = String(body.sessionId || "").trim();
  if (!sessionId) {
    return { status: 400, payload: { ok: false, error: "sessionId zorunludur." } };
  }

  const credentials = {
    gibUserCode: body.gibUserCode || "",
    password: body.password || "",
    parola: body.parola || "",
  };

  try {
    const loginSession = await startGibLoginSession(credentials);
    if (loginSession.bundle) {
      storeBrowserSession(sessionId, loginSession.bundle);
    }

    return {
      status: 200,
      payload: {
        ok: true,
        sessionId,
        captchaImageBase64: loginSession.captchaImageBase64,
        storageState: loginSession.storageState || null,
      },
    };
  } catch (error) {
    clearBrowserSession(sessionId);
    return {
      status: 400,
      payload: { ok: false, error: error.message || "GİB oturumu başlatılamadı." },
    };
  }
}

async function handleVerify(body = {}) {
  const sessionId = String(body.sessionId || "").trim();
  const verificationCode = String(body.verificationCode || "").trim();

  if (!sessionId) {
    return { status: 400, payload: { ok: false, error: "sessionId zorunludur." } };
  }

  if (!verificationCode) {
    return { status: 400, payload: { ok: false, error: "verificationCode zorunludur." } };
  }

  const bundle = takeBrowserSession(sessionId);

  try {
    const result = await completeGibLoginAndFetchTebligat({
      storageState: body.storageState || null,
      verificationCode,
      bundle,
    });

    if (!result.ok) {
      clearBrowserSession(sessionId);
      return {
        status: 400,
        payload: { ok: false, error: result.error || "GİB doğrulaması başarısız." },
      };
    }

    clearBrowserSession(sessionId);
    return {
      status: 200,
      payload: {
        ok: true,
        notifications: result.notifications || [],
      },
    };
  } catch (error) {
    clearBrowserSession(sessionId);
    return {
      status: 400,
      payload: { ok: false, error: error.message || "GİB doğrulaması başarısız." },
    };
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (!isAuthorized(req)) {
      sendJson(res, 401, { ok: false, error: "Yetkisiz istek." });
      return;
    }

    const url = req.url?.split("?")[0] || "/";

    if (req.method === "GET" && url === "/health") {
      sendJson(res, 200, { ok: true, service: "gib-automation" });
      return;
    }

    if (req.method !== "POST") {
      sendJson(res, 405, { ok: false, error: "Yalnızca POST desteklenir." });
      return;
    }

    const body = await readJsonBody(req);

    if (url === "/query/start") {
      const result = await handleStart(body);
      sendJson(res, result.status, result.payload);
      return;
    }

    if (url === "/query/verify") {
      const result = await handleVerify(body);
      sendJson(res, result.status, result.payload);
      return;
    }

    sendJson(res, 404, { ok: false, error: "Endpoint bulunamadı." });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message || "Sunucu hatası." });
  }
});

server.listen(PORT, () => {
  console.log(`[gib-automation] listening on :${PORT}`);
});
