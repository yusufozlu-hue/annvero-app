"use client";

import {
  formatCorePreviewPercent,
  formatCoreYesNo,
} from "@/src/utils/bankCorePreview";

const thClass =
  "border border-gray-800 bg-gray-950 px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-400";
const tdClass = "border border-gray-800 px-2 py-1.5 text-xs text-gray-100";

export default function CorePreviewTable({ movements = [], displayedCount = 100 }) {
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
          </tr>
        </thead>
        <tbody>
          {rows.map((movement, index) => {
            const preview = movement.corePreview || {};
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
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
