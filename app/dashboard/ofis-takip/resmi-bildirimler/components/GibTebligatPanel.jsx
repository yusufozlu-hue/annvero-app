"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  GIB_QUERY_STATUS,
  GIB_QUERY_STATUS_CLASS,
} from "@/src/config/gibQueryStatuses";
import { formatTrDate } from "@/src/utils/gibTebligatEngine";
import {
  fetchGibCompanyRows,
  startGibQuery,
  verifyGibQuery,
} from "@/src/utils/gibTebligatApi";
import { fetchOfficialNotifications } from "@/src/utils/officialNotificationsApi";
import {
  notifyNewGibTebligat,
  requestNotificationPermission,
} from "@/src/utils/pushNotifications";

const inputClassName =
  "w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-white outline-none focus:border-violet-500";

export default function GibTebligatPanel() {
  const [companyRows, setCompanyRows] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [activeSession, setActiveSession] = useState(null);
  const [verificationCode, setVerificationCode] = useState("");
  const [bulkQueue, setBulkQueue] = useState([]);
  const [bulkIndex, setBulkIndex] = useState(0);

  const showToast = (message, type = "success") => setToast({ message, type });

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [rows, notificationRows] = await Promise.all([
        fetchGibCompanyRows(),
        fetchOfficialNotifications({ channel: "gib" }),
      ]);
      setCompanyRows(rows);
      setNotifications(notificationRows);
    } catch (error) {
      showToast(error?.message || "Veriler yüklenemedi.", "error");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const bulkCurrentCompany = useMemo(() => {
    if (!bulkQueue.length) return null;
    return companyRows.find((row) => row.companyId === bulkQueue[bulkIndex]) || null;
  }, [bulkQueue, bulkIndex, companyRows]);

  const resolveStatusLabel = (row) => {
    if (!row.hasGibCredentials) return GIB_QUERY_STATUS.MISSING_CREDENTIALS;
    return row.resultStatus || "—";
  };

  const openVerificationModal = (payload) => {
    setActiveSession(payload);
    setVerificationCode("");
  };

  const closeVerificationModal = () => {
    setActiveSession(null);
    setVerificationCode("");
  };

  const handleQueryCompany = async (companyId, bulkMode = false) => {
    setIsBusy(true);
    try {
      const result = await startGibQuery(companyId);
      if (result.resultStatus === GIB_QUERY_STATUS.AWAITING_VERIFICATION) {
        const company = companyRows.find((row) => row.companyId === companyId);
        openVerificationModal({
          sessionId: result.sessionId,
          companyId,
          companyName: company?.companyName || companyId,
          captchaImage: result.captchaImage,
          bulkMode,
        });
      } else {
        showToast(result.error || result.resultStatus, "error");
      }
      await loadData();
      return result;
    } catch (error) {
      showToast(error.message, "error");
      await loadData();
      return null;
    } finally {
      setIsBusy(false);
    }
  };

  const handleVerify = async () => {
    if (!activeSession?.sessionId) return;

    setIsBusy(true);
    try {
      const result = await verifyGibQuery(activeSession.sessionId, verificationCode);

      if (result.newCount > 0) {
        await notifyNewGibTebligat(result.newCount);
      }

      showToast(
        result.newCount > 0
          ? `${result.newCount} yeni tebligat kaydedildi.`
          : result.resultStatus || "Sorgu tamamlandı."
      );

      closeVerificationModal();
      await loadData();

      if (activeSession.bulkMode && bulkQueue.length) {
        const nextIndex = bulkIndex + 1;
        if (nextIndex < bulkQueue.length) {
          setBulkIndex(nextIndex);
          await handleQueryCompany(bulkQueue[nextIndex], true);
        } else {
          setBulkQueue([]);
          setBulkIndex(0);
          showToast("Toplu sorgulama tamamlandı.");
        }
      }
    } catch (error) {
      showToast(error.message, "error");
      await loadData();
    } finally {
      setIsBusy(false);
    }
  };

  const handleBulkQuery = async () => {
    const targets = companyRows
      .filter((row) => row.hasGibCredentials && row.isGibActive !== false)
      .map((row) => row.companyId);

    if (!targets.length) {
      showToast("Sorgulanacak aktif GİB bilgisi olan firma yok.", "error");
      return;
    }

    await requestNotificationPermission();
    setBulkQueue(targets);
    setBulkIndex(0);
    await handleQueryCompany(targets[0], true);
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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Firma Bazlı GİB e-Tebligat Sorgulama</h2>
          <p className="text-sm text-gray-400">
            Playwright tabanlı GİB robot servisi ile portal sorgusu yapılır; doğrulama kodunu
            sizden alır ve tebligatları kaydeder.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={isBusy || isLoading}
            onClick={handleBulkQuery}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold hover:bg-indigo-500 disabled:opacity-50"
          >
            Tüm Aktif Firmaları Sorgula
          </button>
          <Link
            href="/muhasebe/firma-yonetimi"
            className="rounded-xl border border-gray-700 px-4 py-2 text-sm font-semibold hover:bg-gray-900"
          >
            Firma GİB Ayarları
          </Link>
        </div>
      </div>

      {bulkQueue.length ? (
        <div className="rounded-xl border border-indigo-700/40 bg-indigo-950/20 px-4 py-3 text-sm text-indigo-100">
          Toplu sorgu: {bulkIndex + 1}/{bulkQueue.length}
          {bulkCurrentCompany ? ` — ${bulkCurrentCompany.companyName}` : ""}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-2xl border border-gray-800 bg-gray-900">
        <table className="w-full min-w-[980px] text-sm">
          <thead className="bg-gray-800/80 text-gray-300">
            <tr>
              <th className="p-3 text-left">Firma</th>
              <th className="p-3 text-left">VKN/TCKN</th>
              <th className="p-3 text-left">GİB Bilgisi</th>
              <th className="p-3 text-left">Son Sorgulama</th>
              <th className="p-3 text-left">Sonuç</th>
              <th className="p-3 text-left">İşlem</th>
            </tr>
          </thead>
          <tbody>
            {companyRows.map((row) => {
              const statusLabel = resolveStatusLabel(row);
              return (
                <tr key={row.companyId} className="border-t border-gray-800">
                  <td className="p-3 font-medium">{row.companyName}</td>
                  <td className="p-3">{row.taxNumber || "—"}</td>
                  <td className="p-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        row.hasGibCredentials
                          ? "bg-emerald-900/60 text-emerald-100"
                          : "bg-gray-800 text-gray-300"
                      }`}
                    >
                      {row.hasGibCredentials ? "Var" : "Yok"}
                    </span>
                  </td>
                  <td className="p-3">{formatTrDate(row.lastQueryAt)}</td>
                  <td className="p-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        GIB_QUERY_STATUS_CLASS[statusLabel] || "bg-gray-800 text-gray-300"
                      }`}
                    >
                      {statusLabel}
                    </span>
                  </td>
                  <td className="p-3">
                    <button
                      type="button"
                      disabled={isBusy || !row.hasGibCredentials}
                      onClick={() => handleQueryCompany(row.companyId)}
                      className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold hover:bg-violet-500 disabled:opacity-40"
                    >
                      Sorgula
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!companyRows.length && !isLoading ? (
          <p className="p-6 text-sm text-gray-400">Aktif firma bulunamadı.</p>
        ) : null}
      </div>

      <section className="overflow-x-auto rounded-2xl border border-gray-800 bg-gray-900">
        <div className="border-b border-gray-800 px-5 py-4">
          <h2 className="text-lg font-semibold">Kayıtlı GİB Tebligatları</h2>
        </div>
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-gray-800/80 text-gray-300">
            <tr>
              <th className="p-3 text-left">Başlık</th>
              <th className="p-3 text-left">Referans</th>
              <th className="p-3 text-left">Tarih</th>
              <th className="p-3 text-left">Durum</th>
            </tr>
          </thead>
          <tbody>
            {notifications.slice(0, 100).map((row) => (
              <tr key={row.id} className="border-t border-gray-800">
                <td className="p-3">{row.title}</td>
                <td className="p-3">{row.reference_no || "—"}</td>
                <td className="p-3">{formatTrDate(row.served_date || row.notification_date || row.created_at)}</td>
                <td className="p-3">{row.status === "unread" ? "Okunmadı" : "Okundu"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!notifications.length ? (
          <p className="p-6 text-sm text-gray-400">Henüz tebligat kaydı yok.</p>
        ) : null}
      </section>

      {activeSession ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-gray-700 bg-gray-900 p-6 shadow-2xl">
            <h3 className="text-xl font-semibold">Doğrulama Kodu — {activeSession.companyName}</h3>
            <p className="mt-2 text-sm text-gray-400">
              GİB portalından gelen doğrulama kodunu aşağıya yazın. Sistem kodu otomatik iletir.
            </p>

            {activeSession.captchaImage ? (
              <div className="mt-4 overflow-hidden rounded-xl border border-gray-700 bg-white p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={activeSession.captchaImage}
                  alt="GİB doğrulama kodu"
                  className="mx-auto max-h-24 object-contain"
                />
              </div>
            ) : null}

            <label className="mt-4 block">
              <span className="mb-1 block text-sm text-gray-400">Doğrulama kodu</span>
              <input
                value={verificationCode}
                onChange={(event) => setVerificationCode(event.target.value)}
                className={inputClassName}
                autoFocus
              />
            </label>

            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={isBusy}
                onClick={handleVerify}
                className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold hover:bg-violet-500 disabled:opacity-50"
              >
                Kodu Gönder ve Sorgula
              </button>
              <button
                type="button"
                disabled={isBusy}
                onClick={closeVerificationModal}
                className="rounded-xl border border-gray-700 px-4 py-2 text-sm font-semibold hover:bg-gray-800"
              >
                İptal
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
