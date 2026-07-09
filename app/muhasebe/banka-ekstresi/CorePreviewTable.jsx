"use client";

import {
  formatCorePreviewPercent,
  formatCoreYesNo,
  isMovementTeachable,
} from "@/src/utils/bankCorePreview";

const thClass =
  "border border-gray-800 bg-gray-950 px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-400";
const tdClass = "border border-gray-800 px-2 py-1.5 text-xs text-gray-100";

export default function CorePreviewTable({
  movements = [],
  displayedCount = 100,
  onTeachClick,
  showTeachButton = true,
}) {
  const rows = movements.slice(0, displayedCount);

  if (!rows.length) {
    return <p className="text-sm text-gray-500">CORE önizleme verisi yok.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-800">
      <table className="min-w-full border-collapse">
        <thead>
          <tr>
            <th className={thClass}>#</th>
            <th className={thClass}>Açıklama</th>
            <th className={thClass}>CORE Durumu</th>
            <th className={thClass}>Entity</th>
            <th className={thClass}>Hesap Önerisi</th>
            <th className={thClass}>Cari</th>
            <th className={thClass}>Belge Türü</th>
            <th className={thClass}>Güven Skoru</th>
            <th className={thClass}>Risk</th>
            <th className={thClass}>İnceleme Gerekli mi?</th>
            <th className={thClass}>Kaynak</th>
            {showTeachButton ? <th className={thClass}>Öğret</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((movement, index) => {
            const preview = movement.corePreview || {};
            const teachable = showTeachButton && isMovementTeachable(movement);

            return (
              <tr key={movement.id || index} className="hover:bg-gray-900/50">
                <td className={tdClass}>{index + 1}</td>
                <td className={tdClass}>{movement.description || "—"}</td>
                <td className={tdClass}>{preview.core_status || movement._coreStatus || "—"}</td>
                <td className={tdClass}>{preview.matched_entity || "—"}</td>
                <td className={tdClass}>
                  {preview.suggested_account_code || movement.counterAccountCode || "—"}
                </td>
                <td className={tdClass}>{preview.suggested_cari || "—"}</td>
                <td className={tdClass}>
                  {preview.suggested_document_type || movement.documentType || "—"}
                </td>
                <td className={tdClass}>
                  {formatCorePreviewPercent(preview.confidence_score ?? movement._coreConfidence)}
                </td>
                <td className={tdClass}>{preview.risk_level || movement._coreRiskLevel || "—"}</td>
                <td className={tdClass}>{formatCoreYesNo(preview.needs_manual_review)}</td>
                <td className={tdClass}>
                  {preview.decision_source || movement._coreDecisionSource || "—"}
                </td>
                {showTeachButton ? (
                  <td className={tdClass}>
                    {teachable ? (
                      <button
                        type="button"
                        onClick={() => onTeachClick?.(movement, index)}
                        className="rounded border border-indigo-600 px-2 py-1 text-[11px] font-semibold text-indigo-200 hover:bg-indigo-950"
                      >
                        CORE&apos;a Öğret
                      </button>
                    ) : (
                      <span className="text-gray-500">—</span>
                    )}
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
