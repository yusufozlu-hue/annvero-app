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
import { parseCreditCardStatementStub } from "@/src/utils/financialSourceArchitecture";

/**
 * Banka & Kart Operasyon Merkezi — çekirdek özet ekranı.
 * UI güzelleştirme yok; metrik + son oturum + connector linkleri.
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
      ["total", labels.total || "Toplam hareket"],
      ["recognized", labels.recognized || "Tanınan işlem"],
      ["unknown", labels.unknown || "Tanınmayan işlem"],
      ["suggested", labels.suggested || "Önerilen işlem"],
      ["risky", labels.risky || "Riskli işlem"],
      ["duplicate", labels.duplicate || "Mükerrer şüpheli işlem"],
      ["ready_for_voucher", labels.ready_for_voucher || "Luca fişine hazır işlem"],
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
    <div className="mx-auto max-w-5xl space-y-6 p-4 text-sm text-zinc-200">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-white">Banka & Kart Operasyon Merkezi</h1>
        <p className="text-zinc-400">
          Ortak finansal hareket modeli, tanıma durumları ve Luca fiş hazırlık özeti.
          Mevcut Banka Parser akışı değişmeden bağlanmıştır.
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
          ile ön izleme oluşturunca özet burada görünür.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
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
                  <th className="px-2 py-2">Hesap</th>
                  <th className="px-2 py-2">Skor</th>
                </tr>
              </thead>
              <tbody>
                {(session.transactions || []).slice(0, 100).map((tx) => (
                  <tr key={tx.id} className="border-t border-zinc-800">
                    <td className="px-2 py-1.5 whitespace-nowrap">{tx.transaction_date}</td>
                    <td className="px-2 py-1.5 max-w-[280px] truncate">{tx.description_raw}</td>
                    <td className="px-2 py-1.5">{tx.debit_amount}</td>
                    <td className="px-2 py-1.5">{tx.credit_amount}</td>
                    <td className="px-2 py-1.5">
                      {RECOGNITION_STATUS_LABELS[tx.recognition_status] || tx.recognition_status}
                    </td>
                    <td className="px-2 py-1.5">
                      {tx.suggested_account_code}
                      {tx.suggested_counter_account_code
                        ? ` / ${tx.suggested_counter_account_code}`
                        : ""}
                    </td>
                    <td className="px-2 py-1.5">{tx.confidence_score}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <section className="rounded border border-zinc-700 p-4 text-xs text-zinc-400">
        <div className="font-medium text-zinc-300">Kredi kartı altyapısı</div>
        <p className="mt-1">
          source_type = credit_card — {creditCardStub.note}
        </p>
        <p className="mt-1">Dosya türleri (mimari): xlsx/xls aktif; csv, pdf, ocr_pdf, zip, email_attachment sonraki sprint.</p>
      </section>
    </div>
  );
}
