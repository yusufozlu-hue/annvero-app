"use client";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import AnnveroLogo from "@/app/components/AnnveroLogo";
import { fetchCompanies, persistCompaniesToLocalStorage } from "@/src/utils/companies";
import { deleteCompanyRecord, saveCompanyRecord } from "@/src/utils/companiesApi";
import { emptyCompany, normalizeCompany } from "@/src/utils/companyNormalize";
import {
  DEFAULT_ADVANCE_ACCOUNT,
  DEFAULT_SALARY_ACCOUNT,
  downloadEmployeeTemplate,
  parseEmployeeExcelFile,
} from "@/src/utils/employeeExcel";
import GibCredentialsSection from "@/app/dashboard/ofis-takip/resmi-bildirimler/components/GibCredentialsSection";

const EMPLOYEE_PAGE_SIZE = 20;

const COMPANY_TAB_SAVE_MESSAGES = {
  general: "Genel bilgiler kaydedildi",
  gib: "GİB e-Tebligat bilgileri kaydedildi",
  banks: "Banka ve kredi kartı bilgileri kaydedildi",
  documents: "Belge serileri kaydedildi",
  vehicles: "Araç bilgileri kaydedildi",
  employees: "Personel bilgileri kaydedildi",
  modules: "Modül tercihleri kaydedildi",
  rules: "Özel kurallar kaydedildi",
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
  const [documentSeriesEditId, setDocumentSeriesEditId] = useState(null);
  const [documentSeriesFormDraft, setDocumentSeriesFormDraft] = useState(null);
  const [contactFormMode, setContactFormMode] = useState(null);
  const [contactFormDraft, setContactFormDraft] = useState(null);
  const [contactsSectionOpen, setContactsSectionOpen] = useState(true);
  const [expandedContactDetails, setExpandedContactDetails] = useState({});
  const [companySearchQuery, setCompanySearchQuery] = useState("");
  const [toast, setToast] = useState(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [newCompanyModalOpen, setNewCompanyModalOpen] = useState(false);
  const [newCompanyDraft, setNewCompanyDraft] = useState({
    companyName: "",
    taxNumber: "",
    taxOffice: "",
  });

  const [employeeSearch, setEmployeeSearch] = useState("");
  const [employeePage, setEmployeePage] = useState(1);
  const [employeeImportPreview, setEmployeeImportPreview] = useState(null);
  const [employeeImportError, setEmployeeImportError] = useState("");
  const [employeeDuplicateMode, setEmployeeDuplicateMode] = useState("update");

  const showToast = (message, type) => {
    setToast({ message, type });
  };

  useEffect(() => {
    if (!toast) return;

    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const loadCompanies = async () => {
      const formatted = await fetchCompanies();

      setCompanies(formatted);
      setIsLoaded(true);
    };

    loadCompanies();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const validTabs = [
      "general",
      "gib",
      "banks",
      "documents",
      "vehicles",
      "employees",
      "modules",
      "rules",
    ];
    const requestedTab = new URLSearchParams(window.location.search).get("tab");

    if (requestedTab && validTabs.includes(requestedTab)) {
      setActiveTab(requestedTab);
    }
  }, []);

 

  const openNewCompanyModal = () => {
    setNewCompanyDraft({
      companyName: "",
      taxNumber: "",
      taxOffice: "",
    });
    setNewCompanyModalOpen(true);
  };

  const cancelNewCompanyModal = () => {
    setNewCompanyModalOpen(false);
  };

  const confirmNewCompany = () => {
    const trimmedName = (newCompanyDraft.companyName || "").trim();

    if (!trimmedName) {
      showToast("Firma adı zorunludur", "error");
      return;
    }

    const normalizedName = trimmedName.toLowerCase();
    const isDuplicate = companies.some(
      (c) => (c.companyName || "").trim().toLowerCase() === normalizedName
    );

    if (isDuplicate) {
      showToast("Bu firma adı zaten kayıtlı", "error");
      return;
    }

    const newCompany = normalizeCompany({
      ...emptyCompany,
      id: crypto.randomUUID(),
      companyName: trimmedName,
      taxNumber: newCompanyDraft.taxNumber || "",
      taxOffice: newCompanyDraft.taxOffice || "",
    });

    setCompanies([...companies, newCompany]);
    setCompany(newCompany);
    setSelectedId(newCompany.id);
    setActiveTab("general");
    setNewCompanyModalOpen(false);
    showToast("Yeni firma oluşturuldu. Bilgileri tamamlayıp kaydedin.", "success");
  };

  const createNewCompany = () => {
    openNewCompanyModal();
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
      setDocumentSeriesEditId(null);
      setDocumentSeriesFormDraft(null);
      setContactFormMode(null);
      setContactFormDraft(null);
      setExpandedContactDetails({});
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
    if (isSaving) return;

    const trimmedName = (company.companyName || "").trim();
    if (!trimmedName) {
      showToast("Firma adı zorunludur", "error");
      return;
    }

    let previousCompany = companies.find((c) => c.id === company.id);

    let normalized = normalizeCompany({
      ...(previousCompany || {}),
      ...company,
      companyName: trimmedName,
      contacts: company.contacts?.length
        ? company.contacts
        : previousCompany?.contacts || [],
      contactPerson: company.contactPerson ?? previousCompany?.contactPerson ?? "",
      contactPhone: company.contactPhone ?? previousCompany?.contactPhone ?? "",
      whatsappPhone: company.whatsappPhone ?? previousCompany?.whatsappPhone ?? "",
      contactEmail: company.contactEmail ?? previousCompany?.contactEmail ?? "",
      address: company.address ?? previousCompany?.address ?? "",
      notes: company.notes ?? previousCompany?.notes ?? "",
    });

    if (!normalized.id) {
      normalized.id = crypto.randomUUID();
    }

    const normalizedName = trimmedName.toLowerCase();
    const isDuplicate = companies.some(
      (c) =>
        c.id !== normalized.id &&
        (c.companyName || "").trim().toLowerCase() === normalizedName
    );

    if (isDuplicate) {
      showToast("Bu firma zaten kayıtlı", "error");
      return;
    }

    setIsSaving(true);

    try {
      await saveCompanyRecord({
        id: normalized.id,
        company_name: normalized.companyName,
        data: normalized,
      });

      const exists = companies.some((c) => c.id === normalized.id);

      const updated = exists
        ? companies.map((c) => (c.id === normalized.id ? normalized : c))
        : [...companies, normalized];

      setCompanies(updated);
      setCompany(normalized);
      setSelectedId(normalized.id);
      persistCompaniesToLocalStorage(updated);

      showToast(
        COMPANY_TAB_SAVE_MESSAGES[activeTab] || "Firma kaydedildi",
        "success"
      );
    } catch (error) {
      console.error("[CompanyManagement] saveCompany failed", {
        companyId: normalized.id,
        companyName: normalized.companyName,
        message: error?.message || String(error),
      });
      showToast(error?.message || "Firma kaydedilemedi.", "error");
    } finally {
      setIsSaving(false);
    }
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
    setDocumentSeriesEditId(null);
    setDocumentSeriesFormDraft(null);
    setContactFormMode(null);
    setContactFormDraft(null);
    setExpandedContactDetails({});
  };

  const deleteCompany = async (id) => {
    if (isDeleting) return false;

    setIsDeleting(true);

    try {
      await deleteCompanyRecord(id);

      setCompanies(companies.filter((c) => c.id !== id));

      if (selectedId === id) {
        closeCompanyPanel();
      }

      showToast("Firma silindi", "success");
      return true;
    } catch (error) {
      console.error("[CompanyManagement] deleteCompany failed", {
        companyId: id,
        message: error?.message || String(error),
      });
      showToast(error?.message || "Firma silinemedi.", "error");
      return false;
    } finally {
      setIsDeleting(false);
    }
  };

  const requestDeleteCompany = (id) => {
    if (isDeleting) return;
    setDeleteConfirmId(id);
  };

  const cancelDeleteCompany = () => {
    if (isDeleting) return;
    setDeleteConfirmId(null);
  };

  const confirmDeleteCompany = async () => {
    if (!deleteConfirmId || isDeleting) return;

    const id = deleteConfirmId;
    const success = await deleteCompany(id);

    if (success) {
      setDeleteConfirmId(null);
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
  // İLETİŞİM KİŞİLERİ
  // =========================

  const createEmptyContact = () => ({
    id: crypto.randomUUID(),
    name: "",
    title: "",
    phone: "",
    whatsapp: "",
    email: "",
    note: "",
    isDefault: (company.contacts || []).length === 0,
  });

  const openNewContactForm = () => {
    setContactsSectionOpen(true);
    setContactFormMode("new");
    setContactFormDraft(createEmptyContact());
  };

  const openEditContactForm = (contact) => {
    setContactsSectionOpen(true);
    setContactFormMode(contact.id);
    setContactFormDraft({ ...contact });
  };

  const cancelContactForm = () => {
    setContactFormMode(null);
    setContactFormDraft(null);
  };

  const updateContactFormDraft = (field, value) => {
    setContactFormDraft((prev) => ({ ...prev, [field]: value }));
  };

  const applyDefaultContactRules = (contacts, selectedId, isDefault) => {
    let nextContacts = contacts.map((contact) => ({ ...contact }));

    if (isDefault) {
      return nextContacts.map((contact) => ({
        ...contact,
        isDefault: contact.id === selectedId,
      }));
    }

    const hasDefault = nextContacts.some((contact) => contact.isDefault);
    if (!hasDefault && nextContacts.length > 0) {
      nextContacts[0] = { ...nextContacts[0], isDefault: true };
    }

    return nextContacts;
  };

  const saveContactForm = () => {
    if (!contactFormDraft) return;

    const trimmedName = (contactFormDraft.name || "").trim();
    if (!trimmedName) {
      showToast("İletişim kişisi adı zorunludur", "error");
      return;
    }

    const nextContact = {
      ...contactFormDraft,
      name: trimmedName,
    };

    let nextContacts = [];

    if (contactFormMode === "new") {
      nextContacts = [...(company.contacts || []), nextContact];
    } else {
      nextContacts = (company.contacts || []).map((contact) =>
        contact.id === contactFormMode ? nextContact : contact
      );
    }

    nextContacts = applyDefaultContactRules(
      nextContacts,
      nextContact.id,
      nextContact.isDefault
    );

    setCompany({
      ...company,
      contacts: nextContacts,
    });

    cancelContactForm();
  };

  const removeContact = (id) => {
    const nextContacts = (company.contacts || []).filter((contact) => contact.id !== id);

    if (nextContacts.length > 0 && !nextContacts.some((contact) => contact.isDefault)) {
      nextContacts[0] = { ...nextContacts[0], isDefault: true };
    }

    setCompany({
      ...company,
      contacts: nextContacts,
    });

    if (contactFormMode === id) {
      cancelContactForm();
    }

    setExpandedContactDetails((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const toggleContactDetails = (id) => {
    setExpandedContactDetails((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const sortedContacts = [...(company.contacts || [])].sort((left, right) => {
    if (left.isDefault === right.isDefault) {
      return (left.name || "").localeCompare(right.name || "", "tr", {
        sensitivity: "base",
      });
    }

    return left.isDefault ? -1 : 1;
  });

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
  // BELGE SERİLERİ
  // =========================

  const documentTypeOptions = ["EA", "EF", "DK", "KR", "NM", "SMM", "FT"];

  const createEmptyDocumentSeries = () => ({
    id: crypto.randomUUID(),
    prefix: "",
    documentType: "EA",
    description: "",
  });

  const cancelDocumentSeriesForm = () => {
    setDocumentSeriesEditId(null);
    setDocumentSeriesFormDraft(null);
  };

  const openNewDocumentSeriesForm = () => {
    if (documentSeriesEditId === "new") {
      cancelDocumentSeriesForm();
      return;
    }

    setDocumentSeriesEditId("new");
    setDocumentSeriesFormDraft(createEmptyDocumentSeries());
  };

  const openEditDocumentSeriesForm = (rule) => {
    if (documentSeriesEditId === rule.id) {
      cancelDocumentSeriesForm();
      return;
    }

    setDocumentSeriesEditId(rule.id);
    setDocumentSeriesFormDraft({ ...rule });
  };

  const updateDocumentSeriesFormDraft = (field, value) => {
    setDocumentSeriesFormDraft((prev) => {
      if (!prev) return prev;

      if (field === "prefix") {
        return { ...prev, prefix: value.toUpperCase() };
      }

      return { ...prev, [field]: value };
    });
  };

  const saveDocumentSeriesForm = () => {
    if (!documentSeriesFormDraft) return;

    if (documentSeriesEditId === "new") {
      setCompany({
        ...company,
        documentSeriesRules: [
          ...(company.documentSeriesRules || []),
          documentSeriesFormDraft,
        ],
      });
    } else {
      setCompany({
        ...company,
        documentSeriesRules: (company.documentSeriesRules || []).map((rule) =>
          rule.id === documentSeriesEditId ? documentSeriesFormDraft : rule
        ),
      });
    }

    cancelDocumentSeriesForm();
  };

  const removeDocumentSeriesRule = (id) => {
    setCompany({
      ...company,
      documentSeriesRules: (company.documentSeriesRules || []).filter(
        (rule) => rule.id !== id
      ),
    });

    if (documentSeriesEditId === id) {
      cancelDocumentSeriesForm();
    }
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
        {
          id: crypto.randomUUID(),

          fullName: "",
          tcNo: "",
          phone: "",
          email: "",
          position: "",
          department: "",
          hireDate: "",
          sgkCode: "",

          salaryAccountCode: DEFAULT_SALARY_ACCOUNT,

          advanceAccountCode: DEFAULT_ADVANCE_ACCOUNT,

          isActive: true,
        },
        ...(company.employees || []),
      ],
    });
    setEmployeePage(1);
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

  const clearAllEmployees = () => {
    if (!(company.employees || []).length) return;

    const confirmed = window.confirm(
      "Tüm personel kayıtları listeden kaldırılacak. Emin misiniz? (Kaydet'e basana kadar kalıcı olmaz.)"
    );
    if (!confirmed) return;

    setCompany({ ...company, employees: [] });
    setEmployeeImportPreview(null);
    setEmployeePage(1);
    showToast("Personel listesi temizlendi. Kaydetmeyi unutmayın.", "success");
  };

  const handleEmployeeExcelUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setEmployeeImportError("");

    try {
      const parsed = await parseEmployeeExcelFile(file);

      if (!parsed.length) {
        setEmployeeImportPreview(null);
        setEmployeeImportError(
          "Dosyada geçerli personel satırı bulunamadı. Şablonu kullandığınızdan emin olun."
        );
      } else {
        setEmployeeImportPreview(parsed);
      }
    } catch (error) {
      console.error("employee excel parse error", error);
      setEmployeeImportPreview(null);
      setEmployeeImportError(
        "Excel okunamadı. Lütfen geçerli bir .xlsx dosyası yükleyin."
      );
    }

    event.target.value = "";
  };

  const cancelEmployeeImport = () => {
    setEmployeeImportPreview(null);
    setEmployeeImportError("");
  };

  const confirmEmployeeImport = () => {
    if (!employeeImportPreview?.length) return;

    const merged = [...(company.employees || [])];
    let addedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;

    employeeImportPreview.forEach((parsed) => {
      const tc = (parsed.tcNo || "").trim();
      const matchIndex = tc
        ? merged.findIndex((e) => (e.tcNo || "").trim() === tc)
        : -1;

      if (matchIndex >= 0) {
        if (employeeDuplicateMode === "skip") {
          skippedCount += 1;
          return;
        }

        if (employeeDuplicateMode === "add") {
          merged.push({ ...parsed, id: crypto.randomUUID() });
          addedCount += 1;
          return;
        }

        merged[matchIndex] = {
          ...merged[matchIndex],
          ...parsed,
          id: merged[matchIndex].id,
        };
        updatedCount += 1;
        return;
      }

      merged.push({ ...parsed, id: crypto.randomUUID() });
      addedCount += 1;
    });

    setCompany({ ...company, employees: merged });
    setEmployeeImportPreview(null);
    setEmployeeImportError("");
    setEmployeePage(1);

    const parts = [`${addedCount} eklendi`, `${updatedCount} güncellendi`];
    if (skippedCount) parts.push(`${skippedCount} atlandı`);
    showToast(`${parts.join(", ")}. Kaydetmeyi unutmayın.`, "success");
  };

  const tabs = [
    ["general", "Genel Bilgiler"],
    ["gib", "GİB e-Tebligat"],
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
          onClick={() => requestDeleteCompany(c.id)}
          disabled={isDeleting}
          className="shrink-0 rounded-lg bg-red-600/80 px-2.5 py-2 text-xs font-medium hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Sil
        </button>
      </div>
    );
  };

  const employeeSearchQuery = employeeSearch.trim().toLocaleLowerCase("tr");
  const filteredEmployees = (company.employees || []).filter((e) => {
    if (!employeeSearchQuery) return true;
    return [
      e.fullName,
      e.tcNo,
      e.position,
      e.department,
      e.sgkCode,
      e.phone,
      e.email,
    ]
      .join(" ")
      .toLocaleLowerCase("tr")
      .includes(employeeSearchQuery);
  });

  const employeeTotalPages = Math.max(
    1,
    Math.ceil(filteredEmployees.length / EMPLOYEE_PAGE_SIZE)
  );
  const employeeSafePage = Math.min(Math.max(employeePage, 1), employeeTotalPages);
  const pagedEmployees = filteredEmployees.slice(
    (employeeSafePage - 1) * EMPLOYEE_PAGE_SIZE,
    employeeSafePage * EMPLOYEE_PAGE_SIZE
  );

  return (
    <div className="min-h-screen bg-[#050816] p-6 text-white">
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed top-4 right-4 z-50 flex max-w-sm items-center gap-3 rounded-lg border px-4 py-3 text-sm font-medium shadow-xl backdrop-blur-sm ${
            toast.type === "success"
              ? "border-emerald-500/40 bg-emerald-950/95 text-emerald-100"
              : "border-red-500/40 bg-red-950/95 text-red-100"
          }`}
        >
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${
              toast.type === "success" ? "bg-emerald-400" : "bg-red-400"
            }`}
          />
          {toast.message}
        </div>
      )}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Kapat"
            onClick={cancelDeleteCompany}
            disabled={isDeleting}
            className="absolute inset-0 bg-black/70 backdrop-blur-sm disabled:cursor-not-allowed"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-company-title"
            className="relative w-full max-w-md rounded-2xl border border-slate-700/80 bg-slate-950 p-6 shadow-2xl shadow-indigo-500/10 ring-1 ring-white/5"
          >
            <div className="pointer-events-none absolute -inset-px rounded-2xl bg-gradient-to-b from-indigo-500/10 via-transparent to-transparent" />
            <h2
              id="delete-company-title"
              className="relative text-lg font-semibold text-white"
            >
              Firmayı Sil
            </h2>
            <p className="relative mt-3 text-sm leading-relaxed text-slate-400">
              Bu firmayı silmek istediğinize emin misiniz? Bu işlem geri alınamaz.
            </p>
            <div className="relative mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={cancelDeleteCompany}
                disabled={isDeleting}
                className="rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={confirmDeleteCompany}
                disabled={isDeleting}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isDeleting ? "Siliniyor..." : "Firmayı Sil"}
              </button>
            </div>
          </div>
        </div>
      )}
      {newCompanyModalOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Kapat"
            onClick={cancelNewCompanyModal}
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-company-title"
            className="relative z-[10000] w-full max-w-lg rounded-2xl border border-slate-700/80 bg-slate-950 p-6 shadow-2xl shadow-indigo-500/10 ring-1 ring-white/5"
          >
            <div className="pointer-events-none absolute -inset-px rounded-2xl bg-gradient-to-b from-indigo-500/10 via-transparent to-transparent" />
            <h2
              id="new-company-title"
              className="relative text-lg font-semibold text-white"
            >
              Yeni Firma
            </h2>
            <p className="relative mt-2 text-sm text-slate-400">
              Temel bilgileri girin; detayları kaydettikten sonra düzenleyebilirsiniz.
            </p>
            <div className="relative mt-5 space-y-4">
              <Input
                label="Firma Adı"
                value={newCompanyDraft.companyName}
                onChange={(value) =>
                  setNewCompanyDraft((current) => ({
                    ...current,
                    companyName: value,
                  }))
                }
              />
              <Input
                label="Vergi No"
                value={newCompanyDraft.taxNumber}
                onChange={(value) =>
                  setNewCompanyDraft((current) => ({
                    ...current,
                    taxNumber: value,
                  }))
                }
              />
              <Input
                label="Vergi Dairesi"
                value={newCompanyDraft.taxOffice}
                onChange={(value) =>
                  setNewCompanyDraft((current) => ({
                    ...current,
                    taxOffice: value,
                  }))
                }
              />
            </div>
            <div className="relative mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={cancelNewCompanyModal}
                className="rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800"
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={confirmNewCompany}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
              >
                Oluştur
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="mx-auto max-w-screen-2xl space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="mb-4 flex flex-wrap gap-3">
              <Link
                href="/muhasebe"
                className="inline-flex items-center rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-700"
              >
                ← Muhasebe Paneline Dön
              </Link>
              <Link
                href="/ofis-takip"
                className="inline-flex items-center rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-700"
              >
                Ofis Takip
              </Link>
              <Link
                href="/dashboard"
                className="inline-flex items-center rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-700"
              >
                Dashboard
              </Link>
            </div>

            <h1 className="text-3xl font-bold">
              Firma Yönetim Merkezi v2.5
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
          <aside className="rounded-xl border border-slate-800 bg-slate-900 p-4 lg:w-full">
            <h2 className="mb-3 shrink-0 font-semibold">Firmalar</h2>

            <input
              type="text"
              value={companySearchQuery}
              onChange={(e) => setCompanySearchQuery(e.target.value)}
              placeholder="Firma ara..."
              className="mb-3 w-full shrink-0 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm outline-none placeholder:text-slate-500 focus:border-indigo-500"
            />

            <div className="space-y-2 pr-1">
              {!isLoaded ? (
                <p className="px-1 py-2 text-sm text-slate-400">
                  Firmalar yükleniyor...
                </p>
              ) : activeCompanies.length === 0 && passiveCompanies.length === 0 ? (
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

          <main className="min-w-0 overflow-hidden rounded-xl border border-slate-800 bg-slate-900 p-4 lg:p-6">
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

            {activeTab === "gib" && (
              <GibCredentialsSection
                companyId={company.id}
                companyName={company.companyName}
                onNotify={showToast}
              />
            )}

            {activeTab === "general" && (
              <div className="space-y-6">
                <div className="rounded-lg border-2 border-indigo-400 bg-indigo-600/20 px-4 py-3 text-center text-base font-bold tracking-wide text-indigo-100">
                  İLETİŞİM FORMU AKTİF
                </div>

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

                  <Input
                    label="Yetkili Kişi"
                    value={company.contactPerson || ""}
                    onChange={(v) => updateField("contactPerson", v)}
                  />

                  <Input
                    label="Telefon"
                    value={company.contactPhone || ""}
                    onChange={(v) => updateField("contactPhone", v)}
                  />

                  <Input
                    label="WhatsApp"
                    value={company.whatsappPhone || ""}
                    onChange={(v) => updateField("whatsappPhone", v)}
                  />

                  <Input
                    label="E-posta"
                    value={company.contactEmail || ""}
                    onChange={(v) => updateField("contactEmail", v)}
                  />

                  <Textarea
                    label="Adres"
                    value={company.address || ""}
                    onChange={(v) => updateField("address", v)}
                    className="md:col-span-2 xl:col-span-3"
                  />

                  <Textarea
                    label="Firma Notu"
                    value={company.notes || ""}
                    onChange={(v) => updateField("notes", v)}
                    className="md:col-span-2 xl:col-span-3"
                  />
                </div>

                <CollapsibleSection
                  title="İletişim Kişileri"
                  count={sortedContacts.length}
                  open={contactsSectionOpen}
                  onToggle={() => setContactsSectionOpen((value) => !value)}
                  onAdd={openNewContactForm}
                  addLabel="+ İletişim Kişisi Ekle"
                >
                  <div className="space-y-3">
                    {sortedContacts.length === 0 ? (
                      <EmptyListMessage text="Henüz iletişim kişisi eklenmedi." />
                    ) : (
                      sortedContacts.map((contact) => (
                        <CompactListItem
                          key={contact.id}
                          onEdit={() => openEditContactForm(contact)}
                          onDelete={() => removeContact(contact.id)}
                          detailsOpen={!!expandedContactDetails[contact.id]}
                          onToggleDetails={() => toggleContactDetails(contact.id)}
                          primary={
                            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                              <ListField
                                label="Ad Soyad"
                                value={
                                  contact.isDefault
                                    ? `${contact.name} (Varsayılan)`
                                    : contact.name
                                }
                              />
                              <ListField label="Görev / Ünvan" value={contact.title} />
                              <ListField label="Telefon" value={contact.phone} />
                              <ListField
                                label="WhatsApp"
                                value={contact.whatsapp || contact.phone}
                              />
                            </div>
                          }
                          secondary={
                            <InfoRow>
                              <InfoItem label="E-posta" value={contact.email} wrap />
                              <InfoItem label="Not" value={contact.note} wrap />
                              <InfoItem
                                label="Varsayılan"
                                value={contact.isDefault ? "Evet" : "Hayır"}
                                active={contact.isDefault}
                              />
                            </InfoRow>
                          }
                        />
                      ))
                    )}
                  </div>

                  {contactFormDraft && (
                    <FormPanel
                      title={
                        contactFormMode === "new"
                          ? "Yeni İletişim Kişisi"
                          : "İletişim Kişisini Düzenle"
                      }
                      onSave={saveContactForm}
                      onCancel={cancelContactForm}
                    >
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                        <Input
                          label="Ad Soyad"
                          value={contactFormDraft.name}
                          onChange={(v) => updateContactFormDraft("name", v)}
                        />
                        <Input
                          label="Görev / Ünvan"
                          value={contactFormDraft.title}
                          onChange={(v) => updateContactFormDraft("title", v)}
                        />
                        <Input
                          label="Telefon"
                          value={contactFormDraft.phone}
                          onChange={(v) => updateContactFormDraft("phone", v)}
                        />
                        <Input
                          label="WhatsApp"
                          value={contactFormDraft.whatsapp}
                          onChange={(v) => updateContactFormDraft("whatsapp", v)}
                          hint="Boş bırakılırsa telefon kullanılır"
                        />
                        <Input
                          label="E-posta"
                          value={contactFormDraft.email}
                          onChange={(v) => updateContactFormDraft("email", v)}
                          type="email"
                        />
                        <Checkbox
                          label="Varsayılan kişi"
                          checked={contactFormDraft.isDefault}
                          onChange={(v) => updateContactFormDraft("isDefault", v)}
                        />
                        <Textarea
                          label="Not"
                          value={contactFormDraft.note}
                          onChange={(v) => updateContactFormDraft("note", v)}
                          className="md:col-span-2 xl:col-span-3"
                        />
                      </div>
                    </FormPanel>
                  )}
                </CollapsibleSection>
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
              <div className="space-y-4">
                <button
                  type="button"
                  onClick={openNewDocumentSeriesForm}
                  className="rounded-lg bg-emerald-600 px-4 py-2 hover:bg-emerald-700"
                >
                  + Yeni Belge Serisi
                </button>

                {(company.documentSeriesRules || []).length === 0 &&
                documentSeriesEditId !== "new" ? (
                  <EmptyListMessage text="Henüz belge serisi eklenmedi." />
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-slate-700/80 bg-slate-950/40">
                    <table className="min-w-[720px] w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-400">
                          <th className="px-4 py-3 font-semibold">Seri Ön Eki</th>
                          <th className="px-4 py-3 font-semibold">Belge Türü</th>
                          <th className="px-4 py-3 font-semibold">Açıklama</th>
                          <th className="px-4 py-3 font-semibold text-right">
                            İşlemler
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {documentSeriesEditId === "new" &&
                        documentSeriesFormDraft ? (
                          <>
                            <tr className="border-b border-slate-800/80 bg-slate-900/40">
                              <td className="px-4 py-3 font-medium text-slate-100">
                                Yeni kayıt
                              </td>
                              <td className="px-4 py-3 text-slate-400">—</td>
                              <td className="px-4 py-3 text-slate-400">—</td>
                              <td className="px-4 py-3" />
                            </tr>
                            <DocumentSeriesEditRow
                              title="Yeni Belge Serisi"
                              draft={documentSeriesFormDraft}
                              onFieldChange={updateDocumentSeriesFormDraft}
                              onSave={saveDocumentSeriesForm}
                              onCancel={cancelDocumentSeriesForm}
                              documentTypeOptions={documentTypeOptions}
                            />
                          </>
                        ) : null}

                        {(company.documentSeriesRules || []).map((rule) => (
                          <React.Fragment key={rule.id}>
                            <tr className="border-b border-slate-800/80 transition-colors hover:bg-slate-900/40">
                              <td className="px-4 py-3 font-medium text-slate-100">
                                {rule.prefix || "—"}
                              </td>
                              <td className="px-4 py-3 text-slate-300">
                                {labelText(rule.documentType)}
                              </td>
                              <td className="px-4 py-3 text-slate-300">
                                {rule.description || "—"}
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex flex-wrap justify-end gap-2">
                                  <EditButton
                                    onClick={() => openEditDocumentSeriesForm(rule)}
                                  />
                                  <DeleteButton
                                    onClick={() => removeDocumentSeriesRule(rule.id)}
                                  />
                                </div>
                              </td>
                            </tr>

                            {documentSeriesEditId === rule.id &&
                            documentSeriesFormDraft ? (
                              <DocumentSeriesEditRow
                                title="Belge Serisini Düzenle"
                                draft={documentSeriesFormDraft}
                                onFieldChange={updateDocumentSeriesFormDraft}
                                onSave={saveDocumentSeriesForm}
                                onCancel={cancelDocumentSeriesForm}
                                documentTypeOptions={documentTypeOptions}
                              />
                            ) : null}
                          </React.Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
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
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={addEmployee}
                    className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium hover:bg-emerald-700"
                  >
                    + Personel Ekle
                  </button>

                  <button
                    onClick={downloadEmployeeTemplate}
                    className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-medium hover:bg-slate-600"
                  >
                    Excel Şablonu İndir
                  </button>

                  <label className="cursor-pointer rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium hover:bg-indigo-500">
                    Excel Yükle
                    <input
                      type="file"
                      accept=".xlsx,.xls"
                      className="hidden"
                      onChange={handleEmployeeExcelUpload}
                    />
                  </label>

                  <button
                    onClick={clearAllEmployees}
                    disabled={!(company.employees || []).length}
                    className="rounded-lg bg-red-600/90 px-4 py-2 text-sm font-medium hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Tümünü Temizle
                  </button>

                  <span className="ml-auto text-sm text-slate-400">
                    Toplam: {(company.employees || []).length} personel
                  </span>
                </div>

                {employeeImportError && (
                  <div className="rounded-lg border border-red-700/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">
                    {employeeImportError}
                  </div>
                )}

                {employeeImportPreview && (
                  <div className="space-y-3 rounded-xl border border-indigo-700/50 bg-slate-950 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <h4 className="text-base font-semibold text-slate-100">
                        Ön İzleme — {employeeImportPreview.length} satır
                      </h4>

                      <label className="flex items-center gap-2 text-sm text-slate-300">
                        Aynı TC No olursa:
                        <select
                          value={employeeDuplicateMode}
                          onChange={(ev) =>
                            setEmployeeDuplicateMode(ev.target.value)
                          }
                          className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 outline-none focus:border-indigo-500"
                        >
                          <option value="update">Güncelle</option>
                          <option value="add">Yeni Kayıt Olarak Ekle</option>
                          <option value="skip">Atla</option>
                        </select>
                      </label>
                    </div>

                    <div className="max-h-80 overflow-auto rounded-lg border border-slate-800">
                      <table className="w-full text-left text-sm">
                        <thead className="sticky top-0 bg-slate-900 text-xs uppercase text-slate-400">
                          <tr>
                            <th className="px-3 py-2">Ad Soyad</th>
                            <th className="px-3 py-2">TC No</th>
                            <th className="px-3 py-2">Görev</th>
                            <th className="px-3 py-2">Departman</th>
                            <th className="px-3 py-2">İşe Giriş</th>
                            <th className="px-3 py-2">SGK Kodu</th>
                            <th className="px-3 py-2">Maaş Hs.</th>
                            <th className="px-3 py-2">Avans Hs.</th>
                            <th className="px-3 py-2">Durum</th>
                          </tr>
                        </thead>
                        <tbody>
                          {employeeImportPreview.map((row, index) => {
                            const isDuplicate =
                              (row.tcNo || "").trim() &&
                              (company.employees || []).some(
                                (e) =>
                                  (e.tcNo || "").trim() ===
                                  (row.tcNo || "").trim()
                              );
                            return (
                              <tr
                                key={`${row.tcNo || "row"}-${index}`}
                                className="border-t border-slate-800"
                              >
                                <td className="px-3 py-2">{row.fullName}</td>
                                <td className="px-3 py-2">
                                  <span className="flex items-center gap-2">
                                    {row.tcNo}
                                    {isDuplicate && (
                                      <span className="rounded bg-amber-600/30 px-1.5 py-0.5 text-xs text-amber-300">
                                        mevcut
                                      </span>
                                    )}
                                  </span>
                                </td>
                                <td className="px-3 py-2">{row.position}</td>
                                <td className="px-3 py-2">{row.department}</td>
                                <td className="px-3 py-2">{row.hireDate}</td>
                                <td className="px-3 py-2">{row.sgkCode}</td>
                                <td className="px-3 py-2">
                                  {row.salaryAccountCode}
                                </td>
                                <td className="px-3 py-2">
                                  {row.advanceAccountCode}
                                </td>
                                <td className="px-3 py-2">
                                  {row.isActive ? "Aktif" : "Pasif"}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={confirmEmployeeImport}
                        className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium hover:bg-emerald-700"
                      >
                        Kaydet
                      </button>
                      <button
                        onClick={cancelEmployeeImport}
                        className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-medium hover:bg-slate-600"
                      >
                        İptal
                      </button>
                    </div>
                  </div>
                )}

                <input
                  type="text"
                  value={employeeSearch}
                  onChange={(ev) => {
                    setEmployeeSearch(ev.target.value);
                    setEmployeePage(1);
                  }}
                  placeholder="Personel ara (ad, TC, görev, departman...)"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm outline-none focus:border-indigo-500"
                />

                {!filteredEmployees.length ? (
                  <EmptyListMessage
                    text={
                      (company.employees || []).length
                        ? "Aramanıza uygun personel bulunamadı."
                        : "Henüz personel eklenmemiş. Personel ekleyin veya Excel yükleyin."
                    }
                  />
                ) : (
                  <div className="space-y-4">
                    {pagedEmployees.map((e) => (
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
                          label="Telefon"
                          value={e.phone}
                          onChange={(x) => updateEmployee(e.id, "phone", x)}
                        />

                        <Input
                          label="E-posta"
                          value={e.email}
                          onChange={(x) => updateEmployee(e.id, "email", x)}
                        />

                        <Input
                          label="Görev"
                          value={e.position}
                          onChange={(x) => updateEmployee(e.id, "position", x)}
                        />

                        <Input
                          label="Departman"
                          value={e.department}
                          onChange={(x) => updateEmployee(e.id, "department", x)}
                        />

                        <Input
                          label="İşe Giriş Tarihi"
                          value={e.hireDate}
                          onChange={(x) => updateEmployee(e.id, "hireDate", x)}
                          hint="GG.AA.YYYY"
                        />

                        <Input
                          label="SGK Meslek Kodu"
                          value={e.sgkCode}
                          onChange={(x) => updateEmployee(e.id, "sgkCode", x)}
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

                    {employeeTotalPages > 1 && (
                      <div className="flex items-center justify-between gap-3 pt-2">
                        <span className="text-sm text-slate-400">
                          {filteredEmployees.length} kayıt • Sayfa{" "}
                          {employeeSafePage}/{employeeTotalPages}
                        </span>
                        <div className="flex gap-2">
                          <button
                            onClick={() =>
                              setEmployeePage((p) => Math.max(1, p - 1))
                            }
                            disabled={employeeSafePage <= 1}
                            className="rounded-lg bg-slate-700 px-3 py-1.5 text-sm hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Önceki
                          </button>
                          <button
                            onClick={() =>
                              setEmployeePage((p) =>
                                Math.min(employeeTotalPages, p + 1)
                              )
                            }
                            disabled={employeeSafePage >= employeeTotalPages}
                            className="rounded-lg bg-slate-700 px-3 py-1.5 text-sm hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Sonraki
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
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
                type="button"
                onClick={saveCompany}
                disabled={isSaving}
                className="rounded-lg bg-indigo-600 px-6 py-3 font-semibold hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSaving ? "Kaydediliyor..." : "Kaydet"}
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

  function WelcomeScreen() {
    return (
      <div className="flex min-h-[360px] flex-col items-center justify-center overflow-hidden px-6 py-16 text-center">
        <div className="relative mb-6">
          <div className="absolute -inset-8 -z-10 rounded-full bg-indigo-500/10 blur-3xl" />
          <div className="absolute -inset-4 -z-10 rounded-full bg-violet-500/5 blur-2xl" />
          <AnnveroLogo onLight={false} size={52} />
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

  function Textarea({ label, value, onChange, className = "" }) {
    return (
      <label className={`block ${className}`}>
        <div className="mb-1 text-sm text-slate-400">{label}</div>

        <textarea
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          className="min-h-24 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 outline-none focus:border-indigo-500"
        />
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

  function DocumentSeriesEditRow({
    title,
    draft,
    onFieldChange,
    onSave,
    onCancel,
    documentTypeOptions,
  }) {
    return (
      <tr>
        <td colSpan={4} className="border-b border-slate-800 bg-slate-950 p-4">
          <div className="rounded-xl border border-indigo-700/50 bg-slate-950 p-4">
            <h4 className="mb-4 text-base font-semibold text-slate-100">
              {title}
            </h4>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <Input
                label="Seri Ön Eki"
                value={draft.prefix}
                onChange={(v) => onFieldChange("prefix", v)}
              />
              <Select
                label="Belge Türü"
                value={draft.documentType}
                onChange={(v) => onFieldChange("documentType", v)}
                options={documentTypeOptions}
              />
              <Input
                label="Açıklama"
                value={draft.description}
                onChange={(v) => onFieldChange("description", v)}
              />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onSave}
                className="rounded-lg bg-indigo-600 px-4 py-2 font-semibold hover:bg-indigo-700"
              >
                Kaydet
              </button>
              <button
                type="button"
                onClick={onCancel}
                className="rounded-lg bg-slate-700 px-4 py-2 hover:bg-slate-600"
              >
                İptal
              </button>
            </div>
          </div>
        </td>
      </tr>
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
