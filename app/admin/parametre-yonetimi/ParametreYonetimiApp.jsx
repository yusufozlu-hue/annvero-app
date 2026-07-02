"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { MEVZUAT_MODULE_TABS, formatParameterDisplayValue } from "@/src/config/mevzuatParameterSeeds";
import { useAdminAccess } from "@/src/hooks/useAdminAccess";

const inputClass =
  "w-full min-w-[120px] rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white outline-none focus:border-violet-500";

function cloneRows(rows) {
  return rows.map((row) => ({ ...row }));
}

export default function ParametreYonetimiApp() {
  const router = useRouter();
  const { isAdmin, loading: adminLoading } = useAdminAccess();
  const [activeModule, setActiveModule] = useState(MEVZUAT_MODULE_TABS[0].key);
  const [rows, setRows] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState("");
  const [infoMessage, setInfoMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!adminLoading && !isAdmin) {
      router.replace("/dashboard?error=admin_required");
    }
  }, [adminLoading, isAdmin, router]);

  useEffect(() => {
    if (!isAdmin) return;

    let active = true;

    async function loadRows() {
      setLoading(true);
      setInfoMessage("");
      setErrorMessage("");
      try {
        const response = await fetch(
          `/api/admin/mevzuat-parametreleri?module_key=${encodeURIComponent(activeModule)}`,
          { cache: "no-store", credentials: "include" }
        );
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Parametreler okunamadı.");
        }

        if (active) {
          setRows(cloneRows(data.rows || []));
          setDrafts({});
          if (data.meta?.notice) {
            setInfoMessage(data.meta.notice);
          }
        }
      } catch (error) {
        if (active) {
          setErrorMessage(
            error instanceof Error ? error.message : "Parametreler okunamadı."
          );
          setRows([]);
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    loadRows();
    return () => {
      active = false;
    };
  }, [activeModule, isAdmin]);

  const editableRows = useMemo(
    () =>
      rows.map((row) => ({
        ...row,
        ...(drafts[row.id] || {}),
      })),
    [rows, drafts]
  );

  const startEdit = (row) => {
    setDrafts((prev) => ({
      ...prev,
      [row.id]: { ...row },
    }));
  };

  const updateDraft = (id, field, value) => {
    setDrafts((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] || rows.find((row) => row.id === id) || {}),
        [field]: value,
      },
    }));
  };

  const saveRow = async (row) => {
    setSavingId(row.id);
    setErrorMessage("");
    try {
      const response = await fetch("/api/admin/mevzuat-parametreleri", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(row),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Kayıt başarısız.");
      }

      if (data.row) {
        setRows((prev) =>
          prev.map((item) => (item.id === row.id ? { ...item, ...data.row } : item))
        );
      }
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[row.id];
        return next;
      });
      setInfoMessage(data.meta?.notice ? data.meta.notice : "Parametre kaydedildi.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Kayıt başarısız.");
    } finally {
      setSavingId("");
    }
  };

  if (adminLoading || !isAdmin) {
    return (
      <div className="rounded-2xl border border-gray-800 bg-gray-900 p-8 text-center text-gray-400">
        Yetki kontrol ediliyor...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link
            href="/dashboard"
            className="text-sm font-semibold text-violet-300 transition hover:text-violet-100"
          >
            ← Dashboard
          </Link>
          <h1 className="mt-3 text-3xl font-bold text-white">Mevzuat Parametre Yönetimi</h1>
          <p className="mt-2 text-sm text-gray-400">
            Mevzuat parametrelerini modül bazında görüntüleyin ve güncelleyin.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 rounded-2xl border border-gray-800 bg-gray-900/80 p-2">
        {MEVZUAT_MODULE_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveModule(tab.key)}
            className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
              activeModule === tab.key
                ? "bg-violet-600 text-white"
                : "text-gray-300 hover:bg-gray-800 hover:text-white"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {infoMessage ? (
        <div className="rounded-xl border border-amber-700/40 bg-amber-950/30 px-4 py-3 text-sm text-amber-100">
          {infoMessage}
        </div>
      ) : null}

      {errorMessage ? (
        <div className="rounded-xl border border-red-700/40 bg-red-950/30 px-4 py-3 text-sm text-red-100">
          {errorMessage}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-gray-800 bg-gray-900/80">
        <div className="overflow-x-auto">
          <table className="min-w-[1400px] w-full text-left text-sm">
            <thead className="bg-gray-950 text-xs uppercase tracking-wide text-gray-400">
              <tr>
                <th className="px-4 py-3">Parametre Adı</th>
                <th className="px-4 py-3">Yıl</th>
                <th className="px-4 py-3">Dönem / Ay</th>
                <th className="px-4 py-3">Değer</th>
                <th className="px-4 py-3">Açıklama</th>
                <th className="px-4 py-3">Geçerlilik Başlangıç</th>
                <th className="px-4 py-3">Geçerlilik Bitiş</th>
                <th className="px-4 py-3">Aktif</th>
                <th className="px-4 py-3">İşlem</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-gray-400">
                    Parametreler yükleniyor...
                  </td>
                </tr>
              ) : editableRows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-gray-400">
                    Bu modül için parametre bulunamadı.
                  </td>
                </tr>
              ) : (
                editableRows.map((row) => {
                  const isEditing = Boolean(drafts[row.id]);
                  return (
                    <tr key={row.id} className="border-t border-gray-800">
                      <td className="px-4 py-3 font-medium text-white">
                        {isEditing ? (
                          <input
                            className={inputClass}
                            value={row.parameter_name || ""}
                            onChange={(e) =>
                              updateDraft(row.id, "parameter_name", e.target.value)
                            }
                          />
                        ) : (
                          row.parameter_name
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <input
                            className={inputClass}
                            value={row.year || ""}
                            onChange={(e) => updateDraft(row.id, "year", e.target.value)}
                          />
                        ) : (
                          row.year
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <input
                            className={inputClass}
                            value={row.period || ""}
                            onChange={(e) => updateDraft(row.id, "period", e.target.value)}
                          />
                        ) : (
                          row.period
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <input
                            className={inputClass}
                            value={row.value || ""}
                            onChange={(e) => updateDraft(row.id, "value", e.target.value)}
                          />
                        ) : (
                          <span
                            className={
                              !row.value || String(row.value).trim() === ""
                                ? "italic text-amber-300"
                                : ""
                            }
                          >
                            {formatParameterDisplayValue(row.value)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <input
                            className={inputClass}
                            value={row.description || ""}
                            onChange={(e) =>
                              updateDraft(row.id, "description", e.target.value)
                            }
                          />
                        ) : (
                          row.description
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <input
                            className={inputClass}
                            value={row.valid_from || ""}
                            onChange={(e) =>
                              updateDraft(row.id, "valid_from", e.target.value)
                            }
                          />
                        ) : (
                          row.valid_from || "-"
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <input
                            className={inputClass}
                            value={row.valid_to || ""}
                            onChange={(e) => updateDraft(row.id, "valid_to", e.target.value)}
                          />
                        ) : (
                          row.valid_to || "-"
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <select
                            className={inputClass}
                            value={row.is_active ? "true" : "false"}
                            onChange={(e) =>
                              updateDraft(row.id, "is_active", e.target.value === "true")
                            }
                          >
                            <option value="true">Aktif</option>
                            <option value="false">Pasif</option>
                          </select>
                        ) : row.is_active ? (
                          <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-300">
                            Aktif
                          </span>
                        ) : (
                          <span className="rounded-full bg-gray-700 px-2.5 py-1 text-xs font-semibold text-gray-300">
                            Pasif
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          {!isEditing ? (
                            <button
                              type="button"
                              onClick={() => startEdit(row)}
                              className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-semibold text-gray-200 hover:bg-gray-800"
                            >
                              Düzenle
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={savingId === row.id}
                              onClick={() => saveRow(row)}
                              className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-60"
                            >
                              {savingId === row.id ? "Kaydediliyor..." : "Kaydet"}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
