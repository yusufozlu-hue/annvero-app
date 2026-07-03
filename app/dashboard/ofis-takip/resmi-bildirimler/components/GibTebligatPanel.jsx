"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useCompanyList } from "@/app/muhasebe/hooks/useCompanyList";
import { DEFAULT_GIB_REMINDER } from "@/src/config/resmiBildirimDefaults";
import { formatTrDate, isCheckDue } from "@/src/utils/gibTebligatEngine";
import {
  fetchGibReminders,
  fetchOfficialNotifications,
  patchOfficialNotification,
  runGibCheckRequest,
  saveGibReminder,
} from "@/src/utils/officialNotificationsApi";
import {
  notifyGibCheckDue,
  notifyNewGibTebligat,
  requestNotificationPermission,
} from "@/src/utils/pushNotifications";

const inputClassName =
  "w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-white outline-none focus:border-violet-500";

export default function GibTebligatPanel() {
  const { companies, selectedCompanyId, setSelectedCompanyId, getCompanyDisplayName, isLoading } =
    useCompanyList();

  const [notifications, setNotifications] = useState([]);
  const [reminders, setReminders] = useState([]);
  const [verificationCode, setVerificationCode] = useState("");
  const [selectedCompanyIds, setSelectedCompanyIds] = useState([]);
  const [isBusy, setIsBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [newNotificationForm, setNewNotificationForm] = useState({
    title: "",
    summary: "",
    referenceNo: "",
    notificationDate: "",
  });
  const [reminderForm, setReminderForm] = useState({
    enabled: DEFAULT_GIB_REMINDER.enabled,
    intervalDays: DEFAULT_GIB_REMINDER.intervalDays,
    reminderTime: DEFAULT_GIB_REMINDER.reminderTime,
    pushEnabled: DEFAULT_GIB_REMINDER.pushEnabled,
  });

  const showToast = (message, type = "success") => setToast({ message, type });

  const reminderMap = useMemo(() => {
    const map = new Map();
    reminders.forEach((row) => {
      if (row.company_id) map.set(row.company_id, row);
    });
    return map;
  }, [reminders]);

  const loadData = useCallback(async () => {
    try {
      const [notificationRows, reminderRows] = await Promise.all([
        fetchOfficialNotifications({ channel: "gib" }),
        fetchGibReminders(),
      ]);
      setNotifications(notificationRows);
      setReminders(reminderRows);

      const globalReminder = reminderRows.find((row) => !row.company_id);
      if (globalReminder) {
        setReminderForm({
          enabled: globalReminder.enabled !== false,
          intervalDays: globalReminder.interval_days || DEFAULT_GIB_REMINDER.intervalDays,
          reminderTime: globalReminder.reminder_time || DEFAULT_GIB_REMINDER.reminderTime,
          pushEnabled: globalReminder.push_enabled !== false,
        });
      }
    } catch (error) {
      showToast(error?.message || "Veriler yüklenemedi.", "error");
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!companies.length) return;
    setSelectedCompanyIds((current) =>
      current.length ? current : companies.slice(0, Math.min(3, companies.length)).map((c) => c.id)
    );
  }, [companies]);

  useEffect(() => {
    if (!reminderForm.pushEnabled) return undefined;

    const timer = window.setInterval(() => {
      const dueCompanies = companies.filter((company) => {
        const reminder = reminderMap.get(company.id);
        return isCheckDue(reminder || { enabled: reminderForm.enabled });
      });

      if (dueCompanies.length) {
        notifyGibCheckDue();
      }
    }, 60_000);

    return () => window.clearInterval(timer);
  }, [companies, reminderForm.enabled, reminderForm.pushEnabled, reminderMap]);

  const toggleCompanySelection = (companyId) => {
    setSelectedCompanyIds((current) =>
      current.includes(companyId)
        ? current.filter((id) => id !== companyId)
        : [...current, companyId]
    );
  };

  const handleSaveReminder = async () => {
    setIsBusy(true);
    try {
      await saveGibReminder({
        company_id: null,
        enabled: reminderForm.enabled,
        interval_days: Number(reminderForm.intervalDays),
        reminder_time: reminderForm.reminderTime,
        push_enabled: reminderForm.pushEnabled,
      });
      await loadData();
      showToast("GİB kontrol hatırlatması kaydedildi.");
    } catch (error) {
      showToast(error?.message || "Hatırlatma kaydedilemedi.", "error");
    } finally {
      setIsBusy(false);
    }
  };

  const handleEnablePush = async () => {
    const result = await requestNotificationPermission();
    if (!result.ok) {
      showToast(result.error || "Bildirim izni alınamadı.", "error");
      return;
    }
    showToast("Mobil bildirimler etkinleştirildi.");
  };

  const runSingleCheck = async (companyId) => {
    setIsBusy(true);
    try {
      const payload = await runGibCheckRequest({
        company_id: companyId,
        verification_code: verificationCode,
        found_notifications: newNotificationForm.title
          ? [
              {
                title: newNotificationForm.title,
                summary: newNotificationForm.summary,
                referenceNo: newNotificationForm.referenceNo,
                notificationDate: newNotificationForm.notificationDate || null,
              },
            ]
          : [],
        interval_days: Number(reminderForm.intervalDays),
      });

      if (payload.newCount > 0) {
        await notifyNewGibTebligat(payload.newCount);
      }

      setNewNotificationForm({ title: "", summary: "", referenceNo: "", notificationDate: "" });
      await loadData();
      showToast(`GİB kontrolü tamamlandı. Yeni kayıt: ${payload.newCount || 0}`);
    } catch (error) {
      showToast(error?.message || "GİB kontrolü başarısız.", "error");
    } finally {
      setIsBusy(false);
    }
  };

  const handleBulkCheck = async () => {
    if (!selectedCompanyIds.length) {
      showToast("Toplu kontrol için en az bir firma seçin.", "error");
      return;
    }

    setIsBusy(true);
    let newTotal = 0;

    try {
      for (const companyId of selectedCompanyIds) {
        const payload = await runGibCheckRequest({
          company_id: companyId,
          verification_code: verificationCode,
          found_notifications: [],
          interval_days: Number(reminderForm.intervalDays),
        });
        newTotal += Number(payload.newCount || 0);
      }

      if (newTotal > 0) {
        await notifyNewGibTebligat(newTotal);
      }

      await loadData();
      showToast(
        `Toplu GİB kontrolü tamamlandı (${selectedCompanyIds.length} firma). Yeni kayıt: ${newTotal}`
      );
    } catch (error) {
      showToast(error?.message || "Toplu kontrol başarısız.", "error");
    } finally {
      setIsBusy(false);
    }
  };

  const markAsRead = async (row) => {
    try {
      await patchOfficialNotification(row.id, { status: "read" });
      await loadData();
    } catch (error) {
      showToast(error?.message || "Durum güncellenemedi.", "error");
    }
  };

  return (
    <div className="space-y-6">
      {toast ? (
        <div
          role="status"
          className={`rounded-xl border px-4 py-3 text-sm ${
            toast.type === "success"
              ? "border-emerald-700 bg-emerald-950 text-emerald-200"
              : "border-red-700 bg-red-950 text-red-200"
          }`}
        >
          {toast.message}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatCard title="Toplam GİB kaydı" value={notifications.length} />
        <StatCard
          title="Okunmamış"
          value={notifications.filter((row) => row.status === "unread").length}
          tone="warning"
        />
        <StatCard title="Takip edilen firma" value={reminderMap.size || companies.length} />
      </div>

      <section className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
        <h2 className="text-lg font-semibold">Doğrulama Kodu & Kontrol</h2>
        <p className="mt-1 text-sm text-gray-400">
          GİB e-Tebligat portalından aldığınız doğrulama kodunu manuel girin. Sistem otomatik kod
          almaz; kontrol sonrası bulduğunuz tebligatları kaydedebilirsiniz.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-sm text-gray-400">Doğrulama kodu</span>
            <input
              value={verificationCode}
              onChange={(event) => setVerificationCode(event.target.value)}
              placeholder="SMS / uygulama kodu"
              className={inputClassName}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm text-gray-400">Tek firma kontrolü</span>
            <div className="flex gap-2">
              <select
                value={selectedCompanyId}
                onChange={(event) => setSelectedCompanyId(event.target.value)}
                className={inputClassName}
              >
                <option value="">Firma seçin</option>
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {getCompanyDisplayName(company)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={isBusy || !selectedCompanyId}
                onClick={() => runSingleCheck(selectedCompanyId)}
                className="shrink-0 rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold hover:bg-violet-500 disabled:opacity-50"
              >
                Kontrol Et
              </button>
            </div>
          </label>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-4">
          <label className="block">
            <span className="mb-1 block text-sm text-gray-400">Tebligat başlığı (opsiyonel)</span>
            <input
              value={newNotificationForm.title}
              onChange={(event) =>
                setNewNotificationForm((current) => ({ ...current, title: event.target.value }))
              }
              className={inputClassName}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-gray-400">Referans no</span>
            <input
              value={newNotificationForm.referenceNo}
              onChange={(event) =>
                setNewNotificationForm((current) => ({
                  ...current,
                  referenceNo: event.target.value,
                }))
              }
              className={inputClassName}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-gray-400">Tebligat tarihi</span>
            <input
              type="date"
              value={newNotificationForm.notificationDate}
              onChange={(event) =>
                setNewNotificationForm((current) => ({
                  ...current,
                  notificationDate: event.target.value,
                }))
              }
              className={inputClassName}
            />
          </label>
          <label className="block lg:col-span-1 xl:col-span-1">
            <span className="mb-1 block text-sm text-gray-400">Özet</span>
            <input
              value={newNotificationForm.summary}
              onChange={(event) =>
                setNewNotificationForm((current) => ({ ...current, summary: event.target.value }))
              }
              className={inputClassName}
            />
          </label>
        </div>
      </section>

      <section className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Toplu GİB Kontrolü</h2>
            <p className="text-sm text-gray-400">
              Seçili firmalar için aynı doğrulama kodu ile kontrol kaydı oluşturulur.
            </p>
          </div>
          <button
            type="button"
            disabled={isBusy || isLoading}
            onClick={handleBulkCheck}
            className="rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold hover:bg-indigo-500 disabled:opacity-50"
          >
            Toplu GİB Kontrolü
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
          {companies.map((company) => {
            const reminder = reminderMap.get(company.id);
            const selected = selectedCompanyIds.includes(company.id);
            return (
              <label
                key={company.id}
                className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${
                  selected
                    ? "border-violet-600 bg-violet-950/20"
                    : "border-gray-800 bg-gray-950/40 hover:border-gray-700"
                }`}
              >
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => toggleCompanySelection(company.id)}
                  className="mt-1"
                />
                <span>
                  <span className="block font-medium">{getCompanyDisplayName(company)}</span>
                  <span className="mt-1 block text-xs text-gray-400">
                    Son kontrol: {formatTrDate(reminder?.last_check_at)}
                  </span>
                  <span className="block text-xs text-gray-500">
                    Sonraki: {formatTrDate(reminder?.next_check_at)}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
        <h2 className="text-lg font-semibold">Hatırlatma & Push Bildirimleri</h2>
        <p className="mt-1 text-sm text-gray-400">
          Kontrol periyodu ve mobil bildirim tercihlerini buradan yönetin.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={reminderForm.enabled}
              onChange={(event) =>
                setReminderForm((current) => ({ ...current, enabled: event.target.checked }))
              }
            />
            Hatırlatma aktif
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={reminderForm.pushEnabled}
              onChange={(event) =>
                setReminderForm((current) => ({ ...current, pushEnabled: event.target.checked }))
              }
            />
            Push bildirimleri
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-gray-400">Kontrol aralığı (gün)</span>
            <input
              type="number"
              min="1"
              value={reminderForm.intervalDays}
              onChange={(event) =>
                setReminderForm((current) => ({
                  ...current,
                  intervalDays: event.target.value,
                }))
              }
              className={inputClassName}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-gray-400">Hatırlatma saati</span>
            <input
              type="time"
              value={reminderForm.reminderTime}
              onChange={(event) =>
                setReminderForm((current) => ({
                  ...current,
                  reminderTime: event.target.value,
                }))
              }
              className={inputClassName}
            />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={isBusy}
            onClick={handleSaveReminder}
            className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold hover:bg-emerald-500 disabled:opacity-50"
          >
            Hatırlatmayı Kaydet
          </button>
          <button
            type="button"
            onClick={handleEnablePush}
            className="rounded-xl border border-gray-700 px-4 py-2 text-sm font-semibold hover:bg-gray-800"
          >
            Bildirim İzni Ver
          </button>
        </div>
      </section>

      <section className="overflow-x-auto rounded-2xl border border-gray-800 bg-gray-900">
        <div className="border-b border-gray-800 px-5 py-4">
          <h2 className="text-lg font-semibold">GİB e-Tebligat Kayıtları</h2>
        </div>
        <table className="w-full min-w-[880px] text-sm">
          <thead className="bg-gray-800/80 text-gray-300">
            <tr>
              <th className="p-3 text-left">Firma</th>
              <th className="p-3 text-left">Başlık</th>
              <th className="p-3 text-left">Referans</th>
              <th className="p-3 text-left">Tarih</th>
              <th className="p-3 text-left">Durum</th>
              <th className="p-3 text-left">İşlem</th>
            </tr>
          </thead>
          <tbody>
            {notifications.map((row) => {
              const company = companies.find((item) => item.id === row.company_id);
              return (
                <tr key={row.id} className="border-t border-gray-800">
                  <td className="p-3">{company ? getCompanyDisplayName(company) : row.company_id}</td>
                  <td className="p-3">
                    <div>{row.title}</div>
                    {row.summary ? (
                      <div className="text-xs text-gray-400">{row.summary}</div>
                    ) : null}
                  </td>
                  <td className="p-3">{row.reference_no || "—"}</td>
                  <td className="p-3">{formatTrDate(row.notification_date || row.created_at)}</td>
                  <td className="p-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        row.status === "unread"
                          ? "bg-amber-900/60 text-amber-100"
                          : "bg-emerald-900/60 text-emerald-100"
                      }`}
                    >
                      {row.status === "unread" ? "Okunmadı" : "Okundu"}
                    </span>
                  </td>
                  <td className="p-3">
                    {row.status === "unread" ? (
                      <button
                        type="button"
                        onClick={() => markAsRead(row)}
                        className="rounded border border-gray-700 px-2 py-1 text-xs hover:bg-gray-800"
                      >
                        Okundu işaretle
                      </button>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!notifications.length ? (
          <p className="p-6 text-sm text-gray-400">Henüz GİB tebligat kaydı yok.</p>
        ) : null}
      </section>
    </div>
  );
}

function StatCard({ title, value, tone = "neutral" }) {
  const toneClasses = {
    neutral: "border-gray-700 bg-gray-950",
    warning: "border-amber-800 bg-amber-950/30 text-amber-200",
  };

  return (
    <div className={`rounded-xl border p-4 ${toneClasses[tone] || toneClasses.neutral}`}>
      <div className="text-sm text-gray-400">{title}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
    </div>
  );
}
