"use client";

import { formatTurkishMoney } from "@/src/utils/turkishNumberFormat";
import { multiCounterpartNormalNoteTr } from "@/src/utils/multiCounterpartDetail";

/**
 * Bileşik fiş gövdesi — MultiCounterpartDetailModal ve VoucherFindingsDetailModal ortak.
 */
export default function MultiCounterpartDetailBody({
  group = null,
  showIntro = true,
  showTechnicalRows = true,
}) {
  const detail = group?.multiDetail || null;
  if (!detail && !group) return null;

  const lines = Array.isArray(detail?.lines) ? detail.lines : [];
  const counterpartAccounts = Array.isArray(detail?.counterpartAccounts)
    ? detail.counterpartAccounts
    : (Array.isArray(detail?.candidates) ? detail.candidates : []).map((code) => ({
        hesapKodu: code,
        hesapAdi: "",
        yon: "",
        borc: 0,
        alacak: 0,
      }));
  const reasonTr =
    detail?.reasonTr ||
    "Bu hesap satırı karşı yöndeki birden fazla hesapla birlikte çalışmıştır.";
  const normalNoteTr = detail?.normalNoteTr || multiCounterpartNormalNoteTr();
  const technicalRows = Array.isArray(group?.details) ? group.details : [];

  return (
    <div className="space-y-4" data-testid="multi-counterpart-detail-body">
      {showIntro ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">
          <p>{reasonTr}</p>
          <p className="mt-1 text-slate-600">{normalNoteTr}</p>
        </div>
      ) : null}

      <section>
        <h3 className="mb-2 text-sm font-medium text-slate-800">
          Birlikte çalışan karşı hesaplar
        </h3>
        {counterpartAccounts.length === 0 ? (
          <p className="text-sm text-slate-500">
            Birlikte çalışan karşı hesap listesi üretilemedi.
          </p>
        ) : (
          <div className="overflow-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-100 text-xs uppercase text-slate-600">
                <tr>
                  <th className="px-3 py-2">Hesap kodu</th>
                  <th className="px-3 py-2">Hesap adı</th>
                  <th className="px-3 py-2">Yön</th>
                  <th className="px-3 py-2 text-right">Borç</th>
                  <th className="px-3 py-2 text-right">Alacak</th>
                </tr>
              </thead>
              <tbody>
                {counterpartAccounts.map((account) => (
                  <tr key={account.hesapKodu} className="border-t border-slate-100">
                    <td className="px-3 py-1.5 font-mono text-xs text-slate-900">
                      {account.hesapKodu || "—"}
                    </td>
                    <td className="px-3 py-1.5 text-slate-700">{account.hesapAdi || "—"}</td>
                    <td className="px-3 py-1.5 text-slate-800">{account.yon || "—"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-800">
                      {formatTurkishMoney(account.borc)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-800">
                      {formatTurkishMoney(account.alacak)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-sm font-medium text-slate-800">Fiş muhasebe satırları</h3>
        <div className="max-h-[48vh] overflow-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-left text-sm">
            <thead className="sticky top-0 z-10 bg-slate-100 text-xs uppercase text-slate-600">
              <tr>
                <th className="px-3 py-2">Hesap kodu</th>
                <th className="px-3 py-2">Hesap adı</th>
                <th className="px-3 py-2">Yön</th>
                <th className="px-3 py-2 text-right">Borç</th>
                <th className="px-3 py-2 text-right">Alacak</th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr>
                  <td className="px-3 py-3 text-slate-500" colSpan={5}>
                    Bu fiş için muhasebe satırı bulunamadı.
                  </td>
                </tr>
              ) : (
                lines.flatMap((line, index) => {
                  const prev = lines[index - 1];
                  const showSideDivider = prev?.yon === "BORÇ" && line.yon === "ALACAK";
                  const rows = [];
                  if (showSideDivider) {
                    rows.push(
                      <tr key={`${line.id}|side-divider`} className="border-t border-slate-200">
                        <td
                          colSpan={5}
                          className="bg-slate-50 px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-slate-500"
                        >
                          Alacak
                        </td>
                      </tr>
                    );
                  }
                  rows.push(
                    <tr
                      key={line.id}
                      className={
                        line.multiAffected
                          ? "border-t border-slate-100 bg-teal-50/40"
                          : "border-t border-slate-100"
                      }
                    >
                      <td className="px-3 py-1.5 font-mono text-xs text-slate-900">
                        {line.hesapKodu || "—"}
                      </td>
                      <td className="px-3 py-1.5 text-slate-700">{line.hesapAdi || "—"}</td>
                      <td className="px-3 py-1.5 text-slate-800">{line.yon || "—"}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-800">
                        {formatTurkishMoney(line.borc)}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-800">
                        {formatTurkishMoney(line.alacak)}
                      </td>
                    </tr>
                  );
                  return rows;
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {showTechnicalRows ? (
        <section>
          <h3 className="mb-2 text-sm font-medium text-slate-800">
            Teknik satır bulguları ({technicalRows.length})
          </h3>
          <div className="max-h-40 overflow-auto rounded-lg border border-slate-200 bg-slate-50">
            <table className="min-w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-100 text-slate-600">
                <tr>
                  <th className="px-2 py-1.5">Hesap</th>
                  <th className="px-2 py-1.5">Seviye</th>
                  <th className="px-2 py-1.5">Kod</th>
                  <th className="px-2 py-1.5">Mesaj</th>
                </tr>
              </thead>
              <tbody>
                {technicalRows.length === 0 ? (
                  <tr>
                    <td className="px-2 py-2 text-slate-500" colSpan={4}>
                      Teknik satır bulgusu yok.
                    </td>
                  </tr>
                ) : (
                  technicalRows.map((row, idx) => (
                    <tr
                      key={`${row.hesapKodu || "x"}|${row.code || "c"}|${idx}`}
                      className="border-t border-slate-200"
                    >
                      <td className="px-2 py-1 font-mono">{row.hesapKodu || "—"}</td>
                      <td className="px-2 py-1">{row.severity || "—"}</td>
                      <td className="px-2 py-1 font-mono">{row.code || "—"}</td>
                      <td className="px-2 py-1 text-slate-700">
                        {row.displayMessage || row.messageTr || row.message || "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
