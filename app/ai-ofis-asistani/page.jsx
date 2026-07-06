"use client";

import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import AnnveroLogo from "@/app/components/AnnveroLogo";
import CompanySelectOptions from "@/app/muhasebe/components/CompanySelectOptions";
import { useCompanyList } from "@/app/muhasebe/hooks/useCompanyList";
import {
  AI_OFIS_DOCUMENT_STATUS,
  AI_OFIS_DOCUMENT_TYPES,
  AI_OFIS_SOURCES,
  AI_OFIS_VIEWS,
} from "@/src/config/aiOfisAsistaniDefaults";
import { getCompanyDisplayName } from "@/src/utils/companies";
import {
  appendAiOfisHistory,
  buildAiOfisDashboardStats,
  buildAiOfisDocument,
  buildAiOfisMail,
  buildAiOfisReminders,
  classifyAiOfisDocument,
  filterAiOfisDocuments,
  getModuleRouteForType,
  learnFromAiOfisCorrection,
  loadAiOfisDocuments,
  loadAiOfisHistory,
  loadAiOfisMails,
  loadAiOfisReminders,
  loadAiOfisTasks,
  readAiOfisDocumentFile,
  runAiOfisScenario,
  saveAiOfisDocuments,
  saveAiOfisMails,
  saveAiOfisReminders,
  saveAiOfisTasks,
  syncTasksForDocuments,
  updateAiOfisDocument,
} from "@/src/utils/aiOfisAsistaniEngine";

const inputClassName =
  "w-full rounded-xl border border-white/10 bg-gray-950/80 px-3 py-2.5 text-sm text-white outline-none transition focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/20";

const navBtn =
  "inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-gray-200 transition hover:border-white/20 hover:bg-white/10 hover:text-white";

const STATUS_OPTIONS = ["Tümü", ...Object.values(AI_OFIS_DOCUMENT_STATUS)];
const TYPE_OPTIONS = ["Tümü", ...AI_OFIS_DOCUMENT_TYPES];
const SOURCE_OPTIONS = ["Tümü", ...Object.values(AI_OFIS_SOURCES)];

function StatCard({ label, value, tone = "default" }) {
  const tones = {
    default: "text-white",
    warning: "text-amber-300",
    success: "text-emerald-300",
    danger: "text-red-300",
  };
  return (
    <div className="min-w-[130px] flex-1 rounded-2xl border border-gray-800 bg-gray-900 p-4">
      <p className="text-xs uppercase tracking-wide text-gray-400">{label}</p>
      <p className={`mt-2 text-2xl font-bold ${tones[tone] || tones.default}`}>{value}</p>
    </div>
  );
}

export default function AiOfisAsistaniPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#050816] p-6 text-white">Yükleniyor...</div>}>
      <AiOfisAsistaniApp />
    </Suspense>
  );
}

function AiOfisAsistaniApp() {
  const searchParams = useSearchParams();
  const initialView = searchParams.get("view") || "pool";

  const { companies, selectedCompanyId, setSelectedCompanyId } = useCompanyList();

  const [view, setView] = useState(initialView);
  const [documents, setDocuments] = useState(() => loadAiOfisDocuments());
  const [mails, setMails] = useState(() => loadAiOfisMails());
  const [tasks, setTasks] = useState(() => loadAiOfisTasks());
  const [history, setHistory] = useState(() => loadAiOfisHistory());

  const [typeFilter, setTypeFilter] = useState("Tümü");
  const [sourceFilter, setSourceFilter] = useState("Tümü");
  const [statusFilter, setStatusFilter] = useState("Tümü");
  const [moduleFilter, setModuleFilter] = useState("Tümü");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [minConfidence, setMinConfidence] = useState(0);
  const [toast, setToast] = useState("");
  const [scenarioResult, setScenarioResult] = useState(null);
  const [mailDraft, setMailDraft] = useState({
    subject: "",
    sender: "",
    bodyPreview: "",
    attachmentNames: "",
  });

  const moduleOptions = useMemo(() => {
    const set = new Set(documents.map((doc) => doc.targetModule).filter(Boolean));
    return ["Tümü", ...Array.from(set).sort((a, b) => a.localeCompare(b, "tr"))];
  }, [documents]);

  const filteredDocuments = useMemo(
    () =>
      filterAiOfisDocuments(documents, {
        companyId: selectedCompanyId,
        documentType: typeFilter,
        source: sourceFilter,
        status: statusFilter,
        dateFrom,
        dateTo,
        targetModule: moduleFilter,
        minConfidence,
      }),
    [
      documents,
      selectedCompanyId,
      typeFilter,
      sourceFilter,
      statusFilter,
      dateFrom,
      dateTo,
      moduleFilter,
      minConfidence,
    ]
  );

  const stats = useMemo(() => buildAiOfisDashboardStats(documents, tasks), [documents, tasks]);
  const liveReminders = useMemo(
    () => buildAiOfisReminders(documents, tasks),
    [documents, tasks]
  );

  const persistDocuments = (next) => {
    setDocuments(next);
    saveAiOfisDocuments(next);
    const nextTasks = syncTasksForDocuments(next, tasks);
    setTasks(nextTasks);
    saveAiOfisTasks(nextTasks);
    const nextReminders = buildAiOfisReminders(next, nextTasks);
    saveAiOfisReminders(nextReminders);
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const meta = await readAiOfisDocumentFile(file);
      const doc = buildAiOfisDocument(
        {
          ...meta,
          source: AI_OFIS_SOURCES.MANUEL,
          description: meta.fileName,
        },
        companies
      );
      persistDocuments([doc, ...documents]);
      appendAiOfisHistory({
        action: "yukleme",
        message: `${doc.fileName} evrak havuzuna eklendi`,
        documentId: doc.id,
      });
      setHistory(loadAiOfisHistory());
      setToast(`${doc.fileName} yüklendi ve sınıflandırıldı.`);
    } catch (error) {
      setToast(error.message || "Dosya yüklenemedi.");
    }
    event.target.value = "";
  };

  const updateDocument = async (documentId, patch) => {
    const previous = documents.find((doc) => doc.id === documentId);
    const next = updateAiOfisDocument(documents, documentId, patch);
    persistDocuments(next);

    if (previous && (patch.companyId || patch.documentType)) {
      await learnFromAiOfisCorrection({
        companyId: patch.companyId || previous.companyId,
        companyName: patch.companyName || previous.companyName,
        documentType: patch.documentType || previous.documentType,
        fileName: previous.fileName,
        sender: previous.sender,
        subject: previous.mailSubject,
      });
      setToast("Düzeltme kaydedildi ve öğrenen hafızaya işlendi.");
    } else {
      setToast("Kayıt güncellendi.");
    }
    setHistory(loadAiOfisHistory());
  };

  const routeDocument = (doc) => {
    const route = getModuleRouteForType(doc.documentType);
    updateDocument(doc.id, {
      status: AI_OFIS_DOCUMENT_STATUS.MODULE_AKTARILDI,
      targetModule: route.label,
      targetModuleHref: route.href,
    });
    appendAiOfisHistory({
      action: "yonlendirme",
      message: `${doc.fileName} → ${route.label}`,
      documentId: doc.id,
    });
    setHistory(loadAiOfisHistory());
    window.open(route.href, "_blank", "noopener,noreferrer");
  };

  const importMail = () => {
    const mail = buildAiOfisMail(
      {
        subject: mailDraft.subject,
        sender: mailDraft.sender,
        bodyPreview: mailDraft.bodyPreview,
        attachmentNames: mailDraft.attachmentNames
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      },
      companies
    );
    const nextMails = [mail, ...mails];
    setMails(nextMails);
    saveAiOfisMails(nextMails);

    const attachmentDocs = (mail.attachmentNames || []).map((fileName) =>
      buildAiOfisDocument(
        {
          fileName,
          source: AI_OFIS_SOURCES.MAIL,
          mailId: mail.id,
          subject: mail.subject,
          sender: mail.sender,
          description: mail.bodyPreview,
          companyId: mail.companyId,
          companyName: mail.companyName,
        },
        companies
      )
    );

    if (attachmentDocs.length) {
      persistDocuments([...attachmentDocs, ...documents]);
    }

    appendAiOfisHistory({
      action: "mail_aktarim",
      message: `Mail aktarıldı: ${mail.subject}`,
      mailId: mail.id,
    });
    setHistory(loadAiOfisHistory());
    setToast("Mail manuel olarak aktarıldı.");
  };

  const runScenario = () => {
    const result = runAiOfisScenario(companies);
    setScenarioResult(result);
    setDocuments(loadAiOfisDocuments());
    setTasks(loadAiOfisTasks());
    setHistory(loadAiOfisHistory());
    setToast("Test senaryoları çalıştırıldı.");
  };

  return (
    <div className="min-h-screen bg-[#050816] p-6 text-white">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <AnnveroLogo />
            <h1 className="mt-4 text-2xl font-bold">AI Ofis Asistanı</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-400">
              E-posta ve evrakları tek havuzda toplayın; AI ile sınıflandırın, firmayla eşleştirin
              ve ilgili modüle yönlendirin.
            </p>
          </div>
          <nav className="flex flex-wrap gap-3">
            <Link href="/dashboard" className={navBtn}>
              Dashboard
            </Link>
            <Link href="/muhasebe/ogrenen-hafiza" className={navBtn}>
              Öğrenen Hafıza
            </Link>
          </nav>
        </header>

        {toast ? (
          <div className="mb-4 rounded-xl border border-cyan-700/50 bg-cyan-950/40 px-4 py-3 text-sm">
            {toast}
          </div>
        ) : null}

        <div className="mb-4 flex flex-wrap gap-4">
          <StatCard label="Gelen Evrak" value={stats.incomingCount} />
          <StatCard label="İşlenmemiş" value={stats.unprocessedCount} tone="warning" />
          <StatCard label="AI Eşleşen" value={stats.aiMatchedCount} tone="success" />
          <StatCard label="Manuel Kontrol" value={stats.manualReviewCount} tone="danger" />
          <StatCard label="Bugün Görev" value={stats.tasksToday} />
          <StatCard label="Geciken İş" value={stats.overdueCount} tone="danger" />
        </div>

        <div className="mb-6 flex flex-wrap gap-2">
          {AI_OFIS_VIEWS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setView(item.id)}
              className={`rounded-lg px-4 py-2 text-sm ${
                view === item.id ? "bg-cyan-600" : "bg-slate-800 hover:bg-slate-700"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="mb-6 grid grid-cols-1 gap-4 rounded-2xl border border-gray-800 bg-gray-900 p-5 lg:grid-cols-4">
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-slate-400">Firma</span>
            <select
              className={inputClassName}
              value={selectedCompanyId}
              onChange={(e) => setSelectedCompanyId(e.target.value)}
            >
              <option value="">Tüm firmalar</option>
              <CompanySelectOptions companies={companies} />
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-slate-400">Evrak Türü</span>
            <select className={inputClassName} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              {TYPE_OPTIONS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-slate-400">Kaynak</span>
            <select
              className={inputClassName}
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
            >
              {SOURCE_OPTIONS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-slate-400">Durum</span>
            <select
              className={inputClassName}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              {STATUS_OPTIONS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-slate-400">Başlangıç</span>
            <input type="date" className={inputClassName} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-slate-400">Bitiş</span>
            <input type="date" className={inputClassName} value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-slate-400">İlgili Modül</span>
            <select
              className={inputClassName}
              value={moduleFilter}
              onChange={(e) => setModuleFilter(e.target.value)}
            >
              {moduleOptions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-slate-400">Min. AI Güven (%)</span>
            <input
              type="number"
              min={0}
              max={100}
              className={inputClassName}
              value={minConfidence}
              onChange={(e) => setMinConfidence(Number(e.target.value) || 0)}
            />
          </label>
        </div>

        <div className="mb-6 flex flex-wrap gap-3">
          <label className="cursor-pointer rounded-xl bg-cyan-600 px-5 py-2.5 text-sm font-semibold hover:bg-cyan-500">
            Evrak Yükle
            <input type="file" className="hidden" onChange={handleFileUpload} />
          </label>
          <button
            type="button"
            onClick={runScenario}
            className="rounded-xl border border-gray-700 bg-gray-950 px-5 py-2.5 text-sm font-semibold hover:border-gray-500"
          >
            Test Senaryolarını Çalıştır
          </button>
        </div>

        {view === "pool" && (
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Evrak Havuzu</h2>
            {filteredDocuments.length === 0 ? (
              <p className="rounded-2xl border border-gray-800 bg-gray-900 p-6 text-sm text-slate-400">
                Kayıt bulunamadı.
              </p>
            ) : (
              filteredDocuments.map((doc) => (
                <DocumentCard
                  key={doc.id}
                  doc={doc}
                  companies={companies}
                  onUpdate={updateDocument}
                  onRoute={routeDocument}
                />
              ))
            )}
          </section>
        )}

        {view === "mail" && (
          <section className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
            <h2 className="mb-4 text-lg font-semibold">Mail Gelen Kutusu (Manuel Aktarım)</h2>
            <p className="mb-4 text-xs text-slate-400">
              IMAP / Gmail / n8n entegrasyonu için altyapı hazır. Şimdilik mail bilgilerini manuel
              girin.
            </p>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <input
                className={inputClassName}
                placeholder="Konu"
                value={mailDraft.subject}
                onChange={(e) => setMailDraft({ ...mailDraft, subject: e.target.value })}
              />
              <input
                className={inputClassName}
                placeholder="Gönderen"
                value={mailDraft.sender}
                onChange={(e) => setMailDraft({ ...mailDraft, sender: e.target.value })}
              />
              <input
                className={`${inputClassName} md:col-span-2`}
                placeholder="Ek dosyalar (virgülle)"
                value={mailDraft.attachmentNames}
                onChange={(e) => setMailDraft({ ...mailDraft, attachmentNames: e.target.value })}
              />
              <textarea
                className={`${inputClassName} md:col-span-2`}
                rows={3}
                placeholder="Mail özeti"
                value={mailDraft.bodyPreview}
                onChange={(e) => setMailDraft({ ...mailDraft, bodyPreview: e.target.value })}
              />
            </div>
            <button
              type="button"
              onClick={importMail}
              className="mt-4 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold hover:bg-cyan-500"
            >
              Mail / Ekleri Aktar
            </button>
            <div className="mt-6 space-y-2">
              {mails.map((mail) => (
                <div key={mail.id} className="rounded-lg border border-slate-800 px-3 py-2 text-sm">
                  <p className="font-medium">{mail.subject}</p>
                  <p className="text-slate-400">
                    {mail.sender} · {mail.receivedAt?.slice(0, 10)} · Tahmin: {mail.predictedDocumentType}{" "}
                    (%{mail.aiConfidence})
                  </p>
                  <p className="text-xs text-slate-500">
                    Firma tahmini: {mail.companyName || "Belirsiz"} · Entegrasyon: IMAP/Gmail hazır,
                    n8n destekli
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        {view === "classification" && (
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">AI Sınıflandırma</h2>
            {filteredDocuments.map((doc) => {
              const prediction = classifyAiOfisDocument(
                {
                  fileName: doc.fileName,
                  description: doc.description,
                  sender: doc.sender,
                  subject: doc.mailSubject,
                },
                companies
              );
              return (
                <div key={doc.id} className="rounded-xl border border-gray-800 bg-gray-900 p-4 text-sm">
                  <p className="font-medium">{doc.fileName}</p>
                  <p className="text-slate-400">
                    Firma: {prediction.companyName || "—"} · Tür: {prediction.documentType} · Modül:{" "}
                    {prediction.targetModule}
                  </p>
                  <p className="text-slate-400">
                    Güven: %{prediction.confidence} · Acil: {prediction.urgent ? "Evet" : "Hayır"} ·
                    Eksik bilgi: {prediction.missingInfo ? "Evet" : "Hayır"}
                  </p>
                  <p className="text-xs text-cyan-300">{prediction.explanation}</p>
                </div>
              );
            })}
          </section>
        )}

        {view === "matching" && (
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Firma Eşleştirme</h2>
            {filteredDocuments.map((doc) => (
              <DocumentCard
                key={doc.id}
                doc={doc}
                companies={companies}
                onUpdate={updateDocument}
                onRoute={routeDocument}
                focus="matching"
              />
            ))}
          </section>
        )}

        {view === "tasks" && (
          <section className="space-y-2">
            <h2 className="mb-3 text-lg font-semibold">Görevler</h2>
            {tasks.length === 0 ? (
              <p className="text-sm text-slate-400">Görev yok.</p>
            ) : (
              tasks.map((task) => (
                <div key={task.id} className="rounded-lg border border-violet-900/40 bg-violet-950/20 px-3 py-2 text-sm">
                  <p className="font-medium">{task.title}</p>
                  <p className="text-slate-300">
                    {task.type} · {task.companyName || "—"} · {task.priority} · {task.status}
                  </p>
                </div>
              ))
            )}
          </section>
        )}

        {view === "reminders" && (
          <section className="space-y-2">
            <h2 className="mb-3 text-lg font-semibold">Hatırlatmalar</h2>
            {liveReminders.map((item) => (
              <div key={item.id} className="rounded-lg border border-amber-800/40 bg-amber-950/20 px-3 py-2 text-sm">
                <p className="font-medium text-amber-100">{item.type}</p>
                <p className="text-amber-200/90">{item.message}</p>
              </div>
            ))}
          </section>
        )}

        {view === "history" && (
          <section className="space-y-2">
            <h2 className="mb-3 text-lg font-semibold">İşlem Geçmişi</h2>
            {history.length === 0 ? (
              <p className="text-sm text-slate-400">Geçmiş kaydı yok.</p>
            ) : (
              history.map((item) => (
                <div key={item.id} className="rounded-lg border border-slate-800 px-3 py-2 text-sm">
                  <p className="font-medium">{item.action}</p>
                  <p className="text-slate-400">
                    {item.message} · {item.createdAt?.slice(0, 19).replace("T", " ")}
                  </p>
                </div>
              ))
            )}
          </section>
        )}

        {scenarioResult ? (
          <section className="mt-6 rounded-2xl border border-emerald-800/40 bg-emerald-950/20 p-5 text-sm">
            <h2 className="mb-3 font-semibold text-emerald-100">Test Özeti</h2>
            <ul className="space-y-1 text-emerald-200/90">
              <li>Banka ekstresi → Parser: {scenarioResult.bankRoutedToParser ? "OK" : "—"}</li>
              <li>SGK tahakkuk → Beyanname: {scenarioResult.sgkRoutedToDeclaration ? "OK" : "—"}</li>
              <li>Personel belgesi → İK: {scenarioResult.hrRoutedToIk ? "OK" : "—"}</li>
              <li>Ticaret sicil → Operasyon: {scenarioResult.tradeRegistryRouted ? "OK" : "—"}</li>
              <li>Öğrenme çalışıyor: {scenarioResult.learningWorks ? "OK" : "—"}</li>
              <li>Dashboard güncellendi: {scenarioResult.dashboardUpdated ? "OK" : "—"}</li>
              <li>Üretilen görev: {scenarioResult.tasksGenerated}</li>
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function DocumentCard({ doc, companies, onUpdate, onRoute, focus = "full" }) {
  return (
    <article className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-white">{doc.fileName || "İsimsiz evrak"}</p>
          <p className="text-sm text-slate-400">
            {doc.companyName || "Firma belirsiz"} · {doc.documentType} · {doc.source}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {doc.uploadedAt?.slice(0, 10)} · {doc.status} · AI %{doc.aiConfidence} · {doc.targetModule}
          </p>
          {doc.description ? <p className="mt-2 text-xs text-slate-400">{doc.description}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onRoute(doc)}
            className="rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-semibold hover:bg-cyan-500"
          >
            Modüle Aktar
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        <label className="text-xs text-slate-400">
          Firma
          <select
            className={`${inputClassName} mt-1`}
            value={doc.companyId || ""}
            onChange={(e) => {
              const company = companies.find((item) => item.id === e.target.value);
              onUpdate(doc.id, {
                companyId: e.target.value,
                companyName: getCompanyDisplayName(company),
              });
            }}
          >
            <option value="">Seçin</option>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {getCompanyDisplayName(company)}
              </option>
            ))}
          </select>
        </label>
        {focus !== "matching" ? (
          <>
            <label className="text-xs text-slate-400">
              Evrak Türü
              <select
                className={`${inputClassName} mt-1`}
                value={doc.documentType}
                onChange={(e) => {
                  const route = getModuleRouteForType(e.target.value);
                  onUpdate(doc.id, {
                    documentType: e.target.value,
                    targetModule: route.label,
                    targetModuleHref: route.href,
                  });
                }}
              >
                {AI_OFIS_DOCUMENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-400">
              Durum
              <select
                className={`${inputClassName} mt-1`}
                value={doc.status}
                onChange={(e) => onUpdate(doc.id, { status: e.target.value })}
              >
                {Object.values(AI_OFIS_DOCUMENT_STATUS).map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-400 md:col-span-3">
              Açıklama
              <input
                className={`${inputClassName} mt-1`}
                value={doc.description || ""}
                onChange={(e) => onUpdate(doc.id, { description: e.target.value })}
              />
            </label>
          </>
        ) : null}
      </div>
    </article>
  );
}
