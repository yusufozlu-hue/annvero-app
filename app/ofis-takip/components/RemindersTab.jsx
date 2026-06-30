"use client";

import { useMemo, useState } from "react";
import { getCompanyDisplayName } from "@/src/utils/companies";
import {
  findCompanyById,
  formatContactValue,
  getCompanyName,
  getCompanyWhatsAppPhone,
  getSortedCompanyContacts,
  resolveContactWhatsApp,
} from "@/src/ofis-takip/companyBridge";
import { formatTrDateInputValue, normalizeTrDateInput } from "@/src/ofis-takip/dateUtils";
import {
  buildAutoReminderMessage,
  buildReminderDisplayRows,
  resolveReminderCompanyIds,
  truncateText,
} from "@/src/ofis-takip/reminderUtils";
import { buildWhatsAppLink } from "@/src/ofis-takip/whatsapp";
import { createId } from "@/src/ofis-takip/defaultState";

const inputClass =
  "w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white outline-none focus:border-violet-500";
const buttonPrimary =
  "rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-violet-500";
const buttonSecondary =
  "rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs font-semibold text-gray-200 transition hover:border-gray-500";
const cellClass = "px-2 py-2 align-top text-xs";
const headClass = "px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500";

function buildRowMessage(row, companies) {
  if (row.mesaj?.trim()) {
    return row.mesaj.trim();
  }

  const defaultContact = getSortedCompanyContacts(
    findCompanyById(companies, row.companyId)
  )[0];

  return buildAutoReminderMessage({
    title: row.baslik,
    date: row.tarih,
    contactName: defaultContact?.name,
  });
}

export default function RemindersTab({
  hatirlatmalar,
  vergiTakvimi,
  settings,
  companies,
  activeCompanies,
  onAddReminders,
  onRemoveReminder,
}) {
  const [form, setForm] = useState({
    baslik: "",
    tarih: "",
    aciklama: "",
    companyMode: "selected",
    companyIds: [],
  });
  const [companyModalOpen, setCompanyModalOpen] = useState(false);
  const [companySearch, setCompanySearch] = useState("");
  const [messageDetail, setMessageDetail] = useState(null);

  const displayRows = useMemo(
    () =>
      buildReminderDisplayRows({
        hatirlatmalar,
        vergiTakvimi,
        companies,
        reminderDaysBefore: settings.reminderDaysBefore,
      }),
    [companies, hatirlatmalar, settings.reminderDaysBefore, vergiTakvimi]
  );

  const filteredPickerCompanies = useMemo(() => {
    const query = companySearch.trim().toLocaleLowerCase("tr");
    if (!query) return activeCompanies;

    return activeCompanies.filter((company) =>
      getCompanyDisplayName(company).toLocaleLowerCase("tr").includes(query)
    );
  }, [activeCompanies, companySearch]);

  const selectedCompanyLabel = useMemo(() => {
    if (form.companyMode === "all") {
      return `Tüm firmalar (${activeCompanies.length})`;
    }

    if (form.companyIds.length === 0) {
      return "Firma seçin";
    }

    if (form.companyIds.length === 1) {
      return getCompanyName(companies, form.companyIds[0]);
    }

    return `${form.companyIds.length} firma seçildi`;
  }, [activeCompanies.length, companies, form.companyIds, form.companyMode]);

  const toggleCompanySelection = (companyId) => {
    setForm((current) => {
      const exists = current.companyIds.includes(companyId);
      return {
        ...current,
        companyMode: "selected",
        companyIds: exists
          ? current.companyIds.filter((id) => id !== companyId)
          : [...current.companyIds, companyId],
      };
    });
  };

  const handleAddReminder = () => {
    const normalizedDate = normalizeTrDateInput(form.tarih);
    if (!form.baslik.trim() || !normalizedDate) {
      alert("Hatırlatma başlığı ve geçerli bir tarih girin.");
      return;
    }

    const companyIds = resolveReminderCompanyIds(
      form.companyMode,
      form.companyIds,
      companies
    );

    if (companyIds.length === 0) {
      alert("En az bir firma seçin.");
      return;
    }

    const entries = companyIds.map((companyId) => {
      const defaultContact = getSortedCompanyContacts(
        findCompanyById(companies, companyId)
      )[0];

      const mesaj =
        form.aciklama.trim() ||
        buildAutoReminderMessage({
          title: form.baslik.trim(),
          date: normalizedDate,
          contactName: defaultContact?.name,
        });

      return {
        id: createId(),
        baslik: form.baslik.trim(),
        tarih: normalizedDate,
        companyId,
        aciklama: form.aciklama.trim(),
        mesaj,
        aktif: true,
        whatsappEnabled: true,
        source: "manual",
      };
    });

    onAddReminders(entries);

    setForm({
      baslik: "",
      tarih: "",
      aciklama: "",
      companyMode: "selected",
      companyIds: [],
    });
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
      <a href={href} className={`${buttonSecondary} inline-flex bg-violet-950/40`}>
        Mail Gönder
      </a>
    );
  };

  const renderWhatsAppButton = (companyId, contactId, message) => {
    const phone = getCompanyWhatsAppPhone(companies, companyId, contactId);
    const href = buildWhatsAppLink(phone, message);

    if (!href) {
      return <span className="text-[11px] text-gray-500">Telefon yok</span>;
    }

    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="inline-flex rounded-lg bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-500"
      >
        WhatsApp Gönder
      </a>
    );
  };

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-gray-800 bg-gray-900 p-4">
        <div className="grid gap-3 lg:grid-cols-[1.4fr,0.8fr,1fr,auto]">
          <input
            className={inputClass}
            placeholder="Hatırlatma başlığı"
            value={form.baslik}
            onChange={(event) =>
              setForm((current) => ({ ...current, baslik: event.target.value }))
            }
          />
          <input
            className={inputClass}
            placeholder="gg.aa.yyyy"
            value={form.tarih}
            onChange={(event) =>
              setForm((current) => ({ ...current, tarih: event.target.value }))
            }
            onBlur={() =>
              setForm((current) => ({
                ...current,
                tarih: formatTrDateInputValue(current.tarih),
              }))
            }
          />
          <button
            type="button"
            onClick={() => setCompanyModalOpen(true)}
            className={`${inputClass} text-left`}
          >
            {selectedCompanyLabel}
          </button>
          <button type="button" onClick={handleAddReminder} className={buttonPrimary}>
            Ekle
          </button>
        </div>
        <textarea
          className={`${inputClass} mt-3 min-h-20`}
          placeholder="Açıklama / mesaj (boş bırakılırsa otomatik oluşturulur)"
          value={form.aciklama}
          onChange={(event) =>
            setForm((current) => ({ ...current, aciklama: event.target.value }))
          }
        />
      </div>

      <div className="rounded-2xl border border-gray-800 bg-gray-900 p-3">
        <table className="w-full table-fixed text-xs">
          <thead>
            <tr className="border-b border-gray-800">
              <th className={`${headClass} w-[12%]`}>Başlık</th>
              <th className={`${headClass} w-[8%]`}>Tarih</th>
              <th className={`${headClass} w-[12%]`}>Firma</th>
              <th className={`${headClass} w-[10%]`}>Kişi</th>
              <th className={`${headClass} w-[8%]`}>Telefon</th>
              <th className={`${headClass} w-[8%]`}>WhatsApp</th>
              <th className={`${headClass} w-[10%]`}>E-posta</th>
              <th className={`${headClass} w-[16%]`}>Mesaj</th>
              <th className={`${headClass} w-[16%]`}>İşlem</th>
            </tr>
          </thead>
          <tbody>
            {displayRows.map((row) => {
              const defaultContact = getSortedCompanyContacts(
                findCompanyById(companies, row.companyId)
              )[0];
              const message = buildRowMessage(row, companies);

              return (
                <tr key={row.id} className="border-b border-gray-800/80">
                  <td className={cellClass}>
                    <p className="font-medium text-gray-100">{row.baslik}</p>
                    {row.source === "tax" ? (
                      <span className="mt-1 inline-flex rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-300">
                        Vergi Takvimi
                      </span>
                    ) : null}
                  </td>
                  <td className={`${cellClass} text-gray-300`}>{row.tarih}</td>
                  <td className={`${cellClass} text-gray-300`}>
                    {getCompanyName(companies, row.companyId)}
                  </td>
                  <td className={`${cellClass} text-gray-300`}>
                    {formatContactValue(defaultContact?.name)}
                    {defaultContact?.isDefault ? (
                      <span className="mt-1 block text-[10px] text-violet-300">
                        Varsayılan
                      </span>
                    ) : null}
                  </td>
                  <td className={`${cellClass} text-gray-400`}>
                    {formatContactValue(defaultContact?.phone)}
                  </td>
                  <td className={`${cellClass} text-gray-400`}>
                    {formatContactValue(
                      defaultContact ? resolveContactWhatsApp(defaultContact) : ""
                    )}
                  </td>
                  <td className={cellClass}>
                    {defaultContact?.email ? (
                      <span className="break-all text-violet-300">{defaultContact.email}</span>
                    ) : (
                      <span className="text-gray-500">—</span>
                    )}
                  </td>
                  <td className={cellClass}>
                    <p className="line-clamp-2 text-gray-400">{truncateText(message, 72)}</p>
                    <button
                      type="button"
                      onClick={() => setMessageDetail(message)}
                      className="mt-1 text-[11px] font-semibold text-violet-300 hover:text-violet-200"
                    >
                      Detay / Aç
                    </button>
                  </td>
                  <td className={cellClass}>
                    <div className="flex flex-col gap-1.5">
                      {renderWhatsAppButton(
                        row.companyId,
                        defaultContact?.id,
                        message
                      )}
                      {renderMailButton(
                        defaultContact?.email,
                        row.baslik,
                        message
                      )}
                      {row.removable ? (
                        <button
                          type="button"
                          onClick={() => onRemoveReminder(row.id)}
                          className="rounded-lg border border-red-900 px-2 py-1 text-[11px] text-red-300"
                        >
                          Sil
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {displayRows.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-gray-500">
            Hatırlatma kaydı yok. Vergi takvimi tarihleri yaklaştığında burada otomatik görünür.
          </p>
        ) : null}
      </div>

      {companyModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="max-h-[85vh] w-full max-w-xl overflow-hidden rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl">
            <div className="border-b border-gray-800 px-5 py-4">
              <h3 className="text-lg font-semibold text-white">Firma Seçimi</h3>
              <p className="mt-1 text-sm text-gray-400">
                Tek firma, birden fazla firma veya tüm firmalar
              </p>
            </div>
            <div className="space-y-4 px-5 py-4">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setForm((current) => ({
                      ...current,
                      companyMode: "all",
                      companyIds: [],
                    }))
                  }
                  className={`${buttonSecondary} ${
                    form.companyMode === "all" ? "border-violet-500 text-white" : ""
                  }`}
                >
                  Tüm Firmalar
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setForm((current) => ({ ...current, companyMode: "selected" }))
                  }
                  className={`${buttonSecondary} ${
                    form.companyMode === "selected" ? "border-violet-500 text-white" : ""
                  }`}
                >
                  Seçili Firmalar
                </button>
              </div>
              <input
                className={inputClass}
                placeholder="Firma ara..."
                value={companySearch}
                onChange={(event) => setCompanySearch(event.target.value)}
              />
              <div className="max-h-72 space-y-2 overflow-auto pr-1">
                {filteredPickerCompanies.map((company) => {
                  const checked =
                    form.companyMode === "all" ||
                    form.companyIds.includes(company.id);

                  return (
                    <label
                      key={company.id}
                      className="flex cursor-pointer items-center gap-3 rounded-xl border border-gray-800 bg-gray-950 px-3 py-2"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={form.companyMode === "all"}
                        onChange={() => toggleCompanySelection(company.id)}
                      />
                      <span className="text-sm text-gray-200">
                        {getCompanyDisplayName(company)}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-800 px-5 py-4">
              <button
                type="button"
                onClick={() => setCompanyModalOpen(false)}
                className={buttonSecondary}
              >
                Kapat
              </button>
              <button
                type="button"
                onClick={() => setCompanyModalOpen(false)}
                className={buttonPrimary}
              >
                Seçimi Uygula
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {messageDetail ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-gray-700 bg-gray-900 p-5 shadow-2xl">
            <h3 className="text-lg font-semibold text-white">Hatırlatma Mesajı</h3>
            <pre className="mt-4 whitespace-pre-wrap rounded-xl border border-gray-800 bg-gray-950 p-4 text-sm text-gray-300">
              {messageDetail}
            </pre>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setMessageDetail(null)}
                className={buttonPrimary}
              >
                Kapat
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
