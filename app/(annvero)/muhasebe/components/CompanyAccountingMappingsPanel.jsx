"use client";

import { useEffect, useMemo, useState } from "react";
import AccountPlanCodeSelect from "./AccountPlanCodeSelect";
import { MAPPING_STATUS, buildDetectSignalsFromCompany } from "@/src/utils/companyAccountAutoDetect";
import {
  approveCompanyAccountMapping,
  chooseAlternateAccount,
  loadCompanyAccountMappings,
  runCompanyAccountAutoDetect,
  setCompanyAccountMappingPassive,
} from "@/src/utils/companyAccountMappingMemory";

const STATUS_LABEL = {
  [MAPPING_STATUS.AUTO_APPLIED]: "Otomatik bulundu",
  [MAPPING_STATUS.NEEDS_APPROVAL]: "Onay bekliyor",
  [MAPPING_STATUS.MISSING]: "Eksik",
  [MAPPING_STATUS.CONFLICT]: "Çakışma",
  [MAPPING_STATUS.APPROVED]: "Kullanıcı onayladı",
  [MAPPING_STATUS.PASSIVE]: "Pasif",
};

const STATUS_CLASS = {
  [MAPPING_STATUS.AUTO_APPLIED]: "bg-emerald-900/40 text-emerald-300",
  [MAPPING_STATUS.NEEDS_APPROVAL]: "bg-amber-900/40 text-amber-200",
  [MAPPING_STATUS.MISSING]: "bg-slate-800 text-slate-300",
  [MAPPING_STATUS.CONFLICT]: "bg-rose-900/40 text-rose-200",
  [MAPPING_STATUS.APPROVED]: "bg-indigo-900/40 text-indigo-200",
  [MAPPING_STATUS.PASSIVE]: "bg-slate-900 text-slate-500",
};

/** MARE / demo: firma kaydında eksik kalan banka-POS-kart sinyalleri */
const MARE_FALLBACK_SIGNALS = {
  bankName: "VAKIFBANK",
  iban: "TR820001500158007308428449",
  accountNumber: "00158007308428449",
  posMerchantNo: "57700001130449",
  posNo: "01670904",
  cardLast4List: ["4682", "6725"],
};

function resolveScanSignals(company) {
  const derived = buildDetectSignalsFromCompany(company);
  const isMare =
    /mare/i.test(String(company?.name || company?.title || company?.companyName || ""));
  if (!isMare) return derived;
  return {
    bankName: derived.bankName || MARE_FALLBACK_SIGNALS.bankName,
    iban: derived.iban || MARE_FALLBACK_SIGNALS.iban,
    accountNumber: derived.accountNumber || MARE_FALLBACK_SIGNALS.accountNumber,
    posMerchantNo: derived.posMerchantNo || MARE_FALLBACK_SIGNALS.posMerchantNo,
    posNo: derived.posNo || MARE_FALLBACK_SIGNALS.posNo,
    cardLast4List:
      derived.cardLast4List?.length > 0
        ? [...new Set([...derived.cardLast4List, ...MARE_FALLBACK_SIGNALS.cardLast4List])]
        : MARE_FALLBACK_SIGNALS.cardLast4List,
  };
}

function SummaryCard({ label, value, tone = "slate" }) {
  const tones = {
    slate: "border-slate-700 bg-slate-950",
    green: "border-emerald-800 bg-emerald-950/30",
    amber: "border-amber-800 bg-amber-950/30",
    rose: "border-rose-800 bg-rose-950/30",
    indigo: "border-indigo-800 bg-indigo-950/30",
  };
  return (
    <div className={`rounded-xl border px-4 py-3 ${tones[tone] || tones.slate}`}>
      <div className="text-xs text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-100">{value}</div>
    </div>
  );
}

/**
 * Kontrol ekranı: otomatik tespit sonuçları + belirsiz onay.
 * Manuel boş form ana görünüm değildir.
 */
export default function CompanyAccountingMappingsPanel({
  company,
  setCompany,
  accountPlan = [],
}) {
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("all");
  const [manualForId, setManualForId] = useState(null);
  const [message, setMessage] = useState("");

  const mappings = useMemo(
    () => company.accountMappingResults || [],
    [company.accountMappingResults]
  );
  const summary = company.accountMappingSummary || {
    autoApplied: 0,
    needsApproval: 0,
    missing: 0,
    conflict: 0,
    approved: 0,
    scannedAt: "",
  };

  const syncFromDetect = (detectResult) => {
    if (!detectResult?.companyPatch) return;
    setCompany({
      ...company,
      ...detectResult.companyPatch,
    });
  };

  const runScan = () => {
    if (!company?.id) {
      setMessage("Önce firmayı kaydedin / seçin.");
      return;
    }
    if (!accountPlan?.length) {
      setMessage("Bu firma için hesap planı yok. Önce Hesap Planı yükleyin.");
      return;
    }
    setBusy(true);
    try {
      const result = runCompanyAccountAutoDetect({
        companyId: company.id,
        company,
        accountPlan,
        signals: resolveScanSignals(company),
      });
      syncFromDetect(result);
      setMessage(
        `Tarama tamam: otomatik ${result.summary.autoApplied}, onay ${result.summary.needsApproval}, eksik ${result.summary.missing}`
      );
    } catch (error) {
      console.error(error);
      setMessage("Tarama başarısız.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!company?.id) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      const stored = loadCompanyAccountMappings(company.id);
      if (stored.mappings?.length && !(company.accountMappingResults || []).length) {
        setCompany({
          ...company,
          accountMappingResults: stored.mappings,
          accountMappingSummary: stored.summary,
        });
        return;
      }
      if (accountPlan?.length && !(company.accountMappingResults || []).length) {
        runScan();
      }
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company?.id, accountPlan?.length]);

  const filtered = useMemo(() => {
    if (filter === "all") return mappings;
    if (filter === "auto") {
      return mappings.filter(
        (m) =>
          m.status === MAPPING_STATUS.AUTO_APPLIED ||
          m.status === MAPPING_STATUS.APPROVED
      );
    }
    if (filter === "pending") {
      return mappings.filter(
        (m) =>
          m.status === MAPPING_STATUS.NEEDS_APPROVAL ||
          m.status === MAPPING_STATUS.CONFLICT
      );
    }
    if (filter === "missing") {
      return mappings.filter((m) => m.status === MAPPING_STATUS.MISSING);
    }
    return mappings;
  }, [mappings, filter]);

  const refreshFromStorage = () => {
    const stored = loadCompanyAccountMappings(company.id);
    const rerun = runCompanyAccountAutoDetect({
      companyId: company.id,
      company: {
        ...company,
        accountMappingResults: stored.mappings,
      },
      accountPlan,
      signals: resolveScanSignals(company),
    });
    syncFromDetect(rerun);
  };

  const onApprove = (mapping) => {
    approveCompanyAccountMapping(company.id, mapping.id);
    refreshFromStorage();
    setMessage(`Onaylandı: ${mapping.label}`);
  };

  const onPassive = (mapping) => {
    setCompanyAccountMappingPassive(company.id, mapping.id);
    refreshFromStorage();
    setMessage(`Pasif: ${mapping.label}`);
  };

  const onChoose = (mapping, code, name) => {
    chooseAlternateAccount(company.id, mapping.id, code, name);
    setManualForId(null);
    refreshFromStorage();
    setMessage(`Seçildi: ${mapping.label} → ${code}`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-100">
            Otomatik hesap eşleme kontrolü
          </h2>
          <p className="text-xs text-slate-400">
            Hesap planı taranır; yüksek güven otomatik kaydedilir. Belirsizler
            onay ister. Manuel form yalnız çakışma/eksik durumda.
          </p>
        </div>
        <button
          type="button"
          disabled={busy || !company?.id}
          onClick={runScan}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium hover:bg-indigo-500 disabled:opacity-50"
        >
          {busy ? "Taranıyor…" : "Yeniden tara"}
        </button>
      </div>

      {message ? (
        <div className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-300">
          {message}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <SummaryCard
          label="Otomatik"
          value={summary.autoApplied || 0}
          tone="green"
        />
        <SummaryCard
          label="Onay bekleyen"
          value={(summary.needsApproval || 0) + (summary.conflict || 0)}
          tone="amber"
        />
        <SummaryCard label="Eksik" value={summary.missing || 0} tone="rose" />
        <SummaryCard
          label="Onaylı"
          value={summary.approved || 0}
          tone="indigo"
        />
        <SummaryCard
          label="Son tarama"
          value={
            summary.scannedAt
              ? new Date(summary.scannedAt).toLocaleString("tr-TR")
              : "—"
          }
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {[
          ["all", "Tümü"],
          ["auto", "Otomatik/Onaylı"],
          ["pending", "Onay bekleyen"],
          ["missing", "Eksik"],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setFilter(id)}
            className={`rounded-full px-3 py-1 text-xs ${
              filter === id
                ? "bg-indigo-600 text-white"
                : "bg-slate-800 text-slate-300"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {!accountPlan?.length ? (
        <div className="rounded-xl border border-amber-800 bg-amber-950/20 px-4 py-6 text-sm text-amber-100">
          Bu firma için hesap planı bulunamadı. Önce{" "}
          <span className="font-semibold">Hesap Planı</span> ekranından plan
          yükleyin; ardından burada otomatik eşleme çalışır.
        </div>
      ) : null}

      <div className="space-y-3">
        {filtered.length === 0 ? (
          <div className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-8 text-center text-sm text-slate-500">
            Gösterilecek eşleme yok. Yeniden tara ile başlatın.
          </div>
        ) : (
          filtered.map((m) => (
            <div
              key={m.id}
              className="rounded-xl border border-slate-700 bg-slate-900/50 p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-100">
                    {m.label}{" "}
                    <span className="font-normal text-slate-400">
                      · {m.scenarioType}
                    </span>
                  </div>
                  <div className="mt-1 font-mono text-sm text-indigo-300">
                    {m.recommendedAccountCode || "—"}{" "}
                    <span className="font-sans text-slate-400">
                      {m.recommendedAccountName}
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs ${
                      STATUS_CLASS[m.status] || STATUS_CLASS.MISSING
                    }`}
                  >
                    {STATUS_LABEL[m.status] || m.status}
                  </span>
                  <span className="rounded-full bg-slate-800 px-2.5 py-1 text-xs text-slate-200">
                    Güven {Number(m.confidence || 0)}
                  </span>
                </div>
              </div>

              <div className="mt-3 grid gap-2 text-xs text-slate-400 md:grid-cols-2">
                <div>
                  <span className="text-slate-500">Neden: </span>
                  {m.reason || "—"}
                </div>
                <div>
                  <span className="text-slate-500">Sinyal: </span>
                  {(m.usedSignals || []).join(", ") || "—"}
                </div>
              </div>

              {m.candidates?.length > 1 ? (
                <div className="mt-3 text-xs text-slate-400">
                  Adaylar:{" "}
                  {m.candidates
                    .map((c) => `${c.accountCode} (${c.confidence})`)
                    .join(" · ")}
                </div>
              ) : null}

              <div className="mt-4 flex flex-wrap gap-2">
                {(m.status === MAPPING_STATUS.NEEDS_APPROVAL ||
                  m.status === MAPPING_STATUS.CONFLICT) &&
                m.recommendedAccountCode ? (
                  <button
                    type="button"
                    onClick={() => onApprove(m)}
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs hover:bg-emerald-500"
                  >
                    Onayla
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() =>
                    setManualForId(manualForId === m.id ? null : m.id)
                  }
                  className="rounded-lg bg-slate-700 px-3 py-1.5 text-xs hover:bg-slate-600"
                >
                  Farklı hesap seç
                </button>
                {(m.status === MAPPING_STATUS.NEEDS_APPROVAL ||
                  m.status === MAPPING_STATUS.CONFLICT ||
                  m.status === MAPPING_STATUS.MISSING) && (
                  <button
                    type="button"
                    onClick={() => onApprove(m)}
                    className="rounded-lg bg-indigo-700 px-3 py-1.5 text-xs hover:bg-indigo-600"
                    disabled={!m.recommendedAccountCode}
                  >
                    Bu firma için öğren
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onPassive(m)}
                  className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-300"
                >
                  Pasif yap
                </button>
              </div>

              {manualForId === m.id ? (
                <div className="mt-3 rounded-lg border border-slate-700 bg-slate-950 p-3">
                  <AccountPlanCodeSelect
                    label="Alternatif hesap"
                    value={m.recommendedAccountCode || ""}
                    accountPlan={accountPlan}
                    onChange={(code) => {
                      const hit = (accountPlan || []).find(
                        (a) =>
                          String(a.accountCode || a.hesapKodu || "").trim() ===
                          code
                      );
                      onChoose(
                        m,
                        code,
                        hit?.accountName || hit?.hesapAdi || ""
                      );
                    }}
                  />
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>

      <details className="rounded-xl border border-slate-800 bg-slate-950/40 p-4 text-sm text-slate-400">
        <summary className="cursor-pointer text-slate-300">
          Gelişmiş: kayıtlı eşleme alanları (otomatik doldurulur)
        </summary>
        <div className="mt-3 space-y-2 text-xs">
          <div>Kasa: {(company.cashAccounts || []).length}</div>
          <div>POS: {(company.posMerchantAccounts || []).length}</div>
          <div>Banka: {(company.bankAccounts || []).length}</div>
          <div>KK: {(company.creditCards || []).length}</div>
          <div>
            Çek 101: {company.checkAccountMappings?.receivedChecksAccount || "—"}{" "}
            / 103: {company.checkAccountMappings?.givenChecksAccount || "—"}
          </div>
          <div>
            SGK: {company.taxSgkAccountMappings?.sgkMainAccount || "—"}
          </div>
        </div>
      </details>
    </div>
  );
}
