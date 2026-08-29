"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AnnveroDateInput from "@/src/components/AnnveroDateInput";
import { accountCodeFromPlanRow } from "@/src/utils/genelMuhasebeKontrolEngine";
import { formatTurkishMoney } from "@/src/utils/turkishNumberFormat";
import {
  CORRECTION_DATE_SOURCE,
  CORRECTION_EXPORT_MODE,
  buildCorrectionDraft,
  exportCorrectionDraft,
  prepareCorrectionFromFinding,
  validateCorrectionDraft,
} from "@/src/utils/correctionVoucher";
import {
  CORRECTION_RECORD_STATUS,
  assertExportApiReadyForDownload,
  buildDraftFingerprintContext,
  buildExportedPendingStatusLabel,
} from "@/src/utils/correctionRecords";

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

function accountNameFromPlan(planAccounts = [], code = "") {
  const account = planAccounts.find(
    (entry) => accountCodeFromPlanRow(entry) === code
  );
  if (!account) return "";
  return (
    account?.account_name ||
    account?.accountName ||
    account?.hesapAdi ||
    account?.name ||
    ""
  );
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
  existingRecord = null,
  onExportRecorded,
}) {
  const [closedPeriodInput, setClosedPeriodInput] = useState("");
  const [correctionDateOverride, setCorrectionDateOverride] = useState("");
  const [correctionDateSource, setCorrectionDateSource] = useState("");
  const [accountQuery, setAccountQuery] = useState("");
  const [selectedAccountCode, setSelectedAccountCode] = useState("");
  const [selectedAccountName, setSelectedAccountName] = useState("");
  const [approved, setApproved] = useState(false);
  const [exportMessage, setExportMessage] = useState("");
  const [exportError, setExportError] = useState("");
  const [exportBusy, setExportBusy] = useState(false);
  const [activeRecord, setActiveRecord] = useState(existingRecord);

  useEffect(() => {
    setActiveRecord(existingRecord);
  }, [existingRecord]);

  useEffect(() => {
    if (!open) return;
    setClosedPeriodInput("");
    setCorrectionDateOverride("");
    setCorrectionDateSource("");
    setAccountQuery("");
    setApproved(false);
    setExportMessage("");
    setExportError("");
    setExportBusy(false);
    if (existingRecord?.correctionAccountCode) {
      setSelectedAccountCode(existingRecord.correctionAccountCode);
      setSelectedAccountName(existingRecord.correctionAccountName || "");
    } else {
      setSelectedAccountCode("");
      setSelectedAccountName("");
    }
  }, [open, finding?.fisNo, finding?.code, existingRecord?.id]);

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
  const sourceMetaBlocked = Boolean(sourceVoucher && !sourceVoucher.metaComplete);
  const isApplied = activeRecord?.status === CORRECTION_RECORD_STATUS.APPLIED;
  const isExportedPending = activeRecord?.status === CORRECTION_RECORD_STATUS.EXPORTED;

  const selectAccount = useCallback(
    (code, name = "") => {
      const trimmedCode = String(code || "").trim();
      if (!trimmedCode) return;
      setSelectedAccountCode(trimmedCode);
      setSelectedAccountName(name || accountNameFromPlan(planAccounts, trimmedCode));
      setApproved(false);
      setExportMessage("");
      setExportError("");
    },
    [planAccounts]
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
    if (!recipe?.ok || !selectedAccountCode || sourceMetaBlocked) return null;
    return buildCorrectionDraft(recipe, {
      correctDebitAccountCode: selectedAccountCode,
      correctDebitAccountName:
        selectedAccountName || accountNameFromPlan(planAccounts, selectedAccountCode),
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
    selectedAccountName,
    sourceMetaBlocked,
    planAccounts,
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

  const downloadWorkbook = useCallback(
    (targetDraft) => {
      const result = exportCorrectionDraft(targetDraft, {
        userApproved: true,
        exportMode: CORRECTION_EXPORT_MODE.LUCA_STANDARD,
        accountPlanCodes,
        lastClosedReliability: prep?.closedReliability,
        companySlug,
      });
      if (!result.ok) {
        setExportError(result.message || "Export başarısız.");
        return false;
      }
      setExportMessage(`İndirildi: ${result.fileName}`);
      return true;
    },
    [accountPlanCodes, prep?.closedReliability, companySlug]
  );

  const callExportApi = useCallback(async () => {
    const response = await fetch("/api/accounting-correction-records/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId,
        draft,
        recipe,
        userApproved: true,
        companySlug,
        lastClosedReliability: prep?.closedReliability,
      }),
    });
    let payload = {};
    try {
      payload = await response.json();
    } catch {
      payload = {};
    }
    return assertExportApiReadyForDownload(response.ok, payload);
  }, [companyId, draft, recipe, companySlug, prep?.closedReliability]);

  const handleExport = useCallback(async () => {
    setExportError("");
    setExportMessage("");
    if (isApplied) {
      setExportError("Bu bulgu zaten düzeltilmiş.");
      return;
    }
    if (!draft?.ok || !approved) {
      setExportError(!approved ? "Export için onay kutusunu işaretleyin." : "Taslak geçersiz.");
      return;
    }

    setExportBusy(true);
    try {
      const gate = await callExportApi();
      if (!gate.ok || !gate.allowDownload || !gate.record?.id) {
        setExportError(gate.error || "Düzeltme export kaydı oluşturulamadı.");
        return;
      }
      if (!downloadWorkbook(draft)) return;
      setActiveRecord(gate.record);
      onExportRecorded?.(gate.record);
      if (!gate.created) {
        setExportMessage(`${buildExportedPendingStatusLabel()} · mevcut kayıt`);
      }
    } catch {
      setExportError("Bağlantı hatası. Kayıtsız export yapılmadı.");
    } finally {
      setExportBusy(false);
    }
  }, [draft, approved, isApplied, callExportApi, downloadWorkbook, onExportRecorded]);

  const handleRedownload = useCallback(async () => {
    if (!draft?.ok) return;
    setExportBusy(true);
    setExportError("");
    try {
      const gate = await callExportApi();
      if (!gate.ok || !gate.allowDownload || !gate.record?.id) {
        setExportError(gate.error || "Düzeltme export kaydı oluşturulamadı.");
        return;
      }
      downloadWorkbook(draft);
      setActiveRecord(gate.record);
      onExportRecorded?.(gate.record);
    } catch {
      setExportError("Bağlantı hatası. Kayıtsız export yapılmadı.");
    } finally {
      setExportBusy(false);
    }
  }, [draft, callExportApi, downloadWorkbook, onExportRecorded]);

  const fingerprintPreview = useMemo(() => {
    if (!draft?.ok || !recipe?.ok) return "";
    return buildDraftFingerprintContext(draft, recipe).sourceFingerprint;
  }, [draft, recipe]);

  if (!open || !finding) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold">Düzeltme fişi hazırla</h2>
            <p className="mt-1 text-sm text-slate-600">Export önce kaydedilir · Luca takibi</p>
          </div>
          <button type="button" className="text-sm text-slate-500" onClick={onClose}>
            Kapat
          </button>
        </div>

        <div className="space-y-4 px-5 py-4 text-sm">
          {isApplied ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-900">
              Bu düzeltme uygulanmış; yeni export önerilmez.
            </div>
          ) : null}

          {isExportedPending && !isApplied ? (
            <div className="rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-teal-900">
              {buildExportedPendingStatusLabel()}
              <button
                type="button"
                className="ml-2 underline"
                onClick={handleRedownload}
                disabled={exportBusy}
              >
                Dosyayı yeniden indir
              </button>
            </div>
          ) : null}

          {!recipe?.ok ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              {recipe?.message || "Otomatik düzeltme üretilemiyor."}
            </div>
          ) : (
            <>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                <div className="font-medium">Kaynak fiş</div>
                <p className="mt-1">
                  {sourceVoucher?.fisNo} · {sourceVoucher?.tarih || finding?.tarih} ·{" "}
                  {sourceVoucher?.belgeNo}
                </p>
                <p>
                  {recipe.wrongAccountCode} · {formatTurkishMoney(recipe.wrongDebitAmount)} TL
                </p>
              </div>

              {requiresClosedPeriod ? (
                <input
                  className="w-full rounded-lg border px-3 py-2"
                  value={closedPeriodInput}
                  onChange={(e) => setClosedPeriodInput(e.target.value)}
                  placeholder="Son kapalı dönem YYYY/AA"
                />
              ) : null}

              {!isApplied ? (
                <>
                  <AnnveroDateInput
                    value={effectiveCorrectionDate}
                    onChange={(iso) => {
                      setCorrectionDateOverride(iso);
                      setCorrectionDateSource(CORRECTION_DATE_SOURCE.USER_SELECTED);
                    }}
                    aria-label="Düzeltme tarihi"
                  />
                  <input
                    className="w-full rounded-lg border px-3 py-2"
                    value={accountQuery}
                    onChange={(e) => setAccountQuery(e.target.value)}
                    placeholder="Doğru borç hesabı ara"
                  />
                  <div className="max-h-32 overflow-auto rounded border">
                    {filteredAccounts.map((account) => {
                      const code = accountCodeFromPlanRow(account);
                      return (
                        <button
                          key={code}
                          type="button"
                          className="block w-full px-3 py-2 text-left hover:bg-teal-50"
                          onClick={() =>
                            selectAccount(
                              code,
                              account?.account_name || account?.accountName || ""
                            )
                          }
                        >
                          {accountLabel(account)}
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : null}

              {draft?.ok && draftValidation?.ok ? (
                <label className="flex gap-2">
                  <input
                    type="checkbox"
                    checked={approved}
                    disabled={isApplied}
                    onChange={(e) => setApproved(e.target.checked)}
                  />
                  <span>Taslağı inceledim; indirmeyi onaylıyorum.</span>
                </label>
              ) : null}

              {fingerprintPreview ? (
                <p className="text-xs text-slate-400">Takip: {fingerprintPreview.slice(0, 12)}…</p>
              ) : null}
              {exportError ? (
                <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-red-800">
                  {exportError}
                </div>
              ) : null}
              {exportMessage ? (
                <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2">
                  {exportMessage}
                </div>
              ) : null}
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t px-5 py-4">
          <button type="button" className="rounded-xl border px-4 py-2 text-sm" onClick={onClose}>
            Vazgeç
          </button>
          {!isApplied ? (
            <button
              type="button"
              disabled={!draft?.ok || !draftValidation?.ok || !approved || exportBusy}
              className="rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-300"
              onClick={handleExport}
            >
              {exportBusy ? "Kaydediliyor…" : "Luca aktarım dosyasını indir"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
