"use client";

import { useMemo, useState } from "react";
import MuhasebeMenu from "../components/MuhasebeMenu";
import CompanySelectOptions from "../components/CompanySelectOptions";
import { useCompanyList } from "../hooks/useCompanyList";
import {
  BEYANNAME_TYPES,
  DEFAULT_DECLARATION_DISTRIBUTIONS,
  buildDeclarationDashboardStats,
  buildDeclarationRecord,
  loadDeclarationAccrualRecords,
  saveDeclarationAccrualRecords,
} from "@/src/utils/beyannameTahakkukEngine";

const inputClassName =
  "w-full rounded-xl border border-white/10 bg-gray-950/80 px-3 py-2.5 text-sm text-white outline-none transition focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/20";

function formatMoney(value) {
  return Number(value || 0).toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function buildDefaultForm(companyId = "") {
  const type = "KDV";
  return {
    companyId,
    period: "",
    type,
    totalPayment: "",
    distributions: DEFAULT_DECLARATION_DISTRIBUTIONS[type].map((row) => ({ ...row })),
    description: "",
    dueDate: "",
    isPaid: false,
  };
}

export default function BeyannameTahakkukPage() {
  const { companies, selectedCompanyId, setSelectedCompanyId } = useCompanyList();
  const [records, setRecords] = useState(() => loadDeclarationAccrualRecords());
  const [editingId, setEditingId] = useState("");
  const [form, setForm] = useState(() => buildDefaultForm(selectedCompanyId));
  const [toast, setToast] = useState("");

  const filteredRecords = useMemo(
    () => records.filter((record) => !selectedCompanyId || record.companyId === selectedCompanyId),
    [records, selectedCompanyId]
  );

  const stats = useMemo(() => buildDeclarationDashboardStats(filteredRecords), [filteredRecords]);

  const selectedTotal = useMemo(
    () => form.distributions.reduce((sum, row) => sum + Number(row.amount || 0), 0),
    [form.distributions]
  );

  const persistRecords = (nextRecords) => {
    setRecords(nextRecords);
    saveDeclarationAccrualRecords(nextRecords);
  };

  const updateForm = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const changeType = (type) => {
    setForm((prev) => ({
      ...prev,
      type,
      distributions: (DEFAULT_DECLARATION_DISTRIBUTIONS[type] || []).map((row) => ({ ...row })),
    }));
  };

  const updateDistribution = (index, field, value) => {
    setForm((prev) => ({
      ...prev,
      distributions: prev.distributions.map((row, rowIndex) =>
        rowIndex === index ? { ...row, [field]: value } : row
      ),
    }));
  };

  const addDistribution = () => {
    setForm((prev) => ({
      ...prev,
      distributions: [
        ...prev.distributions,
        { accountCode: "", accountName: "", amount: "" },
      ],
    }));
  };

  const removeDistribution = (index) => {
    setForm((prev) => ({
      ...prev,
      distributions: prev.distributions.filter((_, rowIndex) => rowIndex !== index),
    }));
  };

  const resetForm = () => {
    setEditingId("");
    setForm(buildDefaultForm(selectedCompanyId));
  };

  const saveRecord = () => {
    const companyId = selectedCompanyId || form.companyId;
    if (!companyId || !form.period || !form.type) {
      setToast("Firma, dönem ve tür zorunludur.");
      return;
    }

    const record = buildDeclarationRecord({
      ...form,
      companyId,
      totalPayment: form.totalPayment || selectedTotal,
    });

    const nextRecords = editingId
      ? records.map((item) => (item.id === editingId ? { ...record, id: editingId } : item))
      : [record, ...records];

    persistRecords(nextRecords);
    setToast(editingId ? "Tahakkuk kaydı güncellendi." : "Tahakkuk kaydı eklendi.");
    resetForm();
  };

  const editRecord = (record) => {
    setEditingId(record.id);
    setSelectedCompanyId(record.companyId);
    setForm({
      companyId: record.companyId,
      period: record.period,
      type: record.type,
      totalPayment: String(record.totalPayment || ""),
      distributions: (record.distributions || []).map((row) => ({ ...row })),
      description: record.description || "",
      dueDate: record.dueDate || "",
      isPaid: Boolean(record.isPaid),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const deleteRecord = (record) => {
    if (!window.confirm("Bu tahakkuk kaydını silmek istediğinize emin misiniz?")) return;
    persistRecords(records.filter((item) => item.id !== record.id));
    if (editingId === record.id) resetForm();
    setToast("Tahakkuk kaydı silindi.");
  };

  const togglePaid = (record) => {
    persistRecords(
      records.map((item) =>
        item.id === record.id
          ? { ...item, isPaid: !item.isPaid, updatedAt: new Date().toISOString() }
          : item
      )
    );
  };

  return (
    <main className="min-h-screen bg-[#050816] px-4 py-6 text-white sm:px-6 lg:px-8">
      <MuhasebeMenu />

      {toast ? (
        <div className="fixed right-4 top-4 z-[9999] rounded-xl border border-indigo-500/40 bg-indigo-950/95 px-4 py-3 text-sm font-medium text-indigo-100 shadow-xl">
          {toast}
        </div>
      ) : null}

      <div className="mb-6">
        <p className="mb-1 text-xs font-semibold uppercase tracking-[0.2em] text-indigo-300/80">
          Vergi & Beyanname
        </p>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Beyanname / Tahakkuk Dağılım Merkezi
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-gray-400 sm:text-base">
          KDV, MUHSGK, SGK ve benzeri tahakkukları firma/dönem bazlı kaydedin.
          Banka ödemeleri parser sırasında alt hesaplara dağıtılır.
        </p>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Bekleyen Beyanname/Tahakkuk" value={stats.pending} />
        <StatCard label="Bu Ay Ödenenler" value={stats.paidThisMonth} />
        <StatCard label="Eksik Ödeme Uyarıları" value={stats.underpaidWarnings} />
        <StatCard label="Gecikme Zammı Tespitleri" value={stats.lateFeeFindings} />
      </div>

      <section className="mb-6 rounded-2xl border border-white/10 bg-gray-900/70 p-5 shadow-xl shadow-black/20">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">
            {editingId ? "Tahakkuk Kaydı Düzenle" : "Yeni Tahakkuk Kaydı"}
          </h2>
          {editingId ? (
            <button
              type="button"
              onClick={resetForm}
              className="rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-gray-200 hover:bg-white/10"
            >
              İptal
            </button>
          ) : null}
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Firma">
            <select
              value={selectedCompanyId}
              onChange={(event) => {
                setSelectedCompanyId(event.target.value);
                updateForm("companyId", event.target.value);
              }}
              className={inputClassName}
            >
              <option value="">Firma seçin</option>
              <CompanySelectOptions companies={companies} />
            </select>
          </Field>
          <Field label="Dönem">
            <input
              value={form.period}
              onChange={(event) => updateForm("period", event.target.value)}
              placeholder="2026/05"
              className={inputClassName}
            />
          </Field>
          <Field label="Beyanname Türü">
            <select
              value={form.type}
              onChange={(event) => changeType(event.target.value)}
              className={inputClassName}
            >
              {BEYANNAME_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Ödeme Son Tarihi">
            <input
              type="date"
              value={form.dueDate}
              onChange={(event) => updateForm("dueDate", event.target.value)}
              className={inputClassName}
            />
          </Field>
          <Field label="Toplam Ödeme">
            <input
              value={form.totalPayment}
              onChange={(event) => updateForm("totalPayment", event.target.value)}
              placeholder={formatMoney(selectedTotal)}
              className={inputClassName}
            />
          </Field>
          <Field label="Açıklama" className="md:col-span-2">
            <input
              value={form.description}
              onChange={(event) => updateForm("description", event.target.value)}
              placeholder="Tahakkuk açıklaması"
              className={inputClassName}
            />
          </Field>
          <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-gray-950/80 px-3 py-2.5 text-sm text-gray-200">
            <input
              type="checkbox"
              checked={form.isPaid}
              onChange={(event) => updateForm("isPaid", event.target.checked)}
            />
            Ödendi
          </label>
        </div>

        <div className="mt-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="font-semibold text-gray-100">Alt Hesap Dağılımları</h3>
            <button
              type="button"
              onClick={addDistribution}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-gray-200 hover:bg-white/10"
            >
              Satır Ekle
            </button>
          </div>

          <div className="space-y-3">
            {form.distributions.map((row, index) => (
              <div key={index} className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_2fr_1fr_auto]">
                <input
                  value={row.accountCode}
                  onChange={(event) => updateDistribution(index, "accountCode", event.target.value)}
                  placeholder="360.01.001"
                  className={inputClassName}
                />
                <input
                  value={row.accountName}
                  onChange={(event) => updateDistribution(index, "accountName", event.target.value)}
                  placeholder="Hesap adı"
                  className={inputClassName}
                />
                <input
                  value={row.amount}
                  onChange={(event) => updateDistribution(index, "amount", event.target.value)}
                  placeholder="0,00"
                  className={inputClassName}
                />
                <button
                  type="button"
                  onClick={() => removeDistribution(index)}
                  className="rounded-xl border border-red-800/60 px-3 py-2 text-xs font-semibold text-red-300 hover:bg-red-950/40"
                >
                  Sil
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={saveRecord}
            className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-950/40 hover:from-indigo-500 hover:to-violet-500"
          >
            {editingId ? "Güncelle" : "Kaydet"}
          </button>
          <span className="text-sm text-gray-400">
            Dağılım toplamı: {formatMoney(selectedTotal)} TL
          </span>
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-gray-900/70 p-5 shadow-xl shadow-black/20">
        <h2 className="mb-4 text-xl font-semibold">Kayıtlar</h2>
        <div className="overflow-x-auto">
          <table className="min-w-[1000px] w-full text-left text-sm">
            <thead className="bg-gray-950 text-xs uppercase tracking-wide text-gray-400">
              <tr>
                <th className="px-4 py-3">Dönem</th>
                <th className="px-4 py-3">Tür</th>
                <th className="px-4 py-3">Toplam</th>
                <th className="px-4 py-3">Alt Hesap</th>
                <th className="px-4 py-3">Son Tarih</th>
                <th className="px-4 py-3">Durum</th>
                <th className="px-4 py-3">İşlem</th>
              </tr>
            </thead>
            <tbody>
              {filteredRecords.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                    Bu firma için tahakkuk kaydı bulunamadı.
                  </td>
                </tr>
              ) : (
                filteredRecords.map((record) => (
                  <tr key={record.id} className="border-t border-white/10">
                    <td className="px-4 py-3">{record.period}</td>
                    <td className="px-4 py-3">{record.type}</td>
                    <td className="px-4 py-3">{formatMoney(record.totalPayment)} TL</td>
                    <td className="px-4 py-3">
                      {(record.distributions || []).length} satır
                    </td>
                    <td className="px-4 py-3">{record.dueDate || "-"}</td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => togglePaid(record)}
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${
                          record.isPaid
                            ? "bg-emerald-950 text-emerald-300 ring-1 ring-emerald-700/60"
                            : "bg-amber-950 text-amber-300 ring-1 ring-amber-700/60"
                        }`}
                      >
                        {record.isPaid ? "Ödendi" : "Bekliyor"}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => editRecord(record)}
                          className="rounded-lg border border-indigo-700/60 px-3 py-1.5 text-xs font-semibold text-indigo-200 hover:bg-indigo-950/50"
                        >
                          Düzenle
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteRecord(record)}
                          className="rounded-lg border border-red-800/60 px-3 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-950/40"
                        >
                          Sil
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function Field({ label, children, className = "" }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-xs font-medium text-gray-400">{label}</span>
      {children}
    </label>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-gray-900/70 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-2 text-3xl font-bold tabular-nums text-white">{value}</p>
    </div>
  );
}
