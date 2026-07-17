"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import CompanySelectOptions from "../components/CompanySelectOptions";
import { useCompanyList } from "../hooks/useCompanyList";
import { DOCUMENT_TYPE_OPTIONS } from "@/src/utils/previewRowEdit";
import {
  buildAccountingRuleFormDraft,
  buildAccountingRuleFromDraft,
  buildSampleRulesForCompany,
  createEmptyAccountingRule,
  filterAccountingRuleRows,
  formatAccountingRuleDate,
  KAYNAK_TIPLERI,
  loadAccountingRulesFromStorage,
  mapAccountingRuleToListRow,
  saveAccountingRulesToStorage,
  testAccountingRule,
} from "@/src/utils/accountingRuleEngine";

const inputClassName =
  "w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-white outline-none focus:border-indigo-500";

const emptyForm = buildAccountingRuleFormDraft(createEmptyAccountingRule());

export default function KuralMotoruPage() {
  const { companies, selectedCompanyId, setSelectedCompanyId, getCompanyDisplayName } =
    useCompanyList();

  const [rules, setRules] = useState([]);
  const [search, setSearch] = useState("");
  const [kaynakTipiFilter, setKaynakTipiFilter] = useState("TUMU");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState(null);
  const [formDraft, setFormDraft] = useState(emptyForm);
  const [testText, setTestText] = useState("");
  const [testKaynakTipi, setTestKaynakTipi] = useState("Banka");
  const [toast, setToast] = useState(null);

  const showToast = (message, type) => setToast({ message, type });

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  const companyNameById = useMemo(() => {
    const map = new Map();
    companies.forEach((company) => {
      map.set(company.id, getCompanyDisplayName(company));
    });
    return map;
  }, [companies, getCompanyDisplayName]);

  const reloadRules = useCallback(() => {
    setRules(loadAccountingRulesFromStorage());
  }, []);

  useEffect(() => {
    reloadRules();
    window.addEventListener("focus", reloadRules);
    return () => window.removeEventListener("focus", reloadRules);
  }, [reloadRules]);

  const listRows = useMemo(
    () =>
      rules.map((rule) =>
        mapAccountingRuleToListRow(rule, companyNameById.get(rule.companyId) || rule.companyId)
      ),
    [rules, companyNameById]
  );

  const filteredRows = useMemo(
    () =>
      filterAccountingRuleRows(listRows, {
        search,
        companyId: selectedCompanyId,
        kaynakTipi: kaynakTipiFilter,
      }),
    [listRows, search, selectedCompanyId, kaynakTipiFilter]
  );

  const testResult = useMemo(() => {
    if (!testText.trim() || !selectedCompanyId) return null;

    return testAccountingRule(testText, {
      companyId: selectedCompanyId,
      kaynakTipi: testKaynakTipi,
      rules,
    });
  }, [testText, selectedCompanyId, testKaynakTipi, rules]);

  const openCreateModal = () => {
    setEditingRuleId(null);
    setFormDraft({
      ...emptyForm,
      companyId: selectedCompanyId || "",
    });
    setIsModalOpen(true);
  };

  const openEditModal = (row) => {
    setEditingRuleId(row.id);
    setFormDraft(buildAccountingRuleFormDraft(row.raw));
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingRuleId(null);
    setFormDraft(emptyForm);
  };

  const updateFormField = (field, value) => {
    setFormDraft((prev) => ({ ...prev, [field]: value }));
  };

  const persistRules = (nextRules) => {
    saveAccountingRulesToStorage(nextRules);
    setRules(nextRules);
  };

  const saveRule = () => {
    if (!formDraft.companyId) {
      showToast("Firma seçmelisin", "error");
      return;
    }

    if (!String(formDraft.aramaMetni || "").trim()) {
      showToast("Arama metni boş olamaz", "error");
      return;
    }

    const existing = editingRuleId
      ? rules.find((rule) => rule.id === editingRuleId)
      : null;
    const nextRule = buildAccountingRuleFromDraft(formDraft, existing);

    const nextRules = editingRuleId
      ? rules.map((rule) => (rule.id === editingRuleId ? nextRule : rule))
      : [...rules, nextRule];

    persistRules(nextRules);
    showToast(editingRuleId ? "Kural güncellendi" : "Kural eklendi", "success");
    closeModal();
  };

  const deleteRule = (row) => {
    const confirmed = window.confirm("Bu kuralı silmek istediğinize emin misiniz?");
    if (!confirmed) return;

    persistRules(rules.filter((rule) => rule.id !== row.id));
    showToast("Kural silindi", "success");
  };

  const toggleActive = (row) => {
    persistRules(
      rules.map((rule) =>
        rule.id === row.id
          ? { ...rule, isActive: !row.isActive, updatedAt: Date.now() }
          : rule
      )
    );
    showToast(row.isActive ? "Kural pasif yapıldı" : "Kural aktif yapıldı", "success");
  };

  const addSampleRules = () => {
    if (!selectedCompanyId) {
      showToast("Örnek kurallar için firma seç", "error");
      return;
    }

    const samples = buildSampleRulesForCompany(selectedCompanyId);
    persistRules([...rules, ...samples]);
    showToast("Örnek kurallar eklendi", "success");
  };

  return (
    <main className="min-h-screen bg-gray-950 p-8 text-white">
      {toast ? (
        <div
          role="status"
          className={`fixed top-4 right-4 z-[9999] rounded-lg border px-4 py-3 text-sm font-medium shadow-xl ${
            toast.type === "success"
              ? "border-emerald-700 bg-emerald-950 text-emerald-200"
              : "border-red-700 bg-red-950 text-red-200"
          }`}
        >
          {toast.message}
        </div>
      ) : null}

      <h1 className="mb-2 text-4xl font-bold">Muhasebe Kural Motoru</h1>
      <p className="mb-8 text-gray-400">
        Banka, Elektraweb ve diğer dönüşümlerde uygulanacak kuralları yönetin. Parser sırası:
        öğrenen hafıza → kural motoru → varsayılan mantık.
      </p>

      <div className="mb-6 grid grid-cols-1 gap-4 rounded-2xl border border-gray-800 bg-gray-900 p-4 lg:grid-cols-4">
        <label className="block lg:col-span-2">
          <span className="mb-1 block text-sm text-gray-400">Arama</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Arama metni, hesap, belge türü..."
            className={inputClassName}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm text-gray-400">Firma Filtresi</span>
          <select
            value={selectedCompanyId}
            onChange={(event) => setSelectedCompanyId(event.target.value)}
            className={inputClassName}
          >
            <option value="">Tüm Firmalar</option>
            <CompanySelectOptions companies={companies} />
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm text-gray-400">Kaynak Tipi</span>
          <select
            value={kaynakTipiFilter}
            onChange={(event) => setKaynakTipiFilter(event.target.value)}
            className={inputClassName}
          >
            <option value="TUMU">Tümü</option>
            {KAYNAK_TIPLERI.map((tip) => (
              <option key={tip} value={tip}>
                {tip}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mb-6 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={openCreateModal}
          className="rounded-lg bg-indigo-600 px-4 py-2 font-semibold hover:bg-indigo-700"
        >
          Yeni Kural Ekle
        </button>
        <button
          type="button"
          onClick={addSampleRules}
          className="rounded-lg border border-gray-700 px-4 py-2 font-semibold text-gray-200 hover:bg-gray-800"
        >
          Örnek Kuralları Ekle
        </button>
        <button
          type="button"
          onClick={reloadRules}
          className="rounded-lg border border-gray-700 px-4 py-2 font-semibold text-gray-200 hover:bg-gray-800"
        >
          Yenile
        </button>
      </div>

      <div className="rounded-2xl border border-gray-800 bg-gray-900 p-6">
        <h2 className="mb-4 text-2xl font-semibold">Kurallar</h2>

        {filteredRows.length === 0 ? (
          <p className="text-gray-400">Kural bulunamadı.</p>
        ) : (
          <div className="overflow-auto">
            <table className="w-full min-w-[1500px] text-sm">
              <thead className="bg-gray-800">
                <tr>
                  <th className="p-3 text-left">Firma</th>
                  <th className="p-3 text-left">Kaynak Tipi</th>
                  <th className="p-3 text-left">Arama Metni</th>
                  <th className="p-3 text-left">Belge Türü</th>
                  <th className="p-3 text-left">Hesap Kodu</th>
                  <th className="p-3 text-left">Fiş Açıklama Şablonu</th>
                  <th className="p-3 text-left">Öncelik</th>
                  <th className="p-3 text-left">Aktif/Pasif</th>
                  <th className="p-3 text-left">Son Güncelleme</th>
                  <th className="p-3 text-center">İşlem</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => (
                  <tr key={row.id} className="border-t border-gray-800">
                    <td className="p-3">{row.firmaAdi}</td>
                    <td className="p-3">{row.kaynakTipi}</td>
                    <td className="p-3 font-mono text-xs">
                      {row.useRegex ? `/${row.aramaMetni}/` : row.aramaMetni}
                    </td>
                    <td className="p-3">{row.belgeTuru || "—"}</td>
                    <td className="p-3 font-mono text-xs">{row.hesapKodu || "—"}</td>
                    <td className="p-3 max-w-[280px]">{row.fisAciklamaSablonu || "—"}</td>
                    <td className="p-3">{row.oncelik}</td>
                    <td className="p-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          row.isActive
                            ? "bg-emerald-950 text-emerald-300 ring-1 ring-emerald-700/60"
                            : "bg-gray-800 text-gray-400 ring-1 ring-gray-700"
                        }`}
                      >
                        {row.isActive ? "Aktif" : "Pasif"}
                      </span>
                    </td>
                    <td className="p-3">{formatAccountingRuleDate(row.sonGuncelleme)}</td>
                    <td className="p-3">
                      <div className="flex flex-wrap justify-center gap-2">
                        <button
                          type="button"
                          onClick={() => openEditModal(row)}
                          className="rounded-lg border border-indigo-700/60 px-3 py-1.5 text-xs font-semibold text-indigo-200 hover:bg-indigo-950/50"
                        >
                          Düzenle
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleActive(row)}
                          className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-semibold text-gray-200 hover:bg-gray-800"
                        >
                          {row.isActive ? "Pasif Yap" : "Aktif Yap"}
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteRule(row)}
                          className="rounded-lg border border-red-800/60 px-3 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-950/40"
                        >
                          Sil
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-4 text-sm text-gray-400">
          Toplam {filteredRows.length}/{listRows.length} kural görüntüleniyor.
        </p>
      </div>

      <div className="mt-6 rounded-2xl border border-gray-800 bg-gray-900 p-6">
        <h2 className="mb-4 text-2xl font-semibold">Kural Test Alanı</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <label className="block md:col-span-2">
            <span className="mb-1 block text-sm text-gray-400">Test Açıklaması</span>
            <input
              value={testText}
              onChange={(event) => setTestText(event.target.value)}
              placeholder="Örn: GOOGLE CLOUD ÖDEMESİ"
              className={inputClassName}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-gray-400">Kaynak Tipi</span>
            <select
              value={testKaynakTipi}
              onChange={(event) => setTestKaynakTipi(event.target.value)}
              className={inputClassName}
            >
              {KAYNAK_TIPLERI.map((tip) => (
                <option key={tip} value={tip}>
                  {tip}
                </option>
              ))}
            </select>
          </label>
        </div>

        {!selectedCompanyId ? (
          <p className="mt-4 text-sm text-amber-300">Test için firma filtresinden bir firma seçin.</p>
        ) : !testText.trim() ? (
          <p className="mt-4 text-sm text-gray-400">Test açıklaması girin.</p>
        ) : testResult?.matched ? (
          <div className="mt-4 rounded-xl border border-emerald-800/50 bg-emerald-950/30 p-4 text-sm">
            <p className="font-semibold text-emerald-200">Eşleşen kural</p>
            <p className="mt-2 text-emerald-100">
              {testResult.matched.useRegex ? "Regex" : "Metin"}:{" "}
              <span className="font-mono">{testResult.matched.aramaMetni}</span>
            </p>
            <p className="text-emerald-100">
              Hesap: {testResult.matched.hesapKodu || "—"} | Belge:{" "}
              {testResult.matched.belgeTuru || "—"} | Öncelik: {testResult.matched.oncelik}
            </p>
            {testResult.candidates.length > 1 ? (
              <p className="mt-2 text-emerald-200/80">
                {testResult.candidates.length} kural eşleşti; en düşük öncelik numarası kazandı.
              </p>
            ) : null}
          </div>
        ) : (
          <p className="mt-4 text-sm text-gray-400">Eşleşen aktif kural bulunamadı.</p>
        )}
      </div>

      {isModalOpen ? (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-gray-700 bg-gray-900 p-6 shadow-2xl">
            <h3 className="mb-4 text-2xl font-semibold">
              {editingRuleId ? "Kural Düzenle" : "Yeni Kural Ekle"}
            </h3>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field label="Firma">
                <select
                  value={formDraft.companyId}
                  onChange={(event) => updateFormField("companyId", event.target.value)}
                  className={inputClassName}
                >
                  <option value="">Seçiniz</option>
                  <CompanySelectOptions companies={companies} />
                </select>
              </Field>

              <Field label="Kaynak Tipi">
                <select
                  value={formDraft.kaynakTipi}
                  onChange={(event) => updateFormField("kaynakTipi", event.target.value)}
                  className={inputClassName}
                >
                  {KAYNAK_TIPLERI.map((tip) => (
                    <option key={tip} value={tip}>
                      {tip}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Arama Metni" className="md:col-span-2">
                <input
                  value={formDraft.aramaMetni}
                  onChange={(event) => updateFormField("aramaMetni", event.target.value)}
                  className={inputClassName}
                  placeholder="GOOGLE, ^GIB, MRT|MR1"
                />
              </Field>

              <label className="flex items-center gap-2 text-sm text-gray-300 md:col-span-2">
                <input
                  type="checkbox"
                  checked={!!formDraft.useRegex}
                  onChange={(event) => updateFormField("useRegex", event.target.checked)}
                />
                Regex kullanılsın mı?
              </label>

              <Field label="Hesap Kodu">
                <input
                  value={formDraft.hesapKodu}
                  onChange={(event) => updateFormField("hesapKodu", event.target.value)}
                  className={inputClassName}
                />
              </Field>

              <Field label="Belge Türü">
                <select
                  value={formDraft.belgeTuru}
                  onChange={(event) => updateFormField("belgeTuru", event.target.value)}
                  className={inputClassName}
                >
                  {DOCUMENT_TYPE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Fiş Açıklama Şablonu" className="md:col-span-2">
                <input
                  value={formDraft.fisAciklamaSablonu}
                  onChange={(event) =>
                    updateFormField("fisAciklamaSablonu", event.target.value)
                  }
                  className={inputClassName}
                  placeholder="{ACIKLAMA} kullanılabilir"
                />
              </Field>

              <Field label="Öncelik Sırası">
                <input
                  type="number"
                  value={formDraft.oncelik}
                  onChange={(event) =>
                    updateFormField("oncelik", Number(event.target.value))
                  }
                  className={inputClassName}
                />
              </Field>

              <Field label="Aktif/Pasif">
                <select
                  value={formDraft.isActive ? "active" : "inactive"}
                  onChange={(event) =>
                    updateFormField("isActive", event.target.value === "active")
                  }
                  className={inputClassName}
                >
                  <option value="active">Aktif</option>
                  <option value="inactive">Pasif</option>
                </select>
              </Field>
            </div>

            <div className="mt-6 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={saveRule}
                className="rounded-lg bg-indigo-600 px-4 py-2 font-semibold hover:bg-indigo-700"
              >
                Kaydet
              </button>
              <button
                type="button"
                onClick={closeModal}
                className="rounded-lg bg-gray-700 px-4 py-2 hover:bg-gray-600"
              >
                İptal
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function Field({ label, children, className = "" }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-sm text-gray-400">{label}</span>
      {children}
    </label>
  );
}
