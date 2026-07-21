# CSP nonce geçiş planı (P2)

Mevcut production CSP `script-src 'unsafe-inline'` içerir (Next.js hydrate).
Bu aşamada kaldırmak AuthGate / SSR shell / banka parser performansını bozma riski taşır.

## Plan

1. Next.js middleware/proxy’de request başına nonce üret
2. `headers()` CSP’ye `script-src 'nonce-…'` ekle; geçiş döneminde `strict-dynamic` değerlendir
3. Inline script’leri nonce’lu hale getir veya kaldır
4. Staging’de CSP report-only modunda 1 hafta izle
5. `unsafe-inline` kaldır; regresyon: login, firma seçici, banka parser, luca

**Durum:** plan dokümante — uygulanmadı.
