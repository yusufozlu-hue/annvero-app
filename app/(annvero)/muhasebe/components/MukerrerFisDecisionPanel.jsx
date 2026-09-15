"use client";

import {
  MUKERRER_DECISION_KEEP_ALL,
  MUKERRER_DECISION_KEEP_FIRST,
  MUKERRER_DECISION_MANUAL,
  createMukerrerDecision,
  isMukerrerDecisionResolved,
  resolveMukerrerKeepFisNos,
} from "@/src/utils/fisDonusturmeMukerrerDecisions";

function formatMoney(value) {
  return Number(value || 0).toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function MukerrerFisDecisionPanel({
  groups = [],
  decisions = {},
  onDecisionChange,
}) {
  if (!groups.length) return null;

  return (
    <section className="rounded-2xl border border-amber-800/50 bg-gray-900 p-5">
      <h2 className="mb-1 text-lg font-semibold text-amber-100">
        Mükerrer fiş grupları
      </h2>
      <p className="mb-4 text-sm text-gray-400">
        Karar verilmeden Luca Excel engellenir. Varsayılan seçim yok; sistem fiş
        silmez.
      </p>

      <div className="space-y-5">
        {groups.map((group, groupIndex) => {
          const decision = decisions[group.id] || null;
          const resolved = isMukerrerDecisionResolved(decision);
          const keepSet = new Set(resolveMukerrerKeepFisNos(group, decision) || []);
          const manualSelected = new Set(
            decision?.mode === MUKERRER_DECISION_MANUAL
              ? decision.keepFisNos || []
              : []
          );

          return (
            <div
              key={group.id}
              className="rounded-xl border border-gray-800 bg-gray-950/70 p-4"
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-white">
                  Grup {groupIndex + 1}: {group.fisNos.join(", ")}
                </h3>
                <span
                  className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                    resolved
                      ? "border-emerald-700/60 bg-emerald-950/40 text-emerald-300"
                      : "border-amber-700/60 bg-amber-950/40 text-amber-300"
                  }`}
                >
                  {resolved ? "Karar verildi" : "Karar bekleniyor"}
                </span>
              </div>

              <div className="mb-4 w-full max-w-full overflow-x-auto">
                <table className="min-w-[640px] w-full text-left text-xs text-gray-300">
                  <thead className="text-[11px] uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-2 py-1">Fiş</th>
                      <th className="px-2 py-1">Tarih</th>
                      <th className="px-2 py-1">Belge</th>
                      <th className="px-2 py-1">Hesaplar</th>
                      <th className="px-2 py-1">Borç</th>
                      <th className="px-2 py-1">Alacak</th>
                      <th className="px-2 py-1">Açıklama</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.vouchers.map((voucher) => {
                      const kept =
                        resolved &&
                        [...keepSet].some((fis) => fis === voucher.fisNo);
                      const dropped = resolved && !kept;
                      return (
                        <tr
                          key={voucher.fisNo}
                          className={`border-t border-gray-800 ${
                            dropped ? "opacity-50" : ""
                          }`}
                        >
                          <td className="px-2 py-2 font-mono text-white">
                            {voucher.fisNo}
                            {kept ? (
                              <span className="ml-2 text-[10px] text-emerald-400">
                                aktar
                              </span>
                            ) : null}
                            {dropped ? (
                              <span className="ml-2 text-[10px] text-amber-400">
                                export dışı
                              </span>
                            ) : null}
                          </td>
                          <td className="px-2 py-2">{voucher.fisTarihi || "—"}</td>
                          <td className="px-2 py-2">{voucher.belgeTuru || "—"}</td>
                          <td className="px-2 py-2 font-mono">
                            {voucher.hesapKodlari.join(", ")}
                          </td>
                          <td className="px-2 py-2">{formatMoney(voucher.borc)}</td>
                          <td className="px-2 py-2">{formatMoney(voucher.alacak)}</td>
                          <td className="px-2 py-2 max-w-[220px] truncate" title={voucher.aciklama}>
                            {voucher.aciklama || "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex w-full max-w-full flex-col gap-2 sm:flex-row sm:flex-wrap">
                <button
                  type="button"
                  onClick={() =>
                    onDecisionChange(
                      group.id,
                      createMukerrerDecision(
                        MUKERRER_DECISION_KEEP_FIRST,
                        [],
                        group
                      )
                    )
                  }
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                    decision?.mode === MUKERRER_DECISION_KEEP_FIRST
                      ? "border-indigo-500 bg-indigo-950/60 text-indigo-200"
                      : "border-gray-700 bg-gray-900 text-gray-300 hover:border-indigo-500"
                  }`}
                >
                  İlk fişi koru, diğerlerini çıkar
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onDecisionChange(
                      group.id,
                      createMukerrerDecision(
                        MUKERRER_DECISION_KEEP_ALL,
                        [],
                        group
                      )
                    )
                  }
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                    decision?.mode === MUKERRER_DECISION_KEEP_ALL
                      ? "border-indigo-500 bg-indigo-950/60 text-indigo-200"
                      : "border-gray-700 bg-gray-900 text-gray-300 hover:border-indigo-500"
                  }`}
                >
                  Hepsi gerçek, tamamını aktar
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onDecisionChange(
                      group.id,
                      createMukerrerDecision(
                        MUKERRER_DECISION_MANUAL,
                        decision?.mode === MUKERRER_DECISION_MANUAL
                          ? decision.keepFisNos
                          : [group.firstFisNo],
                        group
                      )
                    )
                  }
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                    decision?.mode === MUKERRER_DECISION_MANUAL
                      ? "border-indigo-500 bg-indigo-950/60 text-indigo-200"
                      : "border-gray-700 bg-gray-900 text-gray-300 hover:border-indigo-500"
                  }`}
                >
                  Tek tek seç
                </button>
                {decision ? (
                  <button
                    type="button"
                    onClick={() => onDecisionChange(group.id, null)}
                    className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-1.5 text-xs font-semibold text-gray-400 hover:border-red-600 hover:text-red-300"
                  >
                    Kararı geri al
                  </button>
                ) : null}
              </div>

              {decision?.mode === MUKERRER_DECISION_MANUAL ? (
                <div className="mt-3 flex flex-wrap gap-3">
                  {group.fisNos.map((fisNo) => {
                    const checked = manualSelected.has(fisNo);
                    return (
                      <label
                        key={fisNo}
                        className="flex items-center gap-2 text-xs text-gray-300"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            const next = new Set(manualSelected);
                            if (checked) next.delete(fisNo);
                            else next.add(fisNo);
                            onDecisionChange(
                              group.id,
                              createMukerrerDecision(
                                MUKERRER_DECISION_MANUAL,
                                [...next],
                                group
                              )
                            );
                          }}
                        />
                        {fisNo} aktar
                      </label>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
