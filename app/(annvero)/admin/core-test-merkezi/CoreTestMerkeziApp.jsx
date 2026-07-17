"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import CompanySelectOptions from "@/app/(annvero)/muhasebe/components/CompanySelectOptions";
import { useCompanyList } from "@/app/(annvero)/muhasebe/hooks/useCompanyList";
import {
  canAccessCoreTestCenter,
  isDevelopmentEnvironment,
} from "@/src/lib/dev/coreTestCenterAccess";
import { useUserRole } from "@/src/hooks/useUserRole";
import { CORE_TEST_PRESETS } from "@/src/lib/dev/coreTestPresets";

const inputClass =
  "w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2.5 text-sm text-white outline-none transition focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/40";

const labelClass = "mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400";

function ResultCard({ title, children, mono = false }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <p className="mb-2 text-xs font-bold uppercase tracking-wider text-cyan-300/90">{title}</p>
      <div
        className={`text-sm text-slate-100 ${mono ? "font-mono whitespace-pre-wrap break-all" : ""}`}
      >
        {children}
      </div>
    </div>
  );
}

function formatJsonValue(value) {
  if (value == null || value === "") return "—";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

export default function CoreTestMerkeziApp() {
  const router = useRouter();
  const { loading: roleLoading, isManagementUser, isAdmin, isPartner } = useUserRole();
  const { companies, selectedCompanyId, setSelectedCompanyId, isLoading: companiesLoading } =
    useCompanyList();

  const [description, setDescription] = useState("GOOGLE ADS PAYMENT");
  const [amount, setAmount] = useState("-1250");
  const [sourceType, setSourceType] = useState("bank");
  const [bankName, setBankName] = useState("Vakıfbank");
  const [activePresetId, setActivePresetId] = useState("google-ads");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [responsePayload, setResponsePayload] = useState(null);

  const allowed = useMemo(
    () =>
      canAccessCoreTestCenter({
        isDevelopment: isDevelopmentEnvironment(),
        isManagementUser,
        isAdmin,
        isPartner,
      }),
    [isManagementUser, isAdmin, isPartner]
  );

  useEffect(() => {
    if (!roleLoading && !allowed) {
      router.replace("/dashboard?error=core_test_forbidden");
    }
  }, [roleLoading, allowed, router]);

  function applyPreset(preset) {
    setActivePresetId(preset.id);
    setDescription(preset.description);
    setAmount(preset.amount);
    setSourceType(preset.source_type);
    setBankName(preset.bank_name);
    setError("");
    setResponsePayload(null);
  }

  async function handleTest() {
    setError("");
    setResponsePayload(null);

    const companyId = String(selectedCompanyId || "").trim();
    if (!companyId) {
      setError("Lütfen bir firma seçin.");
      return;
    }

    const parsedAmount = Number(String(amount).replace(",", "."));
    if (!Number.isFinite(parsedAmount)) {
      setError("Tutar geçerli bir sayı olmalıdır.");
      return;
    }

    setRunning(true);
    try {
      const response = await fetch("/api/dev/core-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          company_id: companyId,
          raw_description: String(description || "").trim(),
          amount: parsedAmount,
          currency: "TRY",
          source_type: sourceType,
          bank_name: String(bankName || "").trim(),
        }),
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload?.error || `İstek başarısız (${response.status})`);
      }

      setResponsePayload(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "CORE testi başarısız.");
    } finally {
      setRunning(false);
    }
  }

  if (roleLoading || !allowed) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-slate-400">
        Yetki kontrolü yapılıyor...
      </div>
    );
  }

  const data = responsePayload?.data || null;

  return (
    <div className="space-y-6 pb-10">
      <header className="rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950 p-6">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-400/90">
          Developer Tools
        </p>
        <h1 className="mt-2 text-2xl font-bold text-white">CORE Test Merkezi</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-400">
          ANNVERO CORE karar motorunu canlı test edin. Sonuçlar{" "}
          <code className="rounded bg-slate-800 px-1.5 py-0.5 text-cyan-200">/api/dev/core-test</code>{" "}
          üzerinden gelir; her test{" "}
          <code className="rounded bg-slate-800 px-1.5 py-0.5 text-cyan-200">
            knowledge_decision_history
          </code>{" "}
          tablosuna yazılabilir.
        </p>
        {isDevelopmentEnvironment() ? (
          <span className="mt-3 inline-flex rounded-full border border-emerald-500/40 bg-emerald-950/40 px-3 py-1 text-xs font-semibold text-emerald-200">
            Development ortamı
          </span>
        ) : (
          <span className="mt-3 inline-flex rounded-full border border-amber-500/40 bg-amber-950/40 px-3 py-1 text-xs font-semibold text-amber-200">
            Yönetim erişimi
          </span>
        )}
      </header>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
        <h2 className="mb-3 text-lg font-semibold text-white">Hazır test senaryoları</h2>
        <p className="mb-4 text-sm text-slate-400">
          Görev 5 global muhasebe kural seed seti — migration 018 sonrası doğrulama için.
        </p>
        <div className="flex flex-wrap gap-2">
          {CORE_TEST_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => applyPreset(preset)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                activePresetId === preset.id
                  ? "border-cyan-500 bg-cyan-950/50 text-cyan-200"
                  : "border-slate-700 bg-slate-950/60 text-slate-300 hover:border-slate-500"
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
        <h2 className="mb-4 text-lg font-semibold text-white">Test girdisi</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className={labelClass} htmlFor="core-test-description">
              Açıklama
            </label>
            <input
              id="core-test-description"
              className={inputClass}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="GOOGLE ADS PAYMENT"
            />
          </div>

          <div>
            <label className={labelClass} htmlFor="core-test-amount">
              Tutar
            </label>
            <input
              id="core-test-amount"
              className={inputClass}
              type="number"
              step="any"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="1250"
            />
          </div>

          <div>
            <label className={labelClass} htmlFor="core-test-source-type">
              Source type
            </label>
            <select
              id="core-test-source-type"
              className={inputClass}
              value={sourceType}
              onChange={(e) => setSourceType(e.target.value)}
            >
              <option value="bank">bank</option>
              <option value="credit_card">credit_card</option>
            </select>
          </div>

          <div>
            <label className={labelClass} htmlFor="core-test-bank">
              Banka
            </label>
            <input
              id="core-test-bank"
              className={inputClass}
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              placeholder="Vakıfbank"
              list="core-test-banks"
            />
            <datalist id="core-test-banks">
              <option value="Vakıfbank" />
              <option value="Garanti" />
              <option value="TEB" />
              <option value="Ziraat" />
              <option value="Kuveyt Türk" />
            </datalist>
          </div>

          <div className="md:col-span-2">
            <label className={labelClass} htmlFor="core-test-company">
              Firma
            </label>
            <select
              id="core-test-company"
              className={inputClass}
              value={selectedCompanyId}
              onChange={(e) => setSelectedCompanyId(e.target.value)}
              disabled={companiesLoading}
            >
              <option value="">Firma seçin...</option>
              <CompanySelectOptions companies={companies} />
            </select>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleTest}
            disabled={running}
            className="rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-cyan-900/30 transition hover:from-cyan-500 hover:to-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {running ? "Test çalışıyor..." : "CORE'u Test Et"}
          </button>
          <Link
            href="/admin/parametre-yonetimi"
            className="text-sm text-slate-400 underline-offset-2 hover:text-slate-200 hover:underline"
          >
            Yönetim paneline dön
          </Link>
        </div>

        {error ? (
          <p className="mt-4 rounded-xl border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-200">
            {error}
          </p>
        ) : null}
      </section>

      {responsePayload ? (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-white">Sonuç</h2>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <ResultCard title="matched_entity" mono>
              {formatJsonValue(data?.matched_entity)}
            </ResultCard>
            <ResultCard title="decision_source">{formatJsonValue(data?.decision_source)}</ResultCard>
            <ResultCard title="confidence_score">{formatJsonValue(data?.confidence_score)}</ResultCard>
            <ResultCard title="matched_rule" mono>
              {formatJsonValue(data?.matched_rule)}
            </ResultCard>
            <ResultCard title="suggested_cari">{formatJsonValue(data?.suggested_cari)}</ResultCard>
            <ResultCard title="suggested_account_code">
              {formatJsonValue(data?.suggested_account_code)}
            </ResultCard>
            <ResultCard title="suggested_document_type">
              {formatJsonValue(data?.suggested_document_type)}
            </ResultCard>
            <ResultCard title="needs_manual_review">
              {data?.needs_manual_review === true
                ? "true"
                : data?.needs_manual_review === false
                  ? "false"
                  : "—"}
            </ResultCard>
          </div>

          <ResultCard title="debug_trace" mono>
            {formatJsonValue(data?.debug_trace)}
          </ResultCard>

          <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
            <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">
              Tam JSON yanıtı
            </p>
            <pre className="max-h-[480px] overflow-auto text-xs leading-relaxed text-slate-200">
              {JSON.stringify(responsePayload, null, 2)}
            </pre>
          </div>
        </section>
      ) : null}
    </div>
  );
}
