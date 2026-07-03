# GİB Automation Service

Playwright tabanlı kalıcı Node servisi. Vercel'deki Next.js uygulaması bu servise HTTP ile bağlanır.

## Railway deploy (Docker zorunlu)

Railway varsayılan olarak Railpack/Nixpacks kullanabilir. Bu servis **yalnızca Dockerfile** ile çalışmalıdır.

### 1. Servis ayarları (Dashboard)

| Ayar | Değer |
|------|-------|
| **Root Directory** | `services/gib-automation` |
| **Config-as-code file** | `/services/gib-automation/railway.json` |
| **Builder** | `DOCKERFILE` (Railpack/Nixpacks kapalı olmalı) |
| **Dockerfile path** | `Dockerfile` |
| **Start command** | `npm start` (veya boş bırakın — Dockerfile `CMD` kullanır) |

İsteğe bağlı servis değişkeni:

```
RAILWAY_DOCKERFILE_PATH=Dockerfile
```

### 2. Deploy loglarında görmeniz gerekenler

Başarılı Docker build logları:

```
>>> Railway proof: Using Detected Dockerfile <<<
>>> FROM mcr.microsoft.com/playwright:v1.61.1-jammy <<<
Docker build chromium path: /ms-playwright/...
>>> build-proof.json <<<
```

Servis ayağa kalkınca runtime logları:

```
[gib-automation] startup diagnostics
runtime: docker-playwright
image: mcr.microsoft.com/playwright:v1.61.1-jammy
playwright.launchTest.ok: true
verified: true
```

`/health` yanıtı (deploy sonrası doğrulama):

```json
{
  "ok": true,
  "verified": true,
  "runtime": "docker-playwright",
  "image": "mcr.microsoft.com/playwright:v1.61.1-jammy",
  "deploy": {
    "builder": "DOCKERFILE",
    "proof": "Using Detected Dockerfile — built from mcr.microsoft.com/playwright:v1.61.1-jammy"
  },
  "playwright": {
    "executablePath": "/ms-playwright/...",
    "launchTest": { "ok": true }
  }
}
```

Canlı launch testini yeniden çalıştırmak için: `GET /health?refresh=1`

### 3. Ortam değişkenleri

| Değişken | Açıklama |
|----------|----------|
| `PORT` | Railway otomatik atar |
| `GIB_AUTOMATION_SERVICE_TOKEN` | İsteğe bağlı Bearer token |
| `GIB_AUTOMATION_MOCK` | `1` ise Playwright kullanmadan mock yanıt |
| `GIB_PLAYWRIGHT_HEADLESS` | `0` değilse headless tarayıcı |

### 4. Vercel bağlantısı

```
GIB_AUTOMATION_SERVICE_URL=https://your-service.up.railway.app
GIB_AUTOMATION_SERVICE_TOKEN=shared-secret
```

`/health` yanıtında `verified: true`, `runtime: "docker-playwright"` ve `playwright.launchTest.ok: true` beklenir.

## Yerel geliştirme

```bash
cd services/gib-automation
npm install
npm start
```

Varsayılan port: `8787`

## Endpoint'ler

- `GET /health` — sağlık kontrolü (runtime, playwright image, commit)
- `POST /query/start` — GİB giriş oturumu başlatır, captcha döner
- `POST /query/verify` — doğrulama kodu ile giriş yapar, tebligatları döner
