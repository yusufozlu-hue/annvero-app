"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  clearBankCardOpsSession,
  loadBankCardOpsSession,
  markTransactionsReadyForLuca,
  saveBankCardOpsSession,
} from "@/src/utils/bankCardOpsCenter";
import { RECOGNITION_STATUS_LABELS } from "@/src/models/normalizedFinancialTransaction";
import {
  DECISION_SOURCE_LABELS,
  RISK_LEVEL_LABELS,
} from "@/src/models/accountingDecision";
import { parseCreditCardStatementStub } from "@/src/utils/financialSourceArchitecture";

/**
 * Banka & Kart Operasyon Merkezi — karar motoru özeti.
 * UI güzelleştirme yok; metrik + liste + connector linkleri.
 */
export default function BankCardOpsCenterPage() {
  const [session, setSession] = useState(null);
  const [apiHint, setApiHint] = useState("");

  useEffect(() => {
    setSession(loadBankCardOpsSession());
  }, []);

  const metrics = session?.dashboard?.metrics || null;
  const labels = session?.dashboard?.labels || {};

  const metricRows = useMemo(() => {
    if (!metrics) return [];
    return [
      ["recognized", labels.recognized || "Tanınan Hareket"],
      ["from_memory", labels.from_memory || "Hafızadan Tanınan"],
      ["from_rule", labels.from_rule || "Kuralla Tanınan"],
      ["from_ai", labels.from_ai || "AI Önerisi"],
      ["unknown", labels.unknown || "Tanınmayan"],
      ["risky", labels.risky || "Riskli"],
      ["duplicate", labels.duplicate || "Mükerrer"],
      ["total", labels.total || "Toplam hareket"],
      ["ready_for_voucher", labels.ready_for_voucher || "Luca fişine hazır"],
    ].map(([key, label]) => ({ key, label, value: metrics[key] ?? 0 }));
  }, [metrics, labels]);

  const creditCardStub = parseCreditCardStatementStub([], {
    bankName: session?.bank_name || "",
  });

  const handleMarkReady = () => {
    if (!session?.transactions?.length) return;
    const next = markTransactionsReadyForLuca(session.transactions);
    saveBankCardOpsSession({
      ...session,
      transactions: next,
    });
    setSession(loadBankCardOpsSession());
  };

  const handleClear = () => {
    clearBankCardOpsSession();
    setSession(null);
  };

  const handleSyncApi = async () => {
    if (!session?.transactions?.length) {
      setApiHint("Önce banka ekstresi önizlemesi oluşturun.");
      return;
    }
    try {
      const res = await fetch("/api/bank-card-ops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_id: session.company_id,
          bank_name: session.bank_name,
          source_file_name: session.source_file_name,
          transactions: session.transactions,
        }),
      });
      const data = await res.json();
      setApiHint(
        data.ok
          ? `${data.upserted} hareket kaydedildi.`
          : data.hint || data.error || "Kayıt başarısız."
      );
    } catch (error) {
      setApiHint(error?.message || "API hatası");
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 text-sm text-zinc-200">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-white">Banka & Kart Operasyon Merkezi</h1>
        <p className="text-zinc-400">
          Muhasebe Karar Motoru: Memory → Rule → AI (stub) → Manual. Parser akışı aynen çalışır.
        </p>
        <p className="text-[11px] text-zinc-500">
          Pipeline: {(session?.dashboard?.decision_pipeline || ["Memory", "Rule", "AI", "Manual"]).join(" → ")}
        </p>
      </header>

      <nav className="flex flex-wrap gap-3 text-cyan-300">
        <Link href="/muhasebe/banka-ekstresi">Banka Parser</Link>
        <Link href="/muhasebe/ogrenen-hafiza">Öğrenen Hafıza</Link>
        <Link href="/muhasebe/kural-motoru">Kural Motoru</Link>
        <Link href="/muhasebe/islem-hafizasi">Tanınmayan Kuyruk</Link>
        <Link href="/muhasebe/luca-donusturucu">Luca Fiş Üretici</Link>
      </nav>

      {!metrics ? (
        <div className="rounded border border-zinc-700 p-4 text-zinc-400">
          Henüz oturum yok.{" "}
          <Link className="text-cyan-300 underline" href="/muhasebe/banka-ekstresi">
            Banka Parser
          </Link>{" "}
          ile ön izleme oluşturunca karar motoru özeti burada görünür.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {metricRows.map((row) => (
              <div key={row.key} className="rounded border border-zinc-700 bg-zinc-900/50 p-3">
                <div className="text-xs text-zinc-500">{row.label}</div>
                <div className="mt-1 text-2xl font-semibold text-white">{row.value}</div>
              </div>
            ))}
          </div>

          <div className="space-y-1 text-xs text-zinc-500">
            <div>Firma: {session.company_id || "—"}</div>
            <div>Banka: {session.bank_name || "—"}</div>
            <div>Dosya: {session.source_file_name || "—"}</div>
            <div>Oturum: {session.saved_at || "—"}</div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleMarkReady}
              className="rounded border border-zinc-600 px-3 py-1.5 text-zinc-100 hover:bg-zinc-800"
            >
              Uygun hareketleri fişe hazır işaretle
            </button>
            <button
              type="button"
              onClick={handleSyncApi}
              className="rounded border border-zinc-600 px-3 py-1.5 text-zinc-100 hover:bg-zinc-800"
            >
              DB’ye senkronize et
            </button>
            <button
              type="button"
              onClick={handleClear}
              className="rounded border border-zinc-600 px-3 py-1.5 text-zinc-100 hover:bg-zinc-800"
            >
              Oturumu temizle
            </button>
          </div>
          {apiHint ? <p className="text-xs text-amber-200">{apiHint}</p> : null}

          <div className="overflow-x-auto rounded border border-zinc-700">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-zinc-900 text-zinc-400">
                <tr>
                  <th className="px-2 py-2">Tarih</th>
                  <th className="px-2 py-2">Açıklama</th>
                  <th className="px-2 py-2">Borç</th>
                  <th className="px-2 py-2">Alacak</th>
                  <th className="px-2 py-2">Durum</th>
                  <th className="px-2 py-2">Güven Skoru</th>
                  <th className="px-2 py-2">Önerilen Hesap</th>
                  <th className="px-2 py-2">Önerilen Cari</th>
                  <th className="px-2 py-2">Muhasebe Açıklaması</th>
                  <th className="px-2 py-2">Muhasebe Kaynağı</th>
                  <th className="px-2 py-2">Risk</th>
                </tr>
              </thead>
              <tbody>
                {(session.transactions || []).slice(0, 100).map((tx) => {
                  const source =
                    tx.decision_source ||
                    tx.accounting_decision?.decision_source ||
                    "";
                  return (
                    <tr key={tx.id} className="border-t border-zinc-800">
                      <td className="px-2 py-1.5 whitespace-nowrap">{tx.transaction_date}</td>
                      <td className="max-w-[200px] truncate px-2 py-1.5">{tx.description_raw}</td>
                      <td className="px-2 py-1.5">{tx.debit_amount}</td>
                      <td className="px-2 py-1.5">{tx.credit_amount}</td>
                      <td className="px-2 py-1.5">
                        {RECOGNITION_STATUS_LABELS[tx.recognition_status] ||
                          tx.recognition_status}
                      </td>
                      <td className="px-2 py-1.5">{tx.confidence_score ?? 0}</td>
                      <td className="px-2 py-1.5">
                        {tx.suggested_account_code || "—"}
                        {tx.suggested_counter_account || tx.suggested_counter_account_code
                          ? ` / ${tx.suggested_counter_account || tx.suggested_counter_account_code}`
                          : ""}
                      </td>
                      <td className="px-2 py-1.5">{tx.suggested_cari || "—"}</td>
                      <td className="max-w-[180px] truncate px-2 py-1.5">
                        {tx.suggested_description || tx.message || "—"}
                      </td>
                      <td className="px-2 py-1.5">
                        {DECISION_SOURCE_LABELS[source] || source || "—"}
                      </td>
                      <td className="px-2 py-1.5">
                        {RISK_LEVEL_LABELS[tx.risk_level] || tx.risk_level || "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <section className="rounded border border-zinc-700 p-4 text-xs text-zinc-400">
        <div className="font-medium text-zinc-300">Kredi kartı / AI altyapısı</div>
        <p className="mt-1">source_type = credit_card — {creditCardStub.note}</p>
        <p className="mt-1">
          AI katmanı: `decideFromAiStub` hazır, bu sprintte çağrı yok. Eşleşme yoksa UNKNOWN →
          tanınmayan kuyruk.
        </p>
      </section>
    </div>
  );
}
