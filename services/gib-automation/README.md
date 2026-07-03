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
Using Detected Dockerfile
FROM mcr.microsoft.com/playwright:v1.61.1-jammy
Base image: mcr.microsoft.com/playwright:v1.61.1-jammy
Railway builder: DOCKERFILE
```

**Görmemeniz gerekenler** (eski Node/Nixpacks deploy):

```
Nixpacks
Railpack
node:22
libglib-2.0.so.0: cannot open shared object
```

Loglarda `mcr.microsoft.com/playwright` görünmüyorsa Root Directory veya `railway.json` path yanlıştır.

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

`/health` yanıtında `runtime: "docker-playwright"` ve `playwrightImage: "mcr.microsoft.com/playwright:v1.61.1-jammy"` beklenir.

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
