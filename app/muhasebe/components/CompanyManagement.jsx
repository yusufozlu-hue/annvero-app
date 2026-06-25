"use client";
import React, { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const rawSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseUrl = rawSupabaseUrl.startsWith("http")
  ? rawSupabaseUrl
  : `https://${rawSupabaseUrl}`;

const supabase = createClient(
  supabaseUrl,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
);
console.log(process.env.NEXT_PUBLIC_SUPABASE_URL);
console.log(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const STORAGE_KEY = "annvero_companies_v24";

const emptyCompany = {
  id: "",
  companyName: "",
  taxNumber: "",
  taxOffice: "",

  accountingSoftware: "LUCA",
  hotelSoftware: "YOK",

  hasForeignCurrency: false,
  isActive: true,

  enabledModules: {
    lucaExport: true,
    bankaParser: true,
    elektraweb: false,
    fifoFunds: false,
    payroll: false,
    taxControl: true,
    audit: true,
    officeManagement: true,
    policyExpense: true,
  },

  bankAccounts: [],
  creditCards: [],
  documentSeriesRules: [],
  vehicles: [],
  employees: [],

  accountingRules: {
    mtvExpenseAccount: "",
    posAccountCode: "",
    salaryAccountCode: "",
    advanceAccountCode: "",
    businessAdvanceAccountCode: "",
    policyExpenseMethod: "AYLIK",
    exchangeDifferenceMethod: "DONEM_SONU",
    transferToleranceDays: 1,
  },
};

const moduleLabels = {
  lucaExport: "Luca Export",
  bankaParser: "Banka Parser",
  elektraweb: "Elektraweb",
  fifoFunds: "Fon FIFO",
  payroll: "Bordro",
  taxControl: "Vergi Kontrol",
  audit: "Denetim",
  officeManagement: "Ofis Yönetimi",
  policyExpense: "Poliçe Giderleştirme",
};

export default function CompanyManagement() {
  const [companies, setCompanies] = useState([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [company, setCompany] = useState(emptyCompany);

  const [selectedId, setSelectedId] = useState("");
  const [activeTab, setActiveTab] = useState("general");

  const [bankFormMode, setBankFormMode] = useState(null);
  const [bankFormDraft, setBankFormDraft] = useState(null);

  const [creditCardFormMode, setCreditCardFormMode] = useState(null);
  const [creditCardFormDraft, setCreditCardFormDraft] = useState(null);

  const [banksSectionOpen, setBanksSectionOpen] = useState(false);
  const [creditCardsSectionOpen, setCreditCardsSectionOpen] = useState(false);
  const [expandedBankDetails, setExpandedBankDetails] = useState({});
  const [expandedCreditCardDetails, setExpandedCreditCardDetails] = useState({});
  const [companySearchQuery, setCompanySearchQuery] = useState("");

  useEffect(() => {
    const loadCompanies = async () => {
      const { data, error } = await supabase
        .from("companies")
        .select("*")
        .order("created_at", { ascending: true });
  
      if (error) {
        console.error(error);
        setIsLoaded(true);
        return;
      }
  
      const formatted =
        data?.map((item) => ({
          id: item.id,
          ...item.data,
        })) || [];
  
      setCompanies(formatted);
      setIsLoaded(true);
    };
  
    loadCompanies();
  }, []);

 

  const createNewCompany = () => {
    const newCompany = {
      ...emptyCompany,
      id: crypto.randomUUID(),
      companyName: "Yeni Firma",
    };

    setCompanies([...companies, newCompany]);

    setCompany(newCompany);
    setSelectedId(newCompany.id);
    setActiveTab("general");
  };

  const selectCompany = (id) => {
    const found = companies.find((c) => c.id === id);

    if (found) {
      setSelectedId(id);
      setCompany(normalizeCompany(found));
      setActiveTab("general");
      setBankFormMode(null);
      setBankFormDraft(null);
      setCreditCardFormMode(null);
      setCreditCardFormDraft(null);
      setBanksSectionOpen(false);
      setCreditCardsSectionOpen(false);
      setExpandedBankDetails({});
      setExpandedCreditCardDetails({});
    }
  };

  const toggleBankDetails = (id) => {
    setExpandedBankDetails((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const toggleCreditCardDetails = (id) => {
    setExpandedCreditCardDetails((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const saveCompany = async () => {
    const normalized = normalizeCompany(company);

    if (!normalized.id) {
      normalized.id = crypto.randomUUID();
    }

    if (!normalized.companyName?.trim()) {
      normalized.companyName = company.companyName?.trim() || "Yeni Firma";
    }

    const { error } = await supabase.from("companies").upsert([
      {
        id: normalized.id,
        company_name: normalized.companyName,
        data: normalized,
        updated_at: new Date().toISOString(),
      },
    ]);

    if (error) {
      console.error(error);
      const errorLines = [
        error.message && `Mesaj: ${error.message}`,
        error.details && `Detay: ${error.details}`,
        error.hint && `İpucu: ${error.hint}`,
        error.code && `Kod: ${error.code}`,
      ].filter(Boolean);
      alert(
        errorLines.length > 0
          ? `Firma kaydedilemedi:\n\n${errorLines.join("\n")}`
          : `Firma kaydedilemedi:\n\n${JSON.stringify(error)}`
      );
      return;
    }

    const exists = companies.some((c) => c.id === normalized.id);

    const updated = exists
      ? companies.map((c) => (c.id === normalized.id ? normalized : c))
      : [...companies, normalized];

    setCompanies(updated);
    setCompany(normalized);
    setSelectedId(normalized.id);

    alert("Firma kaydedildi");
  };

  const closeCompanyPanel = () => {
    setSelectedId("");
    setCompany(emptyCompany);
    setBankFormMode(null);
    setBankFormDraft(null);
    setCreditCardFormMode(null);
    setCreditCardFormDraft(null);
    setBanksSectionOpen(false);
    setCreditCardsSectionOpen(false);
    setExpandedBankDetails({});
    setExpandedCreditCardDetails({});
  };

  const deleteCompany = (id) => {
    if (!confirm("Bu firmayı silmek istediğine emin misin?")) return;

    setCompanies(companies.filter((c) => c.id !== id));

    if (selectedId === id) {
      closeCompanyPanel();
    }
  };

  const updateField = (field, value) => {
    setCompany({
      ...company,
      [field]: value,
    });
  };

  const updateModule = (key) => {
    setCompany({
      ...company,
      enabledModules: {
        ...company.enabledModules,
        [key]: !company.enabledModules[key],
      },
    });
  };

  // =========================
  // BANKA HESAPLARI
  // =========================

  const createEmptyBankAccount = () => ({
    id: crypto.randomUUID(),
    bankName: "",
    accountName: "",
    iban: "",
    currency: "TL",
    accountType: "VADESIZ",
    lucaAccountCode: "",
    isPosAccount: false,
    isActive: true,
  });

  const openNewBankForm = () => {
    setBanksSectionOpen(true);
    setBankFormMode("new");
    setBankFormDraft(createEmptyBankAccount());
  };

  const openEditBankForm = (account) => {
    setBanksSectionOpen(true);
    setBankFormMode(account.id);
    setBankFormDraft({ ...account });
  };

  const cancelBankForm = () => {
    setBankFormMode(null);
    setBankFormDraft(null);
  };

  const updateBankFormDraft = (field, value) => {
    setBankFormDraft((prev) => ({ ...prev, [field]: value }));
  };

  const saveBankForm = () => {
    if (!bankFormDraft) return;

    if (bankFormMode === "new") {
      setCompany({
        ...company,
        bankAccounts: [...(company.bankAccounts || []), bankFormDraft],
      });
    } else {
      setCompany({
        ...company,
        bankAccounts: company.bankAccounts.map((b) =>
          b.id === bankFormMode ? bankFormDraft : b
        ),
      });
    }

    cancelBankForm();
  };

  const removeBankAccount = (id) => {
    setCompany({
      ...company,
      bankAccounts: company.bankAccounts.filter((b) => b.id !== id),
    });

    if (bankFormMode === id) {
      cancelBankForm();
    }

    setExpandedBankDetails((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  // =========================
  // KREDİ KARTLARI
  // =========================

  const createEmptyCreditCard = () => ({
    id: crypto.randomUUID(),
    bankName: "",
    cardName: "",
    lastFourDigits: "",
    currency: "TL",
    trackingMethod: "TEK_HESAP",
    statementPeriodRule: "ONCEKI_AY",
    singleLucaAccountCode: "",
    monthly309BaseAccount: "",
    monthly409BaseAccount: "",
    isActive: true,
  });

  const openNewCreditCardForm = () => {
    setCreditCardsSectionOpen(true);
    setCreditCardFormMode("new");
    setCreditCardFormDraft(createEmptyCreditCard());
  };

  const openEditCreditCardForm = (card) => {
    setCreditCardsSectionOpen(true);
    setCreditCardFormMode(card.id);
    setCreditCardFormDraft({ ...card });
  };

  const cancelCreditCardForm = () => {
    setCreditCardFormMode(null);
    setCreditCardFormDraft(null);
  };

  const updateCreditCardFormDraft = (field, value) => {
    setCreditCardFormDraft((prev) => ({ ...prev, [field]: value }));
  };

  const saveCreditCardForm = () => {
    if (!creditCardFormDraft) return;

    if (creditCardFormMode === "new") {
      setCompany({
        ...company,
        creditCards: [...(company.creditCards || []), creditCardFormDraft],
      });
    } else {
      setCompany({
        ...company,
        creditCards: company.creditCards.map((c) =>
          c.id === creditCardFormMode ? creditCardFormDraft : c
        ),
      });
    }

    cancelCreditCardForm();
  };

  const removeCreditCard = (id) => {
    setCompany({
      ...company,
      creditCards: company.creditCards.filter((c) => c.id !== id),
    });

    if (creditCardFormMode === id) {
      cancelCreditCardForm();
    }

    setExpandedCreditCardDetails((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  // =========================
  // ARAÇLAR
  // =========================

  const addVehicle = () => {
    setCompany({
      ...company,
      vehicles: [
        ...(company.vehicles || []),
        {
          id: crypto.randomUUID(),

          plate: "",
          brand: "",
          model: "",

          vehicleType: "BINEK",

          policyExpenseMethod: "AYLIK",

          lucaExpenseAccount: "",

          isActive: true,
        },
      ],
    });
  };

  const updateVehicle = (id, field, value) => {
    setCompany({
      ...company,
      vehicles: company.vehicles.map((v) =>
        v.id === id
          ? {
              ...v,
              [field]: value,
            }
          : v
      ),
    });
  };

  const removeVehicle = (id) => {
    setCompany({
      ...company,
      vehicles: company.vehicles.filter(
        (v) => v.id !== id
      ),
    });
  };

  // =========================
  // PERSONEL
  // =========================

  const addEmployee = () => {
    setCompany({
      ...company,
      employees: [
        ...(company.employees || []),
        {
          id: crypto.randomUUID(),

          fullName: "",
          tcNo: "",
          position: "",

          salaryAccountCode: "335",

          advanceAccountCode: "196",

          isActive: true,
        },
      ],
    });
  };

  const updateEmployee = (id, field, value) => {
    setCompany({
      ...company,
      employees: company.employees.map((e) =>
        e.id === id
          ? {
              ...e,
              [field]: value,
            }
          : e
      ),
    });
  };

  const removeEmployee = (id) => {
    setCompany({
      ...company,
      employees: company.employees.filter(
        (e) => e.id !== id
      ),
    });
  };

  const tabs = [
    ["general", "Genel Bilgiler"],

    ["banks", "Banka & Kredi Kartları"],

    ["documents", "Belge Serileri"],

    ["vehicles", "Araçlar"],

    ["employees", "Personel"],

    ["modules", "Modüller"],

    ["rules", "Özel Kurallar"],
  ];

  const sortCompaniesByName = (a, b) =>
    (a.companyName || "").localeCompare(b.companyName || "", "tr", {
      sensitivity: "base",
    });
  
  const matchesCompanySearch = (c) => {
    const query = companySearchQuery.trim().toLowerCase();
  
    if (!query) return true;
  
    return String(c.companyName || "")
      .toLowerCase()
      .includes(query);
  };

    const activeCompanies = companies
    .filter((c) => matchesCompanySearch(c) && c.isActive !== false)
    .slice()
    .sort(sortCompaniesByName);
  
    const passiveCompanies = companies
    .filter((c) => matchesCompanySearch(c) && c.isActive === false)
    .slice()
    .sort(sortCompaniesByName);

  const renderCompanyButton = (c) => {
    const isSelected = selectedId === c.id;
    const isPassive = c.isActive === false;

    let visualClass = "";

    if (isSelected) {
      visualClass = isPassive
        ? "bg-indigo-600/80 ring-1 ring-slate-600"
        : "bg-indigo-600";
    } else if (isPassive) {
      visualClass =
        "bg-slate-800/40 text-slate-400 opacity-75 hover:bg-slate-800 hover:opacity-100";
    } else {
      visualClass = "bg-slate-800 hover:bg-slate-700";
    }

    return (
      <div key={c.id} className="flex items-stretch gap-1">
        <button
          onClick={() => selectCompany(c.id)}
          className={`min-w-0 flex-1 rounded-lg px-4 py-2 text-left text-sm transition-colors ${visualClass}`}
        >
          <div className="truncate font-medium">{c.companyName}</div>
          {isPassive && (
            <div className="mt-0.5 text-xs text-slate-500">Pasif</div>
          )}
        </button>
        <button
          type="button"
          onClick={() => deleteCompany(c.id)}
          className="shrink-0 rounded-lg bg-red-600/80 px-2.5 py-2 text-xs font-medium hover:bg-red-600"
        >
          Sil
        </button>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#050816] p-6 text-white">
      <div className="mx-auto max-w-screen-2xl space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <button
              onClick={() => (window.location.href = "/muhasebe")}
              className="mb-4 rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-700"
            >
              ← Muhasebe Paneline Dön
            </button>

            <h1 className="text-3xl font-bold">
              Firma Yönetim Merkezi v2.4
            </h1>

            <p className="mt-1 text-slate-400">
              Firma, banka, kredi kartı, belge serisi, araç, personel ve modül yönetimi
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={createNewCompany}
              className="rounded-lg bg-indigo-600 px-4 py-2 font-semibold hover:bg-indigo-500"
            >
              + Yeni Firma
            </button>

            {selectedId && (
              <button
                onClick={closeCompanyPanel}
                className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-semibold hover:bg-slate-600"
              >
                Kapat
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[340px_1fr]">
          <aside className="flex h-[480px] flex-col rounded-xl border border-slate-800 bg-slate-900 p-4 lg:h-[calc(100vh-10rem)] lg:w-full">
            <h2 className="mb-3 shrink-0 font-semibold">Firmalar</h2>

            <input
              type="text"
              value={companySearchQuery}
              onChange={(e) => setCompanySearchQuery(e.target.value)}
              placeholder="Firma ara..."
              className="mb-3 w-full shrink-0 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm outline-none placeholder:text-slate-500 focus:border-indigo-500"
            />

            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
              {activeCompanies.length === 0 && passiveCompanies.length === 0 ? (
                <p className="px-1 py-2 text-sm text-slate-500">
                  Sonuç bulunamadı.
                </p>
              ) : (
                <>
                  {activeCompanies.map(renderCompanyButton)}
                  {passiveCompanies.length > 0 && (
                    <>
                      {activeCompanies.length > 0 && (
                        <div className="my-2 border-t border-slate-700/80 pt-2" />
                      )}
                      <p className="px-1 text-[11px] font-medium uppercase tracking-wider text-slate-500">
                        Pasif Firmalar
                      </p>
                      {passiveCompanies.map(renderCompanyButton)}
                    </>
                  )}
                </>
              )}
            </div>
          </aside>

          <main className="min-w-0 rounded-xl border border-slate-800 bg-slate-900 p-4 lg:min-h-[calc(100vh-10rem)] lg:p-6">
            {!selectedId ? (
              <WelcomeScreen />
            ) : (
              <>
            <div className="mb-6 flex flex-wrap gap-2">
              {tabs.map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setActiveTab(key)}
                  className={`rounded-lg px-4 py-2 ${
                    activeTab === key
                      ? "bg-indigo-600"
                      : "bg-slate-800 hover:bg-slate-700"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {activeTab === "general" && (
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
                <Input
                  label="Firma Adı"
                  value={company.companyName}
                  onChange={(v) => updateField("companyName", v)}
                />

                <Input
                  label="Vergi No"
                  value={company.taxNumber}
                  onChange={(v) => updateField("taxNumber", v)}
                />

                <Input
                  label="Vergi Dairesi"
                  value={company.taxOffice}
                  onChange={(v) => updateField("taxOffice", v)}
                />

                <Select
                  label="Muhasebe Programı"
                  value={company.accountingSoftware}
                  onChange={(v) => updateField("accountingSoftware", v)}
                  options={["LUCA", "LOGO", "MIKRO", "NETSIS"]}
                />

                <Select
                  label="Otel Programı"
                  value={company.hotelSoftware}
                  onChange={(v) => updateField("hotelSoftware", v)}
                  options={["YOK", "ELEKTRAWEB"]}
                />

                <Checkbox
                  label="Dövizli Çalışıyor"
                  checked={company.hasForeignCurrency}
                  onChange={(v) => updateField("hasForeignCurrency", v)}
                />

                <Checkbox
                  label="Aktif Firma"
                  checked={company.isActive}
                  onChange={(v) => updateField("isActive", v)}
                />
              </div>
            )}

            {activeTab === "banks" && (
              <div className="space-y-4">
                <CollapsibleSection
                  title="Banka Hesapları"
                  count={(company.bankAccounts || []).length}
                  open={banksSectionOpen}
                  onToggle={() => setBanksSectionOpen((v) => !v)}
                  onAdd={openNewBankForm}
                  addLabel="+ Banka Hesabı Ekle"
                >
                  <div className="space-y-3">
                    {(company.bankAccounts || []).length === 0 ? (
                      <EmptyListMessage text="Henüz banka hesabı eklenmedi." />
                    ) : (
                      (company.bankAccounts || []).map((b) => (
                        <CompactListItem
                          key={b.id}
                          onEdit={() => openEditBankForm(b)}
                          onDelete={() => removeBankAccount(b.id)}
                          detailsOpen={!!expandedBankDetails[b.id]}
                          onToggleDetails={() => toggleBankDetails(b.id)}
                          primary={
                            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                              <ListField label="Banka" value={b.bankName} />
                              <ListField label="Hesap Adı" value={b.accountName} />
                              <ListField label="Para Birimi" value={b.currency} />
                              <ListField
                                label="Hesap Tipi"
                                value={labelText(b.accountType)}
                              />
                            </div>
                          }
                          secondary={
                            <InfoRow>
                              <InfoItem label="IBAN" value={b.iban} wrap />
                              <InfoItem
                                label="Luca Hesap Kodu"
                                value={b.lucaAccountCode}
                              />
                              <InfoItem
                                label="POS Hesabı"
                                value={b.isPosAccount ? "Evet" : "Hayır"}
                              />
                              <InfoItem
                                label="Durum"
                                value={b.isActive ? "Aktif" : "Pasif"}
                                active={b.isActive}
                              />
                            </InfoRow>
                          }
                        />
                      ))
                    )}
                  </div>

                  {bankFormDraft && (
                    <FormPanel
                      title={
                        bankFormMode === "new"
                          ? "Yeni Banka Hesabı"
                          : "Banka Hesabını Düzenle"
                      }
                      onSave={saveBankForm}
                      onCancel={cancelBankForm}
                    >
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                        <Input
                          label="Banka"
                          value={bankFormDraft.bankName}
                          onChange={(v) => updateBankFormDraft("bankName", v)}
                        />
                        <Input
                          label="Hesap Adı"
                          value={bankFormDraft.accountName}
                          onChange={(v) => updateBankFormDraft("accountName", v)}
                        />
                        <Input
                          label="IBAN"
                          value={bankFormDraft.iban}
                          onChange={(v) => updateBankFormDraft("iban", v)}
                        />
                        <Select
                          label="Para Birimi"
                          value={bankFormDraft.currency}
                          onChange={(v) => updateBankFormDraft("currency", v)}
                          options={["TL", "USD", "EUR"]}
                        />
                        <Select
                          label="Hesap Tipi"
                          value={bankFormDraft.accountType}
                          onChange={(v) => updateBankFormDraft("accountType", v)}
                          options={["VADESIZ", "VADELI", "POS", "KREDI"]}
                        />
                        <Input
                          label="Luca Hesap Kodu"
                          value={bankFormDraft.lucaAccountCode}
                          onChange={(v) =>
                            updateBankFormDraft("lucaAccountCode", v)
                          }
                        />
                        <Checkbox
                          label="POS Hesabı"
                          checked={bankFormDraft.isPosAccount}
                          onChange={(v) => updateBankFormDraft("isPosAccount", v)}
                        />
                        <Checkbox
                          label="Aktif"
                          checked={bankFormDraft.isActive}
                          onChange={(v) => updateBankFormDraft("isActive", v)}
                        />
                      </div>
                    </FormPanel>
                  )}
                </CollapsibleSection>

                <CollapsibleSection
                  title="Kredi Kartları"
                  count={(company.creditCards || []).length}
                  open={creditCardsSectionOpen}
                  onToggle={() => setCreditCardsSectionOpen((v) => !v)}
                  onAdd={openNewCreditCardForm}
                  addLabel="+ Kredi Kartı Ekle"
                >
                  <div className="space-y-3">
                    {(company.creditCards || []).length === 0 ? (
                      <EmptyListMessage text="Henüz kredi kartı eklenmedi." />
                    ) : (
                      (company.creditCards || []).map((c) => (
                        <CompactListItem
                          key={c.id}
                          onEdit={() => openEditCreditCardForm(c)}
                          onDelete={() => removeCreditCard(c.id)}
                          detailsOpen={!!expandedCreditCardDetails[c.id]}
                          onToggleDetails={() => toggleCreditCardDetails(c.id)}
                          primary={
                            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                              <ListField label="Banka" value={c.bankName} />
                              <ListField label="Kart Adı" value={c.cardName} />
                              <ListField
                                label="Son 4 Hane"
                                value={c.lastFourDigits}
                              />
                              <ListField
                                label="Takip Yöntemi"
                                value={labelText(c.trackingMethod)}
                              />
                            </div>
                          }
                          secondary={
                            <InfoRow>
                              <InfoItem
                                label="309 Ana Hesap"
                                value={c.monthly309BaseAccount}
                              />
                              <InfoItem
                                label="409 Ana Hesap"
                                value={c.monthly409BaseAccount}
                              />
                              <InfoItem
                                label="Ekstre Dönemi"
                                value={labelText(c.statementPeriodRule)}
                              />
                              <InfoItem label="Para Birimi" value={c.currency} />
                              <InfoItem
                                label="Durum"
                                value={c.isActive ? "Aktif" : "Pasif"}
                                active={c.isActive}
                              />
                            </InfoRow>
                          }
                        />
                      ))
                    )}
                  </div>

                  {creditCardFormDraft && (
                    <FormPanel
                      title={
                        creditCardFormMode === "new"
                          ? "Yeni Kredi Kartı"
                          : "Kredi Kartını Düzenle"
                      }
                      onSave={saveCreditCardForm}
                      onCancel={cancelCreditCardForm}
                    >
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                        <Input
                          label="Banka"
                          value={creditCardFormDraft.bankName}
                          onChange={(v) =>
                            updateCreditCardFormDraft("bankName", v)
                          }
                        />
                        <Input
                          label="Kart Adı"
                          value={creditCardFormDraft.cardName}
                          onChange={(v) =>
                            updateCreditCardFormDraft("cardName", v)
                          }
                        />
                        <Input
                          label="Son 4 Hane"
                          value={creditCardFormDraft.lastFourDigits}
                          onChange={(v) =>
                            updateCreditCardFormDraft("lastFourDigits", v)
                          }
                        />
                        <Select
                          label="Para Birimi"
                          value={creditCardFormDraft.currency}
                          onChange={(v) =>
                            updateCreditCardFormDraft("currency", v)
                          }
                          options={["TL", "USD", "EUR"]}
                        />
                        <Select
                          label="Takip Yöntemi"
                          value={creditCardFormDraft.trackingMethod}
                          onChange={(v) =>
                            updateCreditCardFormDraft("trackingMethod", v)
                          }
                          options={[
                            "TEK_HESAP",
                            "AY_BAZLI_309",
                            "AY_BAZLI_309_409",
                          ]}
                        />
                        <Select
                          label="Ekstre Dönemi Mantığı"
                          value={creditCardFormDraft.statementPeriodRule}
                          onChange={(v) =>
                            updateCreditCardFormDraft("statementPeriodRule", v)
                          }
                          options={["ONCEKI_AY", "AYNI_AY"]}
                        />
                        <Input
                          label="Tek Luca Hesabı"
                          value={creditCardFormDraft.singleLucaAccountCode}
                          onChange={(v) =>
                            updateCreditCardFormDraft(
                              "singleLucaAccountCode",
                              v
                            )
                          }
                        />
                        <Input
                          label="309 Ana Hesap"
                          value={creditCardFormDraft.monthly309BaseAccount}
                          onChange={(v) =>
                            updateCreditCardFormDraft(
                              "monthly309BaseAccount",
                              v
                            )
                          }
                          hint="Örn: 309.01 veya 309.02 yazın, ay kodunu sistem ekler."
                        />
                        <Input
                          label="409 Ana Hesap"
                          value={creditCardFormDraft.monthly409BaseAccount}
                          onChange={(v) =>
                            updateCreditCardFormDraft(
                              "monthly409BaseAccount",
                              v
                            )
                          }
                          hint="Örn: 409.01 veya 409.02 yazın, ay kodunu sistem ekler."
                        />
                        <Checkbox
                          label="Aktif"
                          checked={creditCardFormDraft.isActive}
                          onChange={(v) =>
                            updateCreditCardFormDraft("isActive", v)
                          }
                        />
                      </div>
                    </FormPanel>
                  )}
                </CollapsibleSection>
              </div>
            )}

{activeTab === "documents" && (
              <ListSection
                buttonText="+ Belge Serisi Ekle"
                onAdd={() =>
                  setCompany({
                    ...company,
                    documentSeriesRules: [
                      ...(company.documentSeriesRules || []),
                      {
                        id: crypto.randomUUID(),
                        prefix: "",
                        documentType: "EA",
                        description: "",
                      },
                    ],
                  })
                }
              >
                {(company.documentSeriesRules || []).map((r) => (
                  <Card key={r.id}>
                    <Input
                      label="Seri Ön Eki"
                      value={r.prefix}
                      onChange={(v) =>
                        setCompany({
                          ...company,
                          documentSeriesRules: company.documentSeriesRules.map(
                            (x) =>
                              x.id === r.id
                                ? { ...x, prefix: v.toUpperCase() }
                                : x
                          ),
                        })
                      }
                    />

                    <Select
                      label="Belge Türü"
                      value={r.documentType}
                      onChange={(v) =>
                        setCompany({
                          ...company,
                          documentSeriesRules: company.documentSeriesRules.map(
                            (x) =>
                              x.id === r.id ? { ...x, documentType: v } : x
                          ),
                        })
                      }
                      options={["EA", "EF", "DK", "KR", "NM", "SMM", "FT"]}
                    />

                    <Input
                      label="Açıklama"
                      value={r.description}
                      onChange={(v) =>
                        setCompany({
                          ...company,
                          documentSeriesRules: company.documentSeriesRules.map(
                            (x) =>
                              x.id === r.id ? { ...x, description: v } : x
                          ),
                        })
                      }
                    />

                    <DeleteButton
                      onClick={() =>
                        setCompany({
                          ...company,
                          documentSeriesRules:
                            company.documentSeriesRules.filter(
                              (x) => x.id !== r.id
                            ),
                        })
                      }
                    />
                  </Card>
                ))}
              </ListSection>
            )}

            {activeTab === "vehicles" && (
              <ListSection buttonText="+ Araç Ekle" onAdd={addVehicle}>
                {(company.vehicles || []).map((v) => (
                  <Card key={v.id}>
                    <Input
                      label="Plaka"
                      value={v.plate}
                      onChange={(x) =>
                        updateVehicle(v.id, "plate", x.toUpperCase())
                      }
                    />

                    <Input
                      label="Marka"
                      value={v.brand}
                      onChange={(x) => updateVehicle(v.id, "brand", x)}
                    />

                    <Input
                      label="Model"
                      value={v.model}
                      onChange={(x) => updateVehicle(v.id, "model", x)}
                    />

                    <Select
                      label="Araç Tipi"
                      value={v.vehicleType}
                      onChange={(x) => updateVehicle(v.id, "vehicleType", x)}
                      options={["BINEK", "TICARI"]}
                    />

                    <Select
                      label="Poliçe Giderleştirme"
                      value={v.policyExpenseMethod}
                      onChange={(x) =>
                        updateVehicle(v.id, "policyExpenseMethod", x)
                      }
                      options={["AYLIK", "UC_AYLIK"]}
                    />

                    <Input
                      label="Luca Gider Hesabı"
                      value={v.lucaExpenseAccount}
                      onChange={(x) =>
                        updateVehicle(v.id, "lucaExpenseAccount", x)
                      }
                    />

                    <Checkbox
                      label="Aktif"
                      checked={v.isActive}
                      onChange={(x) => updateVehicle(v.id, "isActive", x)}
                    />

                    <DeleteButton onClick={() => removeVehicle(v.id)} />
                  </Card>
                ))}
              </ListSection>
            )}

            {activeTab === "employees" && (
              <ListSection buttonText="+ Personel Ekle" onAdd={addEmployee}>
                {(company.employees || []).map((e) => (
                  <Card key={e.id}>
                    <Input
                      label="Ad Soyad"
                      value={e.fullName}
                      onChange={(x) => updateEmployee(e.id, "fullName", x)}
                    />

                    <Input
                      label="TC No"
                      value={e.tcNo}
                      onChange={(x) => updateEmployee(e.id, "tcNo", x)}
                    />

                    <Input
                      label="Görev / Departman"
                      value={e.position}
                      onChange={(x) => updateEmployee(e.id, "position", x)}
                    />

                    <Input
                      label="Maaş Hesabı"
                      value={e.salaryAccountCode}
                      onChange={(x) =>
                        updateEmployee(e.id, "salaryAccountCode", x)
                      }
                    />

                    <Input
                      label="Avans Hesabı"
                      value={e.advanceAccountCode}
                      onChange={(x) =>
                        updateEmployee(e.id, "advanceAccountCode", x)
                      }
                    />

                    <Checkbox
                      label="Aktif"
                      checked={e.isActive}
                      onChange={(x) => updateEmployee(e.id, "isActive", x)}
                    />

                    <DeleteButton onClick={() => removeEmployee(e.id)} />
                  </Card>
                ))}
              </ListSection>
            )}

            {activeTab === "modules" && (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {Object.keys(company.enabledModules || {}).map((key) => (
                  <button
                    key={key}
                    onClick={() => updateModule(key)}
                    className={`rounded-lg border px-4 py-3 text-left ${
                      company.enabledModules[key]
                        ? "border-emerald-600 bg-emerald-950"
                        : "border-slate-700 bg-slate-800"
                    }`}
                  >
                    <div className="font-semibold">
                      {moduleLabels[key] || key}
                    </div>

                    <div className="text-sm text-slate-400">
                      {company.enabledModules[key] ? "Aktif" : "Pasif"}
                    </div>
                  </button>
                ))}
              </div>
            )}

            {activeTab === "rules" && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Input
                  label="MTV Gider Hesabı"
                  value={company.accountingRules.mtvExpenseAccount}
                  onChange={(v) =>
                    setCompany({
                      ...company,
                      accountingRules: {
                        ...company.accountingRules,
                        mtvExpenseAccount: v,
                      },
                    })
                  }
                />

                <Input
                  label="POS Hesabı"
                  value={company.accountingRules.posAccountCode}
                  onChange={(v) =>
                    setCompany({
                      ...company,
                      accountingRules: {
                        ...company.accountingRules,
                        posAccountCode: v,
                      },
                    })
                  }
                />

                <Input
                  label="Maaş Hesabı"
                  value={company.accountingRules.salaryAccountCode}
                  onChange={(v) =>
                    setCompany({
                      ...company,
                      accountingRules: {
                        ...company.accountingRules,
                        salaryAccountCode: v,
                      },
                    })
                  }
                />

                <Input
                  label="Maaş Avans Hesabı"
                  value={company.accountingRules.advanceAccountCode}
                  onChange={(v) =>
                    setCompany({
                      ...company,
                      accountingRules: {
                        ...company.accountingRules,
                        advanceAccountCode: v,
                      },
                    })
                  }
                />

                <Input
                  label="İş Avansı Hesabı"
                  value={company.accountingRules.businessAdvanceAccountCode}
                  onChange={(v) =>
                    setCompany({
                      ...company,
                      accountingRules: {
                        ...company.accountingRules,
                        businessAdvanceAccountCode: v,
                      },
                    })
                  }
                />

                <Select
                  label="Genel Poliçe Giderleştirme"
                  value={company.accountingRules.policyExpenseMethod}
                  onChange={(v) =>
                    setCompany({
                      ...company,
                      accountingRules: {
                        ...company.accountingRules,
                        policyExpenseMethod: v,
                      },
                    })
                  }
                  options={["AYLIK", "UC_AYLIK"]}
                />

                <Select
                  label="Kur Farkı Mantığı"
                  value={company.accountingRules.exchangeDifferenceMethod}
                  onChange={(v) =>
                    setCompany({
                      ...company,
                      accountingRules: {
                        ...company.accountingRules,
                        exchangeDifferenceMethod: v,
                      },
                    })
                  }
                  options={["GUNLUK", "DONEM_SONU"]}
                />

                <Input
                  type="number"
                  label="Virman Tarih Toleransı"
                  value={company.accountingRules.transferToleranceDays}
                  onChange={(v) =>
                    setCompany({
                      ...company,
                      accountingRules: {
                        ...company.accountingRules,
                        transferToleranceDays: Number(v),
                      },
                    })
                  }
                />
              </div>
            )}

            <div className="mt-8 flex justify-end">
              <button
                onClick={saveCompany}
                className="rounded-lg bg-indigo-600 px-6 py-3 font-semibold hover:bg-indigo-700"
              >
                Kaydet
              </button>
            </div>
              </>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
function normalizeCompany(c) {
    return {
      ...emptyCompany,
      ...c,
  
      enabledModules: {
        ...emptyCompany.enabledModules,
        ...(c.enabledModules || {}),
      },
  
      accountingRules: {
        ...emptyCompany.accountingRules,
        ...(c.accountingRules || {}),
      },
  
      bankAccounts: c.bankAccounts || [],
  
      creditCards: (c.creditCards || []).map((card) => ({
        id: card.id || crypto.randomUUID(),
        bankName: card.bankName || "",
        cardName: card.cardName || "",
        lastFourDigits: card.lastFourDigits || "",
        currency: card.currency || "TL",
        trackingMethod: card.trackingMethod || "TEK_HESAP",
        statementPeriodRule: card.statementPeriodRule || "ONCEKI_AY",
        singleLucaAccountCode: card.singleLucaAccountCode || "",
        monthly309BaseAccount: card.monthly309BaseAccount || "",
        monthly409BaseAccount: card.monthly409BaseAccount || "",
        isActive: card.isActive ?? true,
      })),
  
      documentSeriesRules: c.documentSeriesRules || [],
      vehicles: c.vehicles || [],
      employees: c.employees || [],
    };
  }
  
  function WelcomeScreen() {
    return (
      <div className="flex min-h-[480px] flex-col items-center justify-center px-6 py-16 text-center lg:min-h-[calc(100vh-10rem)]">
        <div className="relative mb-6">
          <div className="absolute -inset-8 -z-10 rounded-full bg-indigo-500/10 blur-3xl" />
          <div className="absolute -inset-4 -z-10 rounded-full bg-violet-500/5 blur-2xl" />
          <h2 className="bg-gradient-to-r from-indigo-300 via-slate-100 to-indigo-300 bg-clip-text text-5xl font-bold tracking-[0.2em] text-transparent sm:text-6xl">
            ANNVERO
          </h2>
        </div>
        <p className="text-lg font-medium text-slate-300 sm:text-xl">
          AI Destekli Mali Operasyon Platformu
        </p>
        <p className="mt-4 max-w-md text-sm leading-relaxed text-slate-500">
          Firma seçerek veya yeni firma oluşturarak işlemlere başlayabilirsiniz.
        </p>
      </div>
    );
  }

  function SectionTitle({ title, desc }) {
    return (
      <div className="mb-3">
        <h3 className="text-lg font-semibold">{title}</h3>
        {desc && <p className="text-sm text-slate-400">{desc}</p>}
      </div>
    );
  }
  
  function ListSection({ buttonText, onAdd, children }) {
    return (
      <div className="space-y-4">
        <button
          onClick={onAdd}
          className="rounded-lg bg-emerald-600 px-4 py-2 hover:bg-emerald-700"
        >
          {buttonText}
        </button>
  
        <div className="space-y-4">{children}</div>
      </div>
    );
  }
  
  function Card({ children }) {
    return (
      <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-700 bg-slate-950 p-4 md:grid-cols-3">
        {children}
      </div>
    );
  }
  
  function Input({ label, value, onChange, type = "text", hint }) {
    return (
      <label className="block">
        <div className="mb-1 text-sm text-slate-400">{label}</div>
  
        <input
          type={type}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 outline-none focus:border-indigo-500"
        />

        {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
      </label>
    );
  }
  
  function Select({ label, value, onChange, options }) {
    return (
      <label className="block">
        <div className="mb-1 text-sm text-slate-400">{label}</div>
  
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 outline-none focus:border-indigo-500"
        >
          {options.map((o) => (
            <option key={o} value={o}>
              {labelText(o)}
            </option>
          ))}
        </select>
      </label>
    );
  }
  
  function Checkbox({ label, checked, onChange }) {
    return (
      <label className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2">
        <input
          type="checkbox"
          checked={!!checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>{label}</span>
      </label>
    );
  }
  
  function EmptyListMessage({ text }) {
    return (
      <div className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-6 text-center text-sm text-slate-500">
        {text}
      </div>
    );
  }

  function CollapsibleSection({
    title,
    count,
    open,
    onToggle,
    onAdd,
    addLabel,
    children,
  }) {
    return (
      <section className="rounded-xl border border-slate-700/80 bg-slate-950/40">
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <h3 className="text-base font-semibold text-slate-100">
            {title} ({count})
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={onAdd}
              className="rounded-lg bg-emerald-600 px-3 py-2 text-sm hover:bg-emerald-700"
            >
              {addLabel}
            </button>
            <button
              onClick={onToggle}
              className="rounded-lg bg-slate-700 px-3 py-2 text-sm hover:bg-slate-600"
            >
              {open ? "Kapat" : "Aç"}
            </button>
          </div>
        </div>
        {open && (
          <div className="space-y-3 border-t border-slate-800 px-4 pb-4 pt-3">
            {children}
          </div>
        )}
      </section>
    );
  }

  function CompactListItem({
    primary,
    secondary,
    onEdit,
    onDelete,
    detailsOpen,
    onToggleDetails,
  }) {
    return (
      <article className="rounded-xl border border-slate-700/80 bg-gradient-to-br from-slate-950 to-slate-900/60 shadow-sm transition-colors hover:border-slate-600">
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:gap-4">
          <div
            className={`min-w-0 flex-1 ${detailsOpen ? "space-y-4" : ""}`}
          >
            {primary}
            {detailsOpen && secondary && (
              <div className="border-t border-slate-800/80 pt-4">{secondary}</div>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2 sm:flex-col sm:items-stretch">
            <DetailButton open={detailsOpen} onClick={onToggleDetails} />
            <EditButton onClick={onEdit} />
            <DeleteButton onClick={onDelete} />
          </div>
        </div>
      </article>
    );
  }

  function ListField({ label, value }) {
    return (
      <div className="min-w-0 space-y-1.5">
        <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
          {label}
        </div>
        <div className="break-words text-sm font-semibold leading-snug text-slate-100">
          {value || "—"}
        </div>
      </div>
    );
  }

  function InfoRow({ children }) {
    return (
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
        {children}
      </div>
    );
  }

  function InfoItem({ label, value, active, wrap }) {
    const valueClass =
      active === true
        ? "text-emerald-400"
        : active === false
          ? "text-slate-400"
          : "text-slate-300";

    return (
      <div className="min-w-0 space-y-2 text-center">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          {label}
        </div>
        <div
          className={`text-sm font-medium leading-snug ${valueClass} ${
            wrap ? "break-all" : "break-words"
          }`}
        >
          {value || "—"}
        </div>
      </div>
    );
  }

  function DetailButton({ open, onClick }) {
    return (
      <button
        onClick={onClick}
        className="whitespace-nowrap rounded-lg border border-slate-600 bg-slate-800/80 px-4 py-2 text-sm font-medium hover:bg-slate-700"
      >
        {open ? "Detay Kapat" : "Detay"}
      </button>
    );
  }

  function DeleteButton({ onClick }) {
    return (
      <button
        onClick={onClick}
        className="whitespace-nowrap rounded-lg bg-red-600/90 px-4 py-2 text-sm font-medium hover:bg-red-600"
      >
        Sil
      </button>
    );
  }

  function EditButton({ onClick }) {
    return (
      <button
        onClick={onClick}
        className="whitespace-nowrap rounded-lg bg-indigo-600/90 px-4 py-2 text-sm font-medium hover:bg-indigo-600"
      >
        Düzenle
      </button>
    );
  }

  function FormPanel({ title, onSave, onCancel, children }) {
    return (
      <div className="rounded-xl border border-indigo-700/50 bg-slate-950 p-4">
        <h4 className="mb-4 text-base font-semibold">{title}</h4>
        {children}
        <div className="mt-4 flex gap-2">
          <button
            onClick={onSave}
            className="rounded-lg bg-indigo-600 px-4 py-2 font-semibold hover:bg-indigo-700"
          >
            Kaydet
          </button>
          <button
            onClick={onCancel}
            className="rounded-lg bg-slate-700 px-4 py-2 hover:bg-slate-600"
          >
            Vazgeç
          </button>
        </div>
      </div>
    );
  }
  
  function labelText(value) {
    const labels = {
      YOK: "Yok",
      ELEKTRAWEB: "Elektraweb",
  
      TL: "TL",
      USD: "USD",
      EUR: "EUR",
  
      VADESIZ: "Vadesiz",
      VADELI: "Vadeli",
      POS: "POS",
      KREDI: "Kredi",
  
      BINEK: "Binek",
      TICARI: "Ticari",
  
      AYLIK: "Aylık",
      UC_AYLIK: "3 Aylık",
  
      GUNLUK: "Günlük",
      DONEM_SONU: "Dönem Sonu",
  
      TEK_HESAP: "Tek Hesap",
      AY_BAZLI_309: "Ay Bazlı 309",
      AY_BAZLI_309_409: "Ay Bazlı 309 + 409",
  
      ONCEKI_AY: "Ödeme Ayından Önceki Ay",
      AYNI_AY: "Ödeme Ayı",
    };
  
    return labels[value] || value;
  }
