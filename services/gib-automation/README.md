# GİB Automation Service

Playwright tabanlı kalıcı Node servisi. Vercel'deki Next.js uygulaması bu servise HTTP ile bağlanır.

## Railway deploy

1. Yeni servis oluşturun ve **Root Directory** olarak `services/gib-automation` seçin.
2. **Settings → Config-as-code** alanında config dosyasını açıkça belirtin:
   `/services/gib-automation/railway.json`
   (Railway config dosyası root directory'yi takip etmez.)
3. `railway.json` içinde `builder: "DOCKERFILE"` tanımlıdır; Nixpacks/Railpack devre dışı kalır.
4. Deploy loglarında şu satırları görmelisiniz:
   - `Using Detected Dockerfile`
   - `==> Railway Docker build: annvero-gib-automation`
   - `==> Base image: mcr.microsoft.com/playwright:v1.61.1-jammy`
5. Ortam değişkenlerini ekleyin (`GIB_AUTOMATION_SERVICE_TOKEN` vb.).
6. Vercel tarafında `GIB_AUTOMATION_SERVICE_URL` değerini Railway public URL ile güncelleyin.

`PORT` Railway tarafından atanır; servis `process.env.PORT` üzerinden dinler.

## Kurulum

```bash
cd services/gib-automation
npm install
npm start
```

Varsayılan port: `8787`

## Endpoint'ler

- `GET /health` — sağlık kontrolü
- `POST /query/start` — GİB giriş oturumu başlatır, captcha döner
- `POST /query/verify` — doğrulama kodu ile giriş yapar, tebligatları döner

## Ortam değişkenleri

| Değişken | Açıklama |
|----------|----------|
| `PORT` | Dinlenecek port (varsayılan: 8787) |
| `GIB_AUTOMATION_SERVICE_TOKEN` | İsteğe bağlı Bearer token |
| `GIB_AUTOMATION_MOCK` | `1` ise Playwright kullanmadan mock yanıt |
| `GIB_PLAYWRIGHT_HEADLESS` | `0` değilse headless tarayıcı |

## Vercel tarafı

Next.js uygulamasında şu env tanımlanmalı:

```
GIB_AUTOMATION_SERVICE_URL=https://your-service.example.com
GIB_AUTOMATION_SERVICE_TOKEN=shared-secret   # opsiyonel
```

Servis URL'si yoksa API `503` ile **GİB robot servisi yapılandırılmamış** döner.
