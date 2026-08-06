"use client";

import { useMemo, useState } from "react";
import { canApplyBalanceResolution } from "@/src/utils/bankBalanceResolution";

function finiteOrNull(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatAmount(value) {
  const n = finiteOrNull(value);
  if (n == null) return "—";
  return n.toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function evidenceLabel(evidence) {
  if (!evidence) return "Kaynak kanıtı bulunamadı";
  const page = evidence.sourcePage ?? "—";
  const line = evidence.sourceLine ?? "—";
  const confidence =
    finiteOrNull(evidence.confidence) == null
      ? "—"
      : `%${Math.round(Number(evidence.confidence) * 100)}`;
  return `Sayfa ${page} · Satır ${line} · Güven ${confidence}`;
}

function cloneDraft(draft) {
  return {
    ...draft,
    rows: (draft.rows || []).map((row) => ({ ...row })),
  };
}

export default function BalanceMismatchResolutionCenter({
  result,
  onClose,
  onApply,
  isApplying = false,
}) {
  const originalRows = useMemo(
    () => (result.balanceResolutionRows || []).map((row) => ({ ...row })),
    [result.balanceResolutionRows]
  );
  const originalBalance = useMemo(
    () => ({
      openingBalance: result.openingBalance,
      closingBalance: result.statementClosingBalance,
    }),
    [result.openingBalance, result.statementClosingBalance]
  );
  const [draft, setDraft] = useState(() => ({
    openingBalance: result.openingBalance ?? "",
    closingBalance: result.statementClosingBalance ?? "",
    rows: originalRows,
    userConfirmed: false,
    learnForCompany: originalRows.some((row) => row.learningEligible),
  }));
  const [history, setHistory] = useState([]);

  const updateDraft = (updater) => {
    setHistory((previous) => [...previous.slice(-19), cloneDraft(draft)]);
    setDraft((current) => ({
      ...updater(cloneDraft(current)),
      userConfirmed: false,
    }));
  };

  const live = useMemo(() => {
    let credits = 0;
    let debits = 0;
    for (const row of draft.rows || []) {
      if (!row.included) continue;
      const amount = Math.abs(finiteOrNull(row.amount) ?? 0);
      if (row.direction === "debit") debits += amount;
      else credits += amount;
    }
    const opening = finiteOrNull(draft.openingBalance);
    const closing = finiteOrNull(draft.closingBalance);
    const expected =
      opening == null ? null : Number((opening + credits - debits).toFixed(2));
    const delta =
      expected == null || closing == null
        ? null
        : Number((expected - closing).toFixed(2));
    return {
      credits: Number(credits.toFixed(2)),
      debits: Number(debits.toFixed(2)),
      expected,
      delta,
    };
  }, [draft]);

  const permission = canApplyBalanceResolution({
    draft,
    originalBalance,
    originalRows,
  });
  const learnEligible = draft.rows.some(
    (row) => row.learningEligible && row.included
  );

  return (
    <section
      className="mt-4 rounded-2xl border border-amber-600/50 bg-slate-950/90 p-4 sm:p-6"
      data-testid="bank-balance-resolution-center"
      aria-label="Bakiye Uyuşmazlığı Çözüm Merkezi"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-white">
            Bakiye Uyuşmazlığı Çözüm Merkezi
          </h3>
          <p className="mt-1 text-sm text-amber-100/80">
            Değişiklikler yalnız açık onaydan sonra revision olarak uygulanır.
            Kaynak dosya yeniden yüklenmez.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={isApplying}
          className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 disabled:opacity-50"
        >
          Kapat
        </button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
          <span className="text-xs uppercase tracking-wide text-slate-400">
            Açılış bakiyesi
          </span>
          <input
            type="number"
            step="0.01"
            value={draft.openingBalance}
            onChange={(event) =>
              updateDraft((current) => ({
                ...current,
                openingBalance: event.target.value,
              }))
            }
            className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
          />
          <span className="mt-2 block text-xs text-slate-500">
            {evidenceLabel(result.openingEvidence)}
          </span>
        </label>
        <label className="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
          <span className="text-xs uppercase tracking-wide text-slate-400">
            Ekstre kapanış bakiyesi
          </span>
          <input
            type="number"
            step="0.01"
            value={draft.closingBalance}
            onChange={(event) =>
              updateDraft((current) => ({
                ...current,
                closingBalance: event.target.value,
              }))
            }
            placeholder={
              result.code === "MISSING_CLOSING_BALANCE"
                ? "Kaynakta bulunamadı"
                : ""
            }
            className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
          />
          <span className="mt-2 block text-xs text-slate-500">
            {evidenceLabel(result.closingEvidence)}
          </span>
        </label>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {[
          ["Toplam borç / çıkış", live.debits],
          ["Toplam alacak / giriş", live.credits],
          ["Hesaplanan kapanış", live.expected],
          ["Ekstre kapanışı", finiteOrNull(draft.closingBalance)],
          ["Mutabakat farkı", live.delta],
          ["Değişiklik", permission.changeCount],
        ].map(([label, value]) => (
          <div
            key={label}
            className="rounded-xl border border-slate-800 bg-slate-900/40 px-3 py-2"
          >
            <p className="text-[11px] uppercase tracking-wide text-slate-500">
              {label}
            </p>
            <p className="mt-1 font-semibold text-white">
              {label === "Değişiklik" ? value : formatAmount(value)}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-4 space-y-2">
        {(draft.rows || []).map((row) => (
          <div
            key={row.key}
            className="rounded-xl border border-slate-800 bg-slate-900/45 p-3"
            data-testid="bank-balance-resolution-row"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="inline-flex items-center gap-2 text-sm text-slate-100">
                <input
                  type="checkbox"
                  checked={Boolean(row.included)}
                  onChange={(event) =>
                    updateDraft((current) => ({
                      ...current,
                      rows: current.rows.map((item) =>
                        item.key === row.key
                          ? { ...item, included: event.target.checked }
                          : item
                      ),
                    }))
                  }
                />
                Hareketi dahil et
              </label>
              <select
                value={row.direction}
                disabled={!row.included}
                onChange={(event) =>
                  updateDraft((current) => ({
                    ...current,
                    rows: current.rows.map((item) =>
                      item.key === row.key
                        ? { ...item, direction: event.target.value }
                        : item
                    ),
                  }))
                }
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white disabled:opacity-50"
              >
                <option value="credit">Alacak / giriş</option>
                <option value="debit">Borç / çıkış</option>
              </select>
            </div>
            <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs">
              <span className="text-slate-300">
                {row.date} · {row.description}
              </span>
              <span className="font-mono text-white">
                {formatAmount(row.amount)}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              Sayfa {row.sourcePage ?? "—"} · Satır {row.sourceLine ?? "—"} ·
              Güven %{Math.round((finiteOrNull(row.confidence) ?? 0) * 100)}
            </p>
          </div>
        ))}
      </div>

      <label className="mt-4 flex items-start gap-2 rounded-xl border border-slate-800 bg-slate-900/40 p-3 text-sm text-slate-200">
        <input
          type="checkbox"
          checked={Boolean(draft.learnForCompany)}
          disabled={!learnEligible}
          onChange={(event) =>
            updateDraft((current) => ({
              ...current,
              learnForCompany: event.target.checked,
            }))
          }
        />
        <span>
          Bu firma için öğren
          <span className="mt-1 block text-xs text-slate-500">
            {learnEligible
              ? "Yalnız güvenli ve genellenebilir yön kuralı kaydedilir."
              : "Bu düzeltmeler ekstreye özeldir; güvenli genellenebilir kural olmadığı için hafızaya yazılmaz."}
          </span>
        </span>
      </label>

      <label className="mt-3 flex items-start gap-2 rounded-xl border border-amber-700/40 bg-amber-950/20 p-3 text-sm text-amber-100">
        <input
          type="checkbox"
          checked={Boolean(draft.userConfirmed)}
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              userConfirmed: event.target.checked,
            }))
          }
        />
        Seçtiğim bakiye ve hareket düzeltmelerini açıkça onaylıyorum.
      </label>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!history.length || isApplying}
          onClick={() => {
            const previous = history[history.length - 1];
            if (!previous) return;
            setDraft({ ...previous, userConfirmed: false });
            setHistory((items) => items.slice(0, -1));
          }}
          className="rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="bank-balance-resolution-undo"
        >
          Geri Al
        </button>
        <button
          type="button"
          disabled={!permission.allowed || isApplying}
          onClick={() => onApply?.(draft)}
          className="rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="bank-balance-resolution-apply"
        >
          {isApplying ? "Yeniden analiz ediliyor…" : "Uygula ve Yeniden Analiz Et"}
        </button>
      </div>
    </section>
  );
}
