"use client";

import { useCallback, useMemo, useState } from "react";
import AnnveroDateInput from "@/src/components/AnnveroDateInput";
import { accountCodeFromPlanRow } from "@/src/utils/genelMuhasebeKontrolEngine";
import { formatTurkishMoney } from "@/src/utils/turkishNumberFormat";
import {
  CORRECTION_DATE_SOURCE,
  CORRECTION_EXPORT_MODE,
  buildCorrectionDraft,
  buildSourceVoucherFromLedgerRows,
  detectCorrectionRecipe,
  exportCorrectionDraft,
  prepareCorrectionFromFinding,
  validateCorrectionDraft,
} from "@/src/utils/correctionVoucher";

function accountLabel(account) {
  const code = accountCodeFromPlanRow(account);
  const name =
    account?.account_name ||
    account?.accountName ||
    account?.hesapAdi ||
    account?.name ||
    "";
  return name ? `${code} — ${name}` : code;
}

export default function CorrectionVoucherPanel({
  open,
  onClose,
  finding,
  ledgerRows = [],
  planAccounts = [],
  companyId = "",
  companySlug = "",
  companyAccountingRules = {},
  accountPlanCodes = null,
}) {
  const [closedPeriodInput, setClosedPeriodInput] = useState("");
  const [correctionDateOverride, setCorrectionDateOverride] = useState("");
  const [correctionDateSource, setCorrectionDateSource] = useState("");
  const [accountQuery, setAccountQuery] = useState("");
  const [selectedAccountCode, setSelectedAccountCode] = useState("");
  const [approved, setApproved] = useState(false);
  const [exportMessage, setExportMessage] = useState("");
  const [exportError, setExportError] = useState("");

  const prep = useMemo(() => {
    if (!open || !finding) return null;
    return prepareCorrectionFromFinding({
      finding,
      ledgerRows,
      companyAccountingRules,
      userSelectedClosedPeriod: closedPeriodInput,
    });
  }, [open, finding, ledgerRows, companyAccountingRules, closedPeriodInput]);

  const recipe = prep?.recipe;
  const sourceVoucher = prep?.sourceVoucher;
  const requiresClosedPeriod = prep?.dateContext?.requiresClosedPeriodInput;
  const defaultCorrectionDate = prep?.dateContext?.correctionDate || "";
  const defaultDateSource = prep?.dateContext?.correctionDateSource || "";

  const effectiveCorrectionDate = correctionDateOverride || defaultCorrectionDate;
  const effectiveDateSource = correctionDateSource || defaultDateSource;

  const selectedAccount = useMemo(
    () =>
      planAccounts.find(
        (account) => accountCodeFromPlanRow(account) === selectedAccountCode
      ) || null,
    [planAccounts, selectedAccountCode]
  );

  const filteredAccounts = useMemo(() => {
    const q = accountQuery.trim().toLocaleLowerCase("tr-TR");
    const list = planAccounts || [];
    if (!q) return list.slice(0, 40);
    return list
      .filter((account) => {
        const code = accountCodeFromPlanRow(account).toLocaleLowerCase("tr-TR");
        const name = String(
          account?.account_name || account?.accountName || account?.name || ""
        ).toLocaleLowerCase("tr-TR");
        return code.includes(q) || name.includes(q);
      })
      .slice(0, 40);
  }, [planAccounts, accountQuery]);

  const draft = useMemo(() => {
    if (!recipe?.ok || !selectedAccountCode || !selectedAccount) return null;
    return buildCorrectionDraft(recipe, {
      correctDebitAccountCode: selectedAccountCode,
      correctDebitAccountName:
        selectedAccount?.account_name ||
        selectedAccount?.accountName ||
        selectedAccount?.name ||
        "",
      companyAccountingRules,
      userSelectedClosedPeriod: closedPeriodInput,
      userCorrectionDate: effectiveCorrectionDate,
      correctionDateSource: effectiveDateSource,
      accountPlanCodes,
      companyId,
      companySlug,
    });
  }, [
    recipe,
    selectedAccountCode,
    selectedAccount,
    companyAccountingRules,
    closedPeriodInput,
    effectiveCorrectionDate,
    effectiveDateSource,
    accountPlanCodes,
    companyId,
    companySlug,
  ]);

  const draftValidation = useMemo(() => {
    if (!draft?.ok) return draft;
    return validateCorrectionDraft(draft, {
      accountPlanCodes,
      lastClosedReliability: prep?.closedReliability,
    });
  }, [draft, accountPlanCodes, prep?.closedReliability]);

  const handleDateChange = useCallback((iso) => {
    setCorrectionDateOverride(iso);
    setCorrectionDateSource(CORRECTION_DATE_SOURCE.USER_SELECTED);
    setApproved(false);
    setExportMessage("");
  }, []);

  const handleExport = useCallback(() => {
    setExportError("");
    setExportMessage("");
    if (!draft?.ok) {
      setExportError(draft?.message || "Taslak oluşturulamadı.");
      return;
    }
    if (!approved) {
      setExportError("Export için onay kutusunu işaretleyin.");
      return;
    }

    const result = exportCorrectionDraft(draft, {
      userApproved: true,
      exportMode: CORRECTION_EXPORT_MODE.LUCA_STANDARD,
      accountPlanCodes,
      lastClosedReliability: prep?.closedReliability,
      companySlug,
    });

    if (!result.ok) {
      setExportError(result.message || "Export başarısız.");
      return;
    }
    setExportMessage(`İndirildi: ${result.fileName}`);
  }, [draft, approved, accountPlanCodes, prep?.closedReliability, companySlug]);

  if (!open || !finding) return null;

  const sourceMetaIssues = sourceVoucher?.metaIssues || [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="correction-voucher-title"
    >
      <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 id="correction-voucher-title" className="text-lg font-semibold text-slate-900">
              Düzeltme fişi hazırla
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Kaynak fiş değiştirilmez · persist=0 · yalnız onay sonrası indirme
            </p>
          </div>
          <button
            type="button"
            className="rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-100"
            onClick={onClose}
          >
            Kapat
          </button>
        </div>

        <div className="space-y-4 px-5 py-4 text-sm">
          {!recipe?.ok ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
              {recipe?.message || "Bu bulgu için otomatik düzeltme fişi üretilemiyor."}
            </div>
          ) : null}

          {recipe?.ok ? (
            <>
              {sourceMetaIssues.length ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-800">
                  {sourceMetaIssues.map((issue) => issue.message).join(" ")}
                </div>
              ) : null}

              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                <div className="font-medium text-slate-900">Kaynak fiş</div>
                <dl className="mt-2 grid gap-1 sm:grid-cols-2">
                  <div>
                    <dt className="text-slate-500">Fiş</dt>
                    <dd>{sourceVoucher?.fisNo || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Tarih</dt>
                    <dd>{sourceVoucher?.tarih || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Belge</dt>
                    <dd>{sourceVoucher?.belgeNo || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Hatalı hesap / tutar</dt>
                    <dd>
                      {recipe.wrongAccountCode} · {formatTurkishMoney(recipe.wrongDebitAmount)} TL
                    </dd>
                  </div>
                </dl>
              </div>

              {requiresClosedPeriod ? (
                <label className="block">
                  <span className="mb-1 block font-medium text-slate-800">
                    Son kapalı e-Defter dönemi (YYYY/AA)
                  </span>
                  <input
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                    value={closedPeriodInput}
                    onChange={(e) => {
                      setClosedPeriodInput(e.target.value);
                      setCorrectionDateOverride("");
                      setCorrectionDateSource("");
                      setApproved(false);
                    }}
                    placeholder="2026/03"
                  />
                  <span className="mt-1 block text-xs text-slate-500">
                    Kapalı dönem güvenilir şekilde bulunamadı; otomatik tarih üretilmez.
                  </span>
                </label>
              ) : (
                <p className="text-slate-600">
                  Son kapalı e-Defter dönemi:{" "}
                  <span className="font-medium">{prep?.dateContext?.lastClosedLedgerPeriod}</span>
                </p>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block font-medium text-slate-800">Düzeltme tarihi</span>
                  <AnnveroDateInput
                    value={effectiveCorrectionDate}
                    onChange={handleDateChange}
                    aria-label="Düzeltme tarihi"
                  />
                  {effectiveDateSource === CORRECTION_DATE_SOURCE.AUTO_DEFAULT ? (
                    <span className="mt-1 block text-xs text-slate-500">
                      Varsayılan: kapalı dönem sonrası ilk gün ({defaultCorrectionDate})
                    </span>
                  ) : null}
                </label>
                <div>
                  <span className="mb-1 block font-medium text-slate-800">Düzeltme dönemi</span>
                  <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                    {draft?.correctionPeriod ||
                      (effectiveCorrectionDate
                        ? effectiveCorrectionDate.slice(0, 7).replace("-", "/")
                        : "—")}
                  </div>
                </div>
              </div>

              <label className="block">
                <span className="mb-1 block font-medium text-slate-800">
                  Doğru borç hesabı (aktif plan)
                </span>
                <input
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  value={accountQuery}
                  onChange={(e) => setAccountQuery(e.target.value)}
                  placeholder="Kod veya ad ara…"
                />
                <div className="mt-2 max-h-36 overflow-auto rounded-lg border border-slate-200">
                  {filteredAccounts.length === 0 ? (
                    <p className="px-3 py-2 text-slate-500">Sonuç yok</p>
                  ) : (
                    filteredAccounts.map((account) => {
                      const code = accountCodeFromPlanRow(account);
                      const active = selectedAccountCode === code;
                      return (
                        <button
                          key={code}
                          type="button"
                          className={`block w-full px-3 py-2 text-left hover:bg-teal-50 ${
                            active ? "bg-teal-100 font-medium" : ""
                          }`}
                          onClick={() => {
                            setSelectedAccountCode(code);
                            setApproved(false);
                            setExportMessage("");
                          }}
                        >
                          {accountLabel(account)}
                        </button>
                      );
                    })
                  )}
                </div>
              </label>

              {draft?.ok ? (
                <>
                  <div>
                    <div className="font-medium text-slate-900">Fiş açıklaması</div>
                    <p className="mt-1 text-slate-700">{draft.description}</p>
                  </div>

                  <div className="overflow-auto rounded-lg border border-slate-200">
                    <table className="min-w-full text-left text-xs">
                      <thead className="bg-slate-50 text-slate-600">
                        <tr>
                          <th className="px-2 py-1">Hesap</th>
                          <th className="px-2 py-1">Borç</th>
                          <th className="px-2 py-1">Alacak</th>
                        </tr>
                      </thead>
                      <tbody>
                        {draft.lines.map((line, index) => (
                          <tr
                            key={`${line.hesapKodu}-${index}-${selectedAccountCode}`}
                            className="border-t border-slate-100"
                          >
                            <td className="px-2 py-1">
                              {line.hesapKodu}
                              {line.hesapAdi ? ` — ${line.hesapAdi}` : ""}
                            </td>
                            <td className="px-2 py-1">
                              {line.borc ? formatTurkishMoney(line.borc) : "—"}
                            </td>
                            <td className="px-2 py-1">
                              {line.alacak ? formatTurkishMoney(line.alacak) : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="border-t border-slate-100 px-2 py-2 text-slate-500">
                      KDV / mevcut doğru satırlar taslağa eklenmez · {draft.lines.length} satır
                    </p>
                  </div>
                </>
              ) : draft && !draft.ok ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-800">
                  {draft.message}
                </div>
              ) : null}

              {draftValidation && !draftValidation.ok && draft?.ok ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-800">
                  {draftValidation.issues?.[0]?.message || "Taslak doğrulanamadı."}
                </div>
              ) : null}

              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={approved}
                  disabled={!draft?.ok || !draftValidation?.ok}
                  onChange={(e) => {
                    setApproved(e.target.checked);
                    setExportMessage("");
                    setExportError("");
                  }}
                />
                <span>
                  Dengeli düzeltme fişi taslağını inceledim; indirmeyi onaylıyorum (kaynak fişe
                  yazılmaz).
                </span>
              </label>

              {exportError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-800">
                  {exportError}
                </div>
              ) : null}
              {exportMessage ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-900">
                  {exportMessage}
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
          <button
            type="button"
            className="rounded-xl border border-slate-300 px-4 py-2 text-sm"
            onClick={onClose}
          >
            Vazgeç
          </button>
          <button
            type="button"
            disabled={!draft?.ok || !draftValidation?.ok || !approved}
            className="rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
            onClick={handleExport}
          >
            Luca aktarım dosyasını indir
          </button>
        </div>
      </div>
    </div>
  );
}

/** Bulgu satırı düzeltmeye uygun mu? */
export function isCorrectionEligibleFinding(finding, ledgerRows) {
  if (!finding || finding.severity !== "UYARI") return false;
  const sourceVoucher = buildSourceVoucherFromLedgerRows(ledgerRows, finding.fisNo);
  if (!sourceVoucher) return false;
  return detectCorrectionRecipe(finding, sourceVoucher).ok;
}
