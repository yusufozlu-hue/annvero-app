"use client";

import {
  formatCorePreviewPercent,
  formatCoreYesNo,
  isMovementTaughtForDisplay,
  movementNeedsCoreTeach,
} from "@/src/utils/bankCorePreview";

const thClass =
  "border border-slate-800/80 bg-slate-950/90 px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400";
const tdClass = "border border-slate-800/60 px-2 py-1.5 text-xs text-slate-100";

const teachButtonClass =
  "inline-flex shrink-0 items-center justify-center rounded-lg border border-indigo-500/50 bg-indigo-950/60 px-2.5 py-1 text-[11px] font-semibold text-indigo-100 shadow-sm shadow-indigo-950/40 transition hover:border-indigo-400/70 hover:bg-indigo-900/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-400";

export default function CorePreviewTable({
  movements = [],
  displayedCount = 100,
  onTeachClick,
  showTeachButton = true,
  showTeachForMovement,
}) {
  const rows = movements.slice(0, displayedCount);

  if (!rows.length) {
    return <p className="text-sm text-slate-500">CORE önizleme verisi yok.</p>;
  }

  const canTeach = (movement) => {
    if (!showTeachButton) return false;
    if (showTeachForMovement) return showTeachForMovement(movement);
    return movementNeedsCoreTeach(movement);
  };

  return (
    <div className="max-w-full min-w-0 overflow-x-auto rounded-xl border border-slate-800/80 bg-slate-950/30">
      <table className="w-full min-w-[960px] border-collapse">
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
            {showTeachButton ? <th className={`${thClass} min-w-[108px]`}>Öğret</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((movement, index) => {
            const preview = movement.corePreview || {};
            const taught = isMovementTaughtForDisplay(movement);
            const teachable = canTeach(movement);

            return (
              <tr key={movement.id || index} className="hover:bg-slate-900/40">
                <td className={tdClass}>{index + 1}</td>
                <td className={`${tdClass} max-w-[220px]`}>
                  <span className="line-clamp-2 break-words">{movement.description || "—"}</span>
                </td>
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
                  <td className={`${tdClass} whitespace-nowrap`}>
                    {taught ? (
                      <span className="inline-flex rounded-md border border-emerald-700/50 bg-emerald-950/40 px-2 py-1 text-[11px] font-semibold text-emerald-200">
                        Öğretildi
                      </span>
                    ) : teachable ? (
                      <button
                        type="button"
                        onClick={() => onTeachClick?.(movement, index)}
                        className={teachButtonClass}
                        title="CORE'a öğret"
                      >
                        CORE&apos;a Öğret
                      </button>
                    ) : (
                      <span className="text-slate-500">—</span>
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
