/**
 * Soft-navigation sırasında eski sayfa ile yeni içeriğin üst üste binmesini
 * ve beyazımsı flash’ı önlemek için segment Suspense fallback’i.
 * Shell (sidebar/topbar) korunur; yalnızca main children değişir.
 * Spinner yok — koyu opak boş yüzey (görsel patlama yaratmaz).
 */
export default function AnnveroSegmentLoading() {
  return (
    <div
      className="annvero-route-pending min-h-[48vh] w-full flex-1 bg-[var(--annvero-bg)]"
      aria-hidden
    />
  );
}
