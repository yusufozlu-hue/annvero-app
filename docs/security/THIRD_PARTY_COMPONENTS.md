# Third-party components — güvenlik notları

Gerçek secret içermez.

## SheetJS (xlsx)

| Alan | Değer |
|------|--------|
| Paket adı | `xlsx` |
| Sürüm | `0.20.3` |
| Resmî kaynak URL | https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz |
| Vendor yolu | `vendor/xlsx-0.20.3.tgz` |
| package.json | `"xlsx": "file:vendor/xlsx-0.20.3.tgz"` |
| SHA-256 | `8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8` |
| İndirme tarihi (UTC) | 2026-07-20 |
| Lisans | Apache-2.0 |
| Lisans dosyası | `vendor/xlsx-LICENSE.txt` |
| Build-time CDN | Yok — tarball repoda vendored; build CDN’e bağlanmaz |

### Notlar

- npm registry’deki eski `xlsx@0.18.5` kullanılmaz (bilinen high CVE).
- SheetJS Community Edition Apache-2.0 altında dağıtılır; LICENSE metni `vendor/xlsx-LICENSE.txt` içinde korunur.
- Runtime sürüm doğrulama: `npm run test:xlsx-version`
- Güvenli sarmalayıcı: `src/utils/safeXlsx.js` (`cellHTML: false`, formula injection sanitize on export)

### Önceki sürüm

- `xlsx@^0.18.5` (npm registry) — kaldırıldı.
