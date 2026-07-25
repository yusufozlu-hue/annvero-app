# ANNVERO Design System V1

Kurumsal ofis paneli için temel görsel dil. Referans ruhu (koyu premium panel, mor–indigo aktif vurgu, temiz ikon hiyerarşisi) ANNVERO markasına uyarlanmıştır; dış marka/ekran birebir kopyalanmaz.

## Token kaynakları

| Kaynak | Rol |
|---|---|
| `app/globals.css` | CSS değişkenleri (`--annvero-*`), sidebar motion / scrollbar / tooltip |
| `src/styles/annveroDesign.js` | JS sınıf sabitleri, sidebar genişlikleri, daraltma tercihi |

## Temel token aileleri

- **Yüzey:** `--annvero-bg`, `--annvero-surface`, `--annvero-surface-2`, `--annvero-shell`, `--annvero-shell-elevated`
- **Metin:** `--annvero-text`, `--annvero-text-secondary`, `--annvero-text-muted`, `--annvero-shell-muted`
- **Vurgu:** `--annvero-accent`, `--annvero-accent-2`, `--annvero-accent-soft`, `--annvero-accent-gradient`, `--annvero-active`, `--annvero-hover`
- **Durum:** `--annvero-success`, `--annvero-warning`, `--annvero-danger`
- **Geometri:** `--annvero-radius-sm|md|lg|xl`, `--annvero-space-*`, `--annvero-shadow-*`
- **Motion:** `--annvero-motion-fast` (160ms), `--annvero-motion-menu` (200ms), `--annvero-motion-ease`
- **Katman:** `--annvero-z-overlay`, `--annvero-z-sidebar`, `--annvero-z-tooltip`
- **Sidebar:** `--annvero-sidebar-width` (302px), `--annvero-sidebar-collapsed-width` (72px)

Bileşenlerde rastgele hex/radius kullanmayın; bu token’lardan tüketin.

## Ofis sidebar (bu sürümde uygulandı)

- Geniş/dar animasyon: `width` + etiketlerde `opacity` / `transform` / `max-width`
- Alt menü açılışı: `grid-template-rows: 0fr → 1fr` (~200ms); `height: auto` animasyonu yok
- Prefetch: yalnız pointerDown/click intent; `prefetch={false}`; hover prefetch yok
- Daraltma tercihi: `annvero_sidebar_collapsed_v1`
- `prefers-reduced-motion`: geçişler kapatılır

## Müşteri portalı — tasarım notu (henüz kodlanmadı)

Müşteri yüzeyi aynı token ailesinin **sade** sürümünü kullanacak. Ofis menüsünün karmaşık grup/alt menü ağacı gösterilmeyecek.

Planlanan müşteri yüzeyleri:

1. **Evrak Yükle**
2. **Bekleyen Evraklar**
3. **Tebligatlar**
4. **Muhasebecime Mesaj**
5. **Borç / Tahakkuk Durumu**

Kurallar:

- Aynı koyu lacivert / mor–indigo / radius / tipografi ailesi
- Daha az menü; tek seviyeli aksiyon kartları tercih
- Ofis “Operasyon Paneli” karmaşıklığı taşınmaz
- Bu turda route/modül eklenmez; yalnız design system notudur
