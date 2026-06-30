"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useCompanyList } from "@/app/muhasebe/hooks/useCompanyList";
import { getCompanyDisplayName } from "@/src/utils/companies";
import { OFIS_TAKIP_TABS, ONCELIK_OPTIONS } from "@/src/ofis-takip/constants";
import {
  filterCompaniesForSearch,
  formatContactValue,
  getActiveCompanies,
  getCompanyContactSummary,
  getCompanyName,
  getCompanyWhatsAppPhone,
  migrateOfisTakipToCompanies,
  resolveCompanyId,
  resolveContactWhatsApp,
} from "@/src/ofis-takip/companyBridge";
import { createDefaultOfisTakipState, createId } from "@/src/ofis-takip/defaultState";
import RemindersTab from "./RemindersTab";
import {
  buildReminderDisplayRows,
} from "@/src/ofis-takip/reminderUtils";
import {
  downloadTaxCalendarTemplate,
  parseTaxCalendarExcelBuffer,
} from "@/src/ofis-takip/taxCalendarExcel";
import {
  daysUntil,
  formatTrDate,
  formatTrDateInputValue,
  isDueSoon,
  isOverdue,
  normalizeTrDateInput,
  parseTrDate,
} from "@/src/ofis-takip/dateUtils";
import {
  exportAnnveroCompaniesToExcel,
} from "@/src/ofis-takip/excel";
import { loadOfisTakipState, saveOfisTakipState } from "@/src/ofis-takip/storage";
import {
  applyWhatsAppTemplate,
  buildWhatsAppLink,
} from "@/src/ofis-takip/whatsapp";
import AnnveroModuleNav from "@/app/components/AnnveroModuleNav";

const inputClass =
  "w-full rounded-xl border border-gray-700 bg-gray-950 px-4 py-2.5 text-white outline-none focus:border-violet-500";
const buttonPrimary =
  "rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-500";
const buttonSecondary =
  "rounded-xl border border-gray-700 bg-gray-950 px-4 py-2.5 text-sm font-semibold text-gray-200 transition hover:border-gray-500";
const cardClass = "rounded-2xl border border-gray-800 bg-gray-900 p-6";

function CompanySelectOptions({ companies, value, onChange, includeGeneral = true }) {
  return (
    <select className={inputClass} value={value} onChange={onChange}>
      {includeGeneral ? <option value="">Genel / Firma seç</option> : (
        <option value="">Firma seç</option>
      )}
      {companies.map((company) => (
        <option key={company.id} value={company.id}>
          {getCompanyDisplayName(company)}
        </option>
      ))}
    </select>
  );
}

function StatCard({ label, value, tone = "default" }) {
  const tones = {
    default: "text-white",
    warning: "text-amber-300",
    success: "text-emerald-300",
    danger: "text-red-300",
  };

  return (
    <div className={`${cardClass} min-w-[160px] flex-1`}>
      <p className="text-sm text-gray-400">{label}</p>
      <p className={`mt-2 text-3xl font-bold ${tones[tone] || tones.default}`}>
        {value}
      </p>
    </div>
  );
}

export default function OfisTakipApp() {
  const [data, setData] = useState(createDefaultOfisTakipState);
  const [loaded, setLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [search, setSearch] = useState("");
  const [expandedCompanyId, setExpandedCompanyId] = useState(null);
  const jsonInputRef = useRef(null);
  const taxExcelInputRef = useRef(null);

  const {
    companies,
    refreshCompanies,
    isLoading: isCompaniesLoading,
  } = useCompanyList();

  const [taskForm, setTaskForm] = useState({
    baslik: "",
    aciklama: "",
    sonTarih: "",
    oncelik: "normal",
    companyId: "",
  });
  const [taxForm, setTaxForm] = useState({
    baslik: "",
    tur: "",
    sonTarih: "",
    aciklama: "",
    companyId: "",
  });

  useEffect(() => {
    setData(loadOfisTakipState());
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    saveOfisTakipState(data);
  }, [data, loaded]);

  useEffect(() => {
    if (!loaded || isCompaniesLoading) {
      return;
    }

    setData((current) => {
      if (current._migrationApplied) {
        return current;
      }

      return migrateOfisTakipToCompanies(current, companies);
    });
  }, [loaded, isCompaniesLoading, companies]);

  const activeCompanies = useMemo(
    () => getActiveCompanies(companies),
    [companies]
  );

  const filteredCompanies = useMemo(
    () => filterCompaniesForSearch(companies, search),
    [companies, search]
  );

  const openTasks = useMemo(
    () => data.yapilacaklar.filter((task) => !task.tamamlandi),
    [data.yapilacaklar]
  );

  const completedTasks = useMemo(
    () =>
      data.yapilacaklar
        .filter((task) => task.tamamlandi)
        .sort(
          (left, right) =>
            new Date(right.completedAt || 0).getTime() -
            new Date(left.completedAt || 0).getTime()
        ),
    [data.yapilacaklar]
  );

  const upcomingTaxItems = useMemo(
    () =>
      [...data.vergiTakvimi]
        .filter((item) => !item.tamamlandi)
        .sort(
          (left, right) =>
            (parseTrDate(left.sonTarih)?.getTime() || 0) -
            (parseTrDate(right.sonTarih)?.getTime() || 0)
        ),
    [data.vergiTakvimi]
  );

  const reminderDisplayRows = useMemo(
    () =>
      buildReminderDisplayRows({
        hatirlatmalar: data.hatirlatmalar,
        vergiTakvimi: data.vergiTakvimi,
        companies,
        reminderDaysBefore: data.settings.reminderDaysBefore,
      }),
    [companies, data.hatirlatmalar, data.settings.reminderDaysBefore, data.vergiTakvimi]
  );

  const stats = useMemo(() => {
    const overdueTasks = openTasks.filter((task) => isOverdue(task.sonTarih)).length;
    const dueSoonTasks = openTasks.filter((task) =>
      isDueSoon(task.sonTarih, data.settings.reminderDaysBefore)
    ).length;
    const overdueTax = upcomingTaxItems.filter((item) =>
      isOverdue(item.sonTarih)
    ).length;

    return {
      companyCount: activeCompanies.length,
      openTaskCount: openTasks.length,
      completedTaskCount: completedTasks.length,
      overdueTasks,
      dueSoonTasks,
      overdueTax,
      activeReminders: reminderDisplayRows.length,
    };
  }, [activeCompanies.length, completedTasks.length, data, openTasks, reminderDisplayRows.length, upcomingTaxItems]);

  const patchSettings = (partial) => {
    setData((current) => ({
      ...current,
      settings: { ...current.settings, ...partial },
    }));
  };

  const addTask = () => {
    if (!taskForm.baslik.trim()) {
      alert("Görev başlığı girin.");
      return;
    }

    setData((current) => ({
      ...current,
      yapilacaklar: [
        ...current.yapilacaklar,
        {
          id: createId(),
          ...taskForm,
          baslik: taskForm.baslik.trim(),
          tamamlandi: false,
          createdAt: new Date().toISOString(),
          completedAt: "",
        },
      ],
    }));

    setTaskForm({
      baslik: "",
      aciklama: "",
      sonTarih: "",
      oncelik: "normal",
      companyId: "",
    });
  };

  const toggleTask = (id) => {
    setData((current) => ({
      ...current,
      yapilacaklar: current.yapilacaklar.map((task) =>
        task.id === id
          ? {
              ...task,
              tamamlandi: !task.tamamlandi,
              completedAt: !task.tamamlandi ? new Date().toISOString() : "",
            }
          : task
      ),
    }));
  };

  const removeTask = (id) => {
    setData((current) => ({
      ...current,
      yapilacaklar: current.yapilacaklar.filter((task) => task.id !== id),
    }));
  };

  const handleAddReminders = (entries) => {
    setData((current) => ({
      ...current,
      hatirlatmalar: [...current.hatirlatmalar, ...entries],
    }));
  };

  const removeReminder = (id) => {
    setData((current) => ({
      ...current,
      hatirlatmalar: current.hatirlatmalar.filter((item) => item.id !== id),
    }));
  };

  const addTaxItem = () => {
    const normalizedDate = normalizeTrDateInput(taxForm.sonTarih);

    if (!taxForm.baslik.trim() || !normalizedDate) {
      alert("Vergi kalemi başlığı ve geçerli son tarih girin.");
      return;
    }

    setData((current) => ({
      ...current,
      vergiTakvimi: [
        ...current.vergiTakvimi,
        {
          id: createId(),
          ...taxForm,
          baslik: taxForm.baslik.trim(),
          sonTarih: normalizedDate,
          tamamlandi: false,
        },
      ],
    }));

    setTaxForm({
      baslik: "",
      tur: "",
      sonTarih: "",
      aciklama: "",
      companyId: "",
    });
  };

  const toggleTaxItem = (id) => {
    setData((current) => ({
      ...current,
      vergiTakvimi: current.vergiTakvimi.map((item) =>
        item.id === id ? { ...item, tamamlandi: !item.tamamlandi } : item
      ),
    }));
  };

  const handleTaxExcelUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const buffer = await file.arrayBuffer();
      const imported = parseTaxCalendarExcelBuffer(buffer);

      if (imported.length === 0) {
        alert("Excel dosyasında geçerli vergi takvimi kaydı bulunamadı.");
        event.target.value = "";
        return;
      }

      setData((current) => ({
        ...current,
        vergiTakvimi: [...current.vergiTakvimi, ...imported],
      }));

      alert(`${imported.length} vergi takvimi kaydı eklendi.`);
    } catch {
      alert("Excel dosyası okunamadı.");
    }

    event.target.value = "";
  };

  const removeTaxItem = (id) => {
    setData((current) => ({
      ...current,
      vergiTakvimi: current.vergiTakvimi.filter((item) => item.id !== id),
    }));
  };

  const buildReminderMessage = (title, date, companyId) => {
    const companyName = getCompanyName(companies, companyId);

    return applyWhatsAppTemplate(data.settings.whatsappTemplate, {
      mukellef: companyName,
      unvan: companyName,
      konu: title,
      tarih: date,
    });
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "ofis_takip_yedek.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importJson = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      setData(
        migrateOfisTakipToCompanies(
          {
            ...createDefaultOfisTakipState(),
            ...parsed,
            settings: {
              ...createDefaultOfisTakipState().settings,
              ...(parsed.settings || {}),
            },
            _legacyMukellefler: parsed.mukellefler || [],
          },
          companies
        )
      );
      alert("JSON yedek başarıyla içe aktarıldı.");
    } catch {
      alert("JSON dosyası okunamadı.");
    }

    event.target.value = "";
  };

  const resetData = () => {
    if (!window.confirm("Tüm Ofis Takip verileri sıfırlansın mı?")) return;
    setData(createDefaultOfisTakipState());
  };

  const renderEmailLink = (email) => {
    const value = String(email || "").trim();

    if (!value) {
      return <span className="text-gray-500">—</span>;
    }

    return (
      <a href={`mailto:${value}`} className="text-violet-300 hover:underline">
        {value}
      </a>
    );
  };

  const renderMailButton = (email, subject, body) => {
    const value = String(email || "").trim();

    if (!value) {
      return (
        <span className="rounded-lg border border-gray-800 px-2 py-1 text-[11px] text-gray-500">
          Mail yok
        </span>
      );
    }

    const href = `mailto:${value}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    return (
      <a
        href={href}
        className={`${buttonSecondary} inline-flex px-3 py-1.5 text-xs`}
      >
        Mail Gönder
      </a>
    );
  };

  const renderWhatsAppSendButton = (companyId, title, date, contactId = "") => {
    const phone = getCompanyWhatsAppPhone(companies, companyId, contactId);
    const message = buildReminderMessage(title, date, companyId);
    const href = buildWhatsAppLink(phone, message);

    if (!href) {
      return (
        <span className="text-[11px] text-gray-500">Telefon yok</span>
      );
    }

    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="inline-flex rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
      >
        WhatsApp Gönder
      </a>
    );
  };

  const renderWhatsAppButton = (companyId, title, date, contactId = "") => {
    const phone = getCompanyWhatsAppPhone(companies, companyId, contactId);
    const message = buildReminderMessage(title, date, companyId);
    const href = buildWhatsAppLink(phone, message);

    if (!href) {
      return (
        <span className="text-xs text-gray-500">Telefon yok</span>
      );
    }

    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="inline-flex rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
      >
        WhatsApp
      </a>
    );
  };

  const renderDashboard = () => (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-4">
        <StatCard label="Aktif Firma" value={stats.companyCount} />
        <StatCard label="Açık Görev" value={stats.openTaskCount} tone="warning" />
        <StatCard label="Tamamlanan Görev" value={stats.completedTaskCount} tone="success" />
        <StatCard label="Yaklaşan / Geciken Vergi" value={stats.overdueTax} tone="danger" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className={cardClass}>
          <h3 className="text-lg font-semibold">Yaklaşan Görevler</h3>
          <div className="mt-4 space-y-3">
            {openTasks.slice(0, 8).map((task) => (
              <div
                key={task.id}
                className="rounded-xl border border-gray-800 bg-gray-950 px-4 py-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{task.baslik}</p>
                    <p className="mt-1 text-sm text-gray-400">
                      {getCompanyName(companies, resolveCompanyId(task))} ·{" "}
                      {task.sonTarih || "Tarih yok"}
                    </p>
                  </div>
                  {renderWhatsAppButton(resolveCompanyId(task), task.baslik, task.sonTarih)}
                </div>
              </div>
            ))}
            {openTasks.length === 0 && (
              <p className="text-sm text-gray-500">Açık görev yok.</p>
            )}
          </div>
        </div>

        <div className={cardClass}>
          <h3 className="text-lg font-semibold">Vergi Takvimi</h3>
          <div className="mt-4 space-y-3">
            {upcomingTaxItems.slice(0, 8).map((item) => (
              <div
                key={item.id}
                className="rounded-xl border border-gray-800 bg-gray-950 px-4 py-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{item.baslik}</p>
                    <p className="mt-1 text-sm text-gray-400">
                      {item.tur || "Genel"} · {item.sonTarih}
                      {daysUntil(item.sonTarih) !== null
                        ? ` · ${daysUntil(item.sonTarih)} gün`
                        : ""}
                    </p>
                  </div>
                  {renderWhatsAppButton(resolveCompanyId(item), item.baslik, item.sonTarih)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  const toggleCompanyDetail = (companyId) => {
    setExpandedCompanyId((current) => (current === companyId ? null : companyId));
  };

  const renderMukellefler = () => (
    <div className="space-y-6">
      <div className={`${cardClass} flex flex-wrap items-center gap-3`}>
        <Link href="/muhasebe/firma-yonetimi" className={buttonPrimary}>
          Firma Yönetimi&apos;ne Git
        </Link>
        <button
          type="button"
          onClick={() => exportAnnveroCompaniesToExcel(companies)}
          className={buttonSecondary}
          disabled={companies.length === 0}
        >
          Firmaları Excel&apos;e Aktar
        </button>
        <button type="button" onClick={refreshCompanies} className={buttonSecondary}>
          Listeyi Yenile
        </button>
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Firma ara..."
          className={`${inputClass} max-w-xs`}
        />
        {isCompaniesLoading ? (
          <span className="text-sm text-gray-400">Firmalar yükleniyor...</span>
        ) : null}
      </div>

      <div className="rounded-2xl border border-violet-900/40 bg-violet-950/20 px-5 py-4 text-sm text-violet-100">
        Firma listesi ANNVERO Firma Yönetimi ile ortaktır. Yeni firma eklemek için{" "}
        <Link href="/muhasebe/firma-yonetimi" className="font-semibold underline">
          Firma Yönetimi
        </Link>{" "}
        sayfasını kullanın.
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {filteredCompanies.map((company) => {
          const summary = getCompanyContactSummary(company);
          const isExpanded = expandedCompanyId === company.id;
          const contactPeople =
            summary.contactPeople.length > 0
              ? summary.contactPeople
              : summary.contactPerson ||
                  summary.phone ||
                  summary.email ||
                  summary.whatsappPhone
                ? [
                    {
                      id: "legacy",
                      name: summary.contactPerson || "Yetkili",
                      title: "",
                      phone: summary.phone,
                      whatsapp: summary.whatsappPhone,
                      email: summary.email,
                      isDefault: true,
                    },
                  ]
                : [];
          const messageTitle = "Ofis hatırlatması";
          const messageDate = formatTrDate(new Date());
          const mailSubject = `${summary.name} - ${messageTitle}`;
          const mailBody = buildReminderMessage(messageTitle, messageDate, company.id);

          return (
            <div
              key={company.id}
              className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900"
            >
              <div className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-semibold text-white">
                    {summary.name}
                  </h3>
                  <p className="mt-0.5 text-xs text-gray-400">
                    VKN/TCKN: {summary.taxNumber || "—"}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => toggleCompanyDetail(company.id)}
                  aria-expanded={isExpanded}
                  aria-label={isExpanded ? "Detayı kapat" : "Detayı aç"}
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-lg font-bold leading-none transition ${
                    isExpanded
                      ? "border-violet-500 bg-violet-950/60 text-violet-200"
                      : "border-gray-700 bg-gray-950 text-gray-300 hover:border-violet-500 hover:text-white"
                  }`}
                >
                  {isExpanded ? "−" : "+"}
                </button>
              </div>

              {isExpanded ? (
                <div className="space-y-3 border-t border-gray-800 px-4 py-3 text-sm">
                  <p className="text-gray-300">
                    <span className="text-gray-500">Vergi Dairesi:</span>{" "}
                    {summary.taxOffice || "—"}
                  </p>

                  {contactPeople.length === 0 ? (
                    <p className="text-xs text-gray-500">
                      İletişim kişisi tanımlı değil.
                    </p>
                  ) : (
                    contactPeople.map((contact) => (
                      <div
                        key={contact.id}
                        className="rounded-lg border border-gray-800 bg-gray-950 px-3 py-2.5"
                      >
                        <p className="font-medium text-gray-200">
                          {contact.name || "İletişim Kişisi"}
                          {contact.isDefault ? (
                            <span className="ml-1 text-xs text-violet-300">
                              · Varsayılan
                            </span>
                          ) : null}
                        </p>
                        {contact.title ? (
                          <p className="mt-0.5 text-xs text-gray-500">{contact.title}</p>
                        ) : null}
                        <div className="mt-2 space-y-1 text-xs text-gray-400">
                          <p>
                            <span className="text-gray-500">Telefon:</span>{" "}
                            {formatContactValue(contact.phone)}
                          </p>
                          <p>
                            <span className="text-gray-500">WhatsApp:</span>{" "}
                            {formatContactValue(resolveContactWhatsApp(contact))}
                          </p>
                          <p className="flex flex-wrap items-center gap-1">
                            <span className="text-gray-500">E-posta:</span>{" "}
                            {renderEmailLink(contact.email)}
                          </p>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {renderWhatsAppSendButton(
                            company.id,
                            messageTitle,
                            messageDate,
                            contact.id === "legacy" ? "" : contact.id
                          )}
                          {renderMailButton(contact.email, mailSubject, mailBody)}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {!isCompaniesLoading && filteredCompanies.length === 0 ? (
        <div className={`${cardClass} text-center text-sm text-gray-500`}>
          {companies.length === 0
            ? "Henüz ANNVERO'da firma yok. Firma Yönetimi'nden ekleyin."
            : "Arama kriterine uygun firma bulunamadı."}
        </div>
      ) : null}
    </div>
  );

  const renderTaskForm = () => (
    <div className={`${cardClass} grid gap-3 md:grid-cols-2 xl:grid-cols-6`}>
      <input
        className={`${inputClass} xl:col-span-2`}
        placeholder="Görev başlığı"
        value={taskForm.baslik}
        onChange={(event) =>
          setTaskForm((current) => ({ ...current, baslik: event.target.value }))
        }
      />
      <input
        className={inputClass}
        placeholder="Son tarih (gg.aa.yyyy)"
        value={taskForm.sonTarih}
        onChange={(event) =>
          setTaskForm((current) => ({ ...current, sonTarih: event.target.value }))
        }
      />
      <CompanySelectOptions
        companies={activeCompanies}
        value={taskForm.companyId}
        onChange={(event) =>
          setTaskForm((current) => ({ ...current, companyId: event.target.value }))
        }
      />
      <select
        className={inputClass}
        value={taskForm.oncelik}
        onChange={(event) =>
          setTaskForm((current) => ({ ...current, oncelik: event.target.value }))
        }
      >
        {ONCELIK_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <button type="button" onClick={addTask} className={buttonPrimary}>
        Ekle
      </button>
      <textarea
        className={`${inputClass} min-h-20 md:col-span-2 xl:col-span-6`}
        placeholder="Açıklama"
        value={taskForm.aciklama}
        onChange={(event) =>
          setTaskForm((current) => ({ ...current, aciklama: event.target.value }))
        }
      />
    </div>
  );

  const renderTaskTable = (tasks, completedView = false) => (
    <div className={`${cardClass} overflow-auto`}>
      <table className="w-full min-w-[900px] text-sm">
        <thead className="text-left text-gray-400">
          <tr>
            <th className="p-3">Görev</th>
            <th className="p-3">Firma</th>
            <th className="p-3">Son Tarih</th>
            <th className="p-3">Öncelik</th>
            <th className="p-3">İşlem</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <tr key={task.id} className="border-t border-gray-800">
              <td className="p-3">
                <p className="font-medium">{task.baslik}</p>
                {task.aciklama ? (
                  <p className="mt-1 text-gray-400">{task.aciklama}</p>
                ) : null}
              </td>
              <td className="p-3">{getCompanyName(companies, resolveCompanyId(task))}</td>
              <td className="p-3">{task.sonTarih || "—"}</td>
              <td className="p-3">{task.oncelik || "normal"}</td>
              <td className="p-3">
                <div className="flex flex-wrap gap-2">
                  {!completedView ? (
                    <button
                      type="button"
                      onClick={() => toggleTask(task.id)}
                      className={buttonSecondary}
                    >
                      Tamamla
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => toggleTask(task.id)}
                      className={buttonSecondary}
                    >
                      Geri Al
                    </button>
                  )}
                  {renderWhatsAppButton(resolveCompanyId(task), task.baslik, task.sonTarih)}
                  <button
                    type="button"
                    onClick={() => removeTask(task.id)}
                    className="rounded-lg border border-red-800 px-3 py-1.5 text-xs text-red-300"
                  >
                    Sil
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {tasks.length === 0 && (
        <p className="mt-4 text-sm text-gray-500">Kayıt bulunamadı.</p>
      )}
    </div>
  );

  const renderVergiTakvimi = () => (
    <div className="space-y-6">
      <div className={`${cardClass} flex flex-wrap items-center gap-3`}>
        <button type="button" onClick={downloadTaxCalendarTemplate} className={buttonSecondary}>
          Excel Şablon İndir
        </button>
        <label className={`${buttonSecondary} cursor-pointer`}>
          Excel Yükle
          <input
            ref={taxExcelInputRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={handleTaxExcelUpload}
            className="hidden"
          />
        </label>
        <p className="text-sm text-gray-400">
          Kolonlar: Vergi/Yükümlülük · Son Ödeme Tarihi · Açıklama/Mesaj
        </p>
      </div>

      <div className={`${cardClass} grid gap-3 md:grid-cols-2 xl:grid-cols-6`}>
        <input
          className={`${inputClass} xl:col-span-2`}
          placeholder="Başlık"
          value={taxForm.baslik}
          onChange={(event) =>
            setTaxForm((current) => ({ ...current, baslik: event.target.value }))
          }
        />
        <input
          className={inputClass}
          placeholder="Tür (KDV, Muhtasar...)"
          value={taxForm.tur}
          onChange={(event) =>
            setTaxForm((current) => ({ ...current, tur: event.target.value }))
          }
        />
        <input
          className={inputClass}
          placeholder="gg.aa.yyyy"
          value={taxForm.sonTarih}
          onChange={(event) =>
            setTaxForm((current) => ({ ...current, sonTarih: event.target.value }))
          }
          onBlur={() =>
            setTaxForm((current) => ({
              ...current,
              sonTarih: formatTrDateInputValue(current.sonTarih),
            }))
          }
        />
        <CompanySelectOptions
          companies={activeCompanies}
          value={taxForm.companyId}
          onChange={(event) =>
            setTaxForm((current) => ({ ...current, companyId: event.target.value }))
          }
        />
        <button type="button" onClick={addTaxItem} className={buttonPrimary}>
          Ekle
        </button>
        <input
          className={`${inputClass} xl:col-span-6`}
          placeholder="Açıklama"
          value={taxForm.aciklama}
          onChange={(event) =>
            setTaxForm((current) => ({ ...current, aciklama: event.target.value }))
          }
        />
      </div>

      <div className={`${cardClass} overflow-auto`}>
        <table className="w-full min-w-[900px] text-sm">
          <thead className="text-left text-gray-400">
            <tr>
              <th className="p-3">Başlık</th>
              <th className="p-3">Tür</th>
              <th className="p-3">Son Tarih</th>
              <th className="p-3">Firma</th>
              <th className="p-3">Durum</th>
              <th className="p-3">İşlem</th>
            </tr>
          </thead>
          <tbody>
            {upcomingTaxItems.concat(data.vergiTakvimi.filter((item) => item.tamamlandi)).map((item) => (
              <tr key={item.id} className="border-t border-gray-800">
                <td className="p-3">{item.baslik}</td>
                <td className="p-3">{item.tur || "—"}</td>
                <td className="p-3">{item.sonTarih}</td>
                <td className="p-3">{getCompanyName(companies, resolveCompanyId(item))}</td>
                <td className="p-3">{item.tamamlandi ? "Tamamlandı" : "Açık"}</td>
                <td className="p-3">
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => toggleTaxItem(item.id)} className={buttonSecondary}>
                      {item.tamamlandi ? "Geri Al" : "Tamamla"}
                    </button>
                    {renderWhatsAppButton(resolveCompanyId(item), item.baslik, item.sonTarih)}
                    <button
                      type="button"
                      onClick={() => removeTaxItem(item.id)}
                      className="rounded-lg border border-red-800 px-3 py-1.5 text-xs text-red-300"
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
    </div>
  );

  const renderHatirlatmalar = () => (
    <RemindersTab
      hatirlatmalar={data.hatirlatmalar}
      vergiTakvimi={data.vergiTakvimi}
      settings={data.settings}
      companies={companies}
      activeCompanies={activeCompanies}
      onAddReminders={handleAddReminders}
      onRemoveReminder={removeReminder}
    />
  );

  const renderAyarlar = () => (
    <div className="grid gap-6 xl:grid-cols-2">
      <div className={cardClass}>
        <h3 className="text-lg font-semibold">Ofis Ayarları</h3>
        <div className="mt-4 space-y-3">
          <input
            className={inputClass}
            placeholder="Ofis adı"
            value={data.settings.officeName}
            onChange={(event) => patchSettings({ officeName: event.target.value })}
          />
          <textarea
            className={`${inputClass} min-h-28`}
            placeholder="WhatsApp şablonu"
            value={data.settings.whatsappTemplate}
            onChange={(event) => patchSettings({ whatsappTemplate: event.target.value })}
          />
          <input
            className={inputClass}
            type="number"
            min="0"
            placeholder="Kaç gün önce hatırlat"
            value={data.settings.reminderDaysBefore}
            onChange={(event) =>
              patchSettings({ reminderDaysBefore: Number(event.target.value) || 0 })
            }
          />
          <p className="text-xs text-gray-500">
            Şablon değişkenleri: {"{mukellef}"}, {"{unvan}"}, {"{konu}"}, {"{tarih}"}
          </p>
        </div>
      </div>

      <div className={cardClass}>
        <h3 className="text-lg font-semibold">Veri Yedekleme</h3>
        <div className="mt-4 flex flex-wrap gap-3">
          <button type="button" onClick={exportJson} className={buttonPrimary}>
            JSON Dışa Aktar
          </button>
          <label className={`${buttonSecondary} cursor-pointer`}>
            JSON İçe Aktar
            <input
              ref={jsonInputRef}
              type="file"
              accept="application/json,.json"
              onChange={importJson}
              className="hidden"
            />
          </label>
          <button type="button" onClick={resetData} className="rounded-xl border border-red-800 px-4 py-2.5 text-sm font-semibold text-red-300">
            Verileri Sıfırla
          </button>
        </div>
        <p className="mt-4 text-sm text-gray-400">
          Veriler şu an localStorage ile saklanıyor. Sonraki aşamada Supabase senkronu eklenecek.
        </p>
      </div>
    </div>
  );

  const renderContent = () => {
    switch (activeTab) {
      case "dashboard":
        return renderDashboard();
      case "mukellefler":
        return renderMukellefler();
      case "yapilacaklar":
        return (
          <div className="space-y-6">
            {renderTaskForm()}
            {renderTaskTable(openTasks)}
          </div>
        );
      case "tamamlananlar":
        return renderTaskTable(completedTasks, true);
      case "vergi-takvimi":
        return renderVergiTakvimi();
      case "hatirlatmalar":
        return renderHatirlatmalar();
      case "ayarlar":
        return renderAyarlar();
      default:
        return renderDashboard();
    }
  };

  const contentWidthClass =
    activeTab === "hatirlatmalar" || activeTab === "vergi-takvimi"
      ? "max-w-[1400px]"
      : "max-w-7xl";

  if (!loaded) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-950 text-white">
        Yükleniyor...
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <div className="border-b border-gray-800 bg-gray-900/80 px-6 py-4 backdrop-blur">
        <div className={`mx-auto flex ${contentWidthClass} flex-wrap items-center justify-between gap-4`}>
          <div>
            <p className="text-sm text-violet-300">ANNVERO Modülü</p>
            <h1 className="text-2xl font-bold">{data.settings.officeName || "Ofis Takip"}</h1>
          </div>
          <div className="flex flex-wrap gap-3">
            <AnnveroModuleNav variant="ofis-takip" />
          </div>
        </div>
      </div>

      <div className={`mx-auto flex ${contentWidthClass} flex-col gap-6 px-6 py-8 lg:flex-row`}>
        <aside className="lg:w-64">
          <nav className={`${cardClass} space-y-1 p-3`}>
            {OFIS_TAKIP_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`w-full rounded-xl px-4 py-3 text-left text-sm font-medium transition ${
                  activeTab === tab.id
                    ? "bg-violet-600 text-white"
                    : "text-gray-300 hover:bg-gray-800 hover:text-white"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </aside>

        <section className="min-w-0 flex-1 lg:max-w-none">{renderContent()}</section>
      </div>
    </main>
  );
}
