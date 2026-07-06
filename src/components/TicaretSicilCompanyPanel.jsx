"use client";

import { useEffect, useMemo, useState } from "react";
import {
  TICARET_SICIL_OPERATION_STATUS,
  TICARET_SICIL_OPERATION_TYPES,
} from "@/src/config/ticaretSicilDefaults";
import {
  buildOperation,
  buildTicaretSicilDashboardStats,
  buildTicaretSicilReminders,
  getMissingChecklistCount,
  getTicaretSicilProfile,
  loadTicaretSicilDocuments,
  loadTicaretSicilOperations,
  readOperationDocumentFile,
  saveTicaretSicilDocuments,
  saveTicaretSicilOperations,
  saveTicaretSicilProfile,
  suggestDocumentsForOperation,
} from "@/src/utils/ticaretSicilEngine";

const inputClassName =
  "w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500";

export default function TicaretSicilCompanyPanel({
  companyId = "",
  companyName = "",
  companyAddress = "",
  companyTaxNumber = "",
  view = "profile",
}) {
  const [profile, setProfile] = useState(() =>
    getTicaretSicilProfile(companyId, {
      address: companyAddress,
      taxNumber: companyTaxNumber,
    })
  );
  const [operations, setOperations] = useState(() => loadTicaretSicilOperations());
  const [documents, setDocuments] = useState(() => loadTicaretSicilDocuments());
  const [toast, setToast] = useState("");

  const companyOperations = useMemo(
    () => operations.filter((op) => op.companyId === companyId),
    [operations, companyId]
  );
  const companyDocuments = useMemo(
    () => documents.filter((doc) => doc.companyId === companyId),
    [documents, companyId]
  );
  const stats = useMemo(
    () => buildTicaretSicilDashboardStats(companyOperations),
    [companyOperations]
  );
  const reminders = useMemo(
    () => buildTicaretSicilReminders(companyOperations),
    [companyOperations]
  );

  useEffect(() => {
    setProfile(
      getTicaretSicilProfile(companyId, {
        address: companyAddress,
        taxNumber: companyTaxNumber,
      })
    );
  }, [companyId, companyAddress, companyTaxNumber]);

  const persistOperations = (next) => {
    setOperations(next);
    saveTicaretSicilOperations(next);
  };

  const persistDocuments = (next) => {
    setDocuments(next);
    saveTicaretSicilDocuments(next);
  };

  const saveProfile = () => {
    saveTicaretSicilProfile(companyId, profile);
    setToast("Ticaret sicil profili kaydedildi.");
  };

  const createOperation = (type) => {
    const operation = buildOperation({
      companyId,
      companyName,
      type,
    });
    persistOperations([operation, ...operations]);
    setToast(`${type} operasyonu oluşturuldu.`);
  };

  const updateOperation = (operationId, patch) => {
    persistOperations(
      operations.map((op) =>
        op.id === operationId
          ? { ...op, ...patch, updatedAt: new Date().toISOString() }
          : op
      )
    );
  };

  const toggleChecklistItem = (operationId, checklistId) => {
    const operation = operations.find((op) => op.id === operationId);
    if (!operation) return;
    updateOperation(operationId, {
      checklist: operation.checklist.map((item) =>
        item.id === checklistId ? { ...item, completed: !item.completed } : item
      ),
      dates: {
        ...operation.dates,
        lastActionDate: new Date().toISOString().slice(0, 10),
      },
    });
  };

  const handleDocumentUpload = async (operationId, event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const parsed = await readOperationDocumentFile(file);
      const record = {
        ...parsed,
        companyId,
        companyName,
        operationId,
      };
      persistDocuments([record, ...documents]);
      setToast(`${file.name} yüklendi.`);
    } catch (error) {
      setToast(error.message || "Dosya yüklenemedi.");
    }
    event.target.value = "";
  };

  if (!companyId) {
    return <p className="text-sm text-slate-400">Ticaret sicil için önce firma seçin.</p>;
  }

  if (view === "profile") {
    return (
      <Panel toast={toast}>
        <h3 className="mb-4 text-lg font-semibold">Ticaret Sicil Bilgileri</h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Şirket Türü">
            <input
              className={inputClassName}
              value={profile.companyType}
              onChange={(e) => setProfile({ ...profile, companyType: e.target.value })}
            />
          </Field>
          <Field label="MERSİS No">
            <input
              className={inputClassName}
              value={profile.mersisNo}
              onChange={(e) => setProfile({ ...profile, mersisNo: e.target.value })}
            />
          </Field>
          <Field label="Vergi No">
            <input
              className={inputClassName}
              value={profile.taxNumber}
              onChange={(e) => setProfile({ ...profile, taxNumber: e.target.value })}
            />
          </Field>
          <Field label="Ticaret Sicil No">
            <input
              className={inputClassName}
              value={profile.tradeRegistryNo}
              onChange={(e) => setProfile({ ...profile, tradeRegistryNo: e.target.value })}
            />
          </Field>
          <Field label="Kuruluş Tarihi">
            <input
              type="date"
              className={inputClassName}
              value={profile.foundedAt}
              onChange={(e) => setProfile({ ...profile, foundedAt: e.target.value })}
            />
          </Field>
          <Field label="Merkez Adres" className="md:col-span-2">
            <textarea
              className={inputClassName}
              rows={2}
              value={profile.headquartersAddress}
              onChange={(e) => setProfile({ ...profile, headquartersAddress: e.target.value })}
            />
          </Field>
          <Field label="Ortak Yapısı" className="md:col-span-2">
            <textarea
              className={inputClassName}
              rows={2}
              value={profile.partnerStructure}
              onChange={(e) => setProfile({ ...profile, partnerStructure: e.target.value })}
            />
          </Field>
          <Field label="Müdür / Yönetici" className="md:col-span-2">
            <textarea
              className={inputClassName}
              rows={2}
              value={profile.managerInfo}
              onChange={(e) => setProfile({ ...profile, managerInfo: e.target.value })}
            />
          </Field>
        </div>
        <button
          type="button"
          onClick={saveProfile}
          className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold hover:bg-indigo-500"
        >
          Kaydet
        </button>
      </Panel>
    );
  }

  if (view === "operations") {
    return (
      <Panel toast={toast}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold">Operasyonlar</h3>
          <select
            className={`${inputClassName} max-w-xs`}
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) createOperation(e.target.value);
              e.target.value = "";
            }}
          >
            <option value="">Yeni operasyon</option>
            {TICARET_SICIL_OPERATION_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-4">
          {companyOperations.length === 0 ? (
            <p className="text-sm text-slate-400">Henüz operasyon yok.</p>
          ) : (
            companyOperations.map((operation) => (
              <article key={operation.id} className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold text-white">{operation.type}</p>
                    <p className="text-xs text-slate-400">
                      Akıllı evrak önerisi: {operation.suggestedDocuments?.summary}
                    </p>
                  </div>
                  <select
                    className={`${inputClassName} max-w-[200px] text-xs`}
                    value={operation.status}
                    onChange={(e) => updateOperation(operation.id, { status: e.target.value })}
                  >
                    {Object.values(TICARET_SICIL_OPERATION_STATUS).map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">
                  {[
                    ["Başvuru", "applicationDate"],
                    ["Tescil", "registrationDate"],
                    ["İlan", "announcementDate"],
                    ["Son İşlem", "lastActionDate"],
                  ].map(([label, key]) => (
                    <label key={key} className="text-xs text-slate-400">
                      {label}
                      <input
                        type="date"
                        className={`${inputClassName} mt-1`}
                        value={operation.dates?.[key] || ""}
                        onChange={(e) =>
                          updateOperation(operation.id, {
                            dates: { ...operation.dates, [key]: e.target.value },
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
                <div className="space-y-2">
                  {operation.checklist.map((item) => (
                    <label key={item.id} className="flex items-center gap-2 text-sm text-slate-200">
                      <input
                        type="checkbox"
                        checked={item.completed}
                        onChange={() => toggleChecklistItem(operation.id, item.id)}
                      />
                      {item.label}
                    </label>
                  ))}
                </div>
                <p className="mt-2 text-xs text-amber-300">
                  Eksik evrak: {getMissingChecklistCount(operation)}
                </p>
                <input
                  type="file"
                  className="mt-3 block text-xs"
                  onChange={(e) => handleDocumentUpload(operation.id, e)}
                />
              </article>
            ))
          )}
        </div>
      </Panel>
    );
  }

  if (view === "documents") {
    return (
      <Panel toast={toast}>
        <h3 className="mb-4 text-lg font-semibold">Evraklar</h3>
        {companyDocuments.length === 0 ? (
          <p className="text-sm text-slate-400">Henüz evrak yüklenmedi.</p>
        ) : (
          <div className="space-y-2">
            {companyDocuments.map((doc) => (
              <div key={doc.id} className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 text-sm">
                <p className="font-medium text-white">{doc.fileName}</p>
                <p className="text-xs text-slate-400">
                  {doc.fileType} · {(doc.fileSize / 1024).toFixed(1)} KB · {doc.storageNote}
                </p>
              </div>
            ))}
          </div>
        )}
      </Panel>
    );
  }

  return (
    <Panel toast={toast}>
      <h3 className="mb-4 text-lg font-semibold">Hatırlatmalar</h3>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <MiniStat label="Açık" value={stats.openOperations} />
        <MiniStat label="Eksik Evrak" value={stats.missingDocuments} />
        <MiniStat label="Bu Ay Tamamlanan" value={stats.completedThisMonth} />
        <MiniStat label="Bekleyen Tescil" value={stats.pendingRegistrations} />
        <MiniStat label="Yaklaşan Süre" value={stats.upcomingDeadlines} />
      </div>
      {reminders.length === 0 ? (
        <p className="text-sm text-slate-400">Aktif hatırlatma yok.</p>
      ) : (
        <div className="space-y-2">
          {reminders.map((item) => (
            <div key={item.id} className="rounded-lg border border-amber-800/40 bg-amber-950/20 px-3 py-2 text-sm">
              <p className="font-medium text-amber-100">{item.type}</p>
              <p className="text-amber-200/90">{item.message}</p>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function Panel({ children, toast }) {
  return (
    <div>
      {toast ? (
        <div className="mb-3 rounded-lg border border-indigo-700 bg-indigo-950/50 px-3 py-2 text-sm text-indigo-100">
          {toast}
        </div>
      ) : null}
      {children}
    </div>
  );
}

function Field({ label, children, className = "" }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs text-slate-400">{label}</span>
      {children}
    </label>
  );
}

function MiniStat({ label, value }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="text-xl font-bold text-white">{value}</p>
    </div>
  );
}
