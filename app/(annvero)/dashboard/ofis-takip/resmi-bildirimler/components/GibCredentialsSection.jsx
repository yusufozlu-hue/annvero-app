"use client";

import { useEffect, useState } from "react";
import { fetchGibCredentials, saveGibCredentials } from "@/src/utils/gibTebligatApi";

const inputClassName =
  "w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-white outline-none focus:border-violet-500";

const GIB_SECURE_SAVE_MESSAGE =
  "GİB e-Tebligat bilgileri güvenli şekilde kaydedildi";

export default function GibCredentialsSection({
  companyId,
  companyName,
  onNotify,
  onSaved,
}) {
  const [form, setForm] = useState({
    gibUserCode: "",
    password: "",
    parola: "",
    isActive: true,
  });
  const [masked, setMasked] = useState({ password: "", parola: "" });
  const [hasExisting, setHasExisting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    if (!companyId) return;

    setIsLoading(true);
    fetchGibCredentials(companyId)
      .then((rows) => {
        const row = rows[0];
        if (!row) {
          setHasExisting(false);
          setMasked({ password: "", parola: "" });
          setForm({
            gibUserCode: "",
            password: "",
            parola: "",
            isActive: true,
          });
          return;
        }

        setHasExisting(true);
        setMasked({
          password: row.passwordMasked || "••••••••",
          parola: row.parolaMasked || "",
        });
        setForm({
          gibUserCode: row.gibUserCode || "",
          password: "",
          parola: "",
          isActive: row.isActive !== false,
        });
      })
      .catch((error) => setMessage({ type: "error", text: error.message }))
      .finally(() => setIsLoading(false));
  }, [companyId]);

  const handleSave = async () => {
    if (!companyId) return;

    setIsSaving(true);
    setMessage(null);

    try {
      await saveGibCredentials({
        companyId,
        gibUserCode: form.gibUserCode,
        password: form.password,
        parola: form.parola,
        isActive: form.isActive,
        keepExistingSecrets: hasExisting && !form.password && !form.parola,
      });

      if (onNotify) {
        onNotify(GIB_SECURE_SAVE_MESSAGE, "success");
      } else {
        setMessage({ type: "success", text: GIB_SECURE_SAVE_MESSAGE });
      }
      setHasExisting(true);
      setMasked({
        password: form.password ? "••••••••" : masked.password || "••••••••",
        parola: form.parola ? "••••••••" : masked.parola,
      });
      setForm((current) => ({ ...current, password: "", parola: "" }));
      onSaved?.();
    } catch (error) {
      if (onNotify) {
        onNotify(error.message, "error");
      } else {
        setMessage({ type: "error", text: error.message });
      }
    } finally {
      setIsSaving(false);
    }
  };

  if (!companyId) {
    return (
      <div className="rounded-xl border border-dashed border-gray-700 p-6 text-sm text-gray-400">
        GİB bilgilerini düzenlemek için önce bir firma seçin.
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border border-violet-800/40 bg-violet-950/10 p-5">
      <div>
        <h3 className="text-lg font-semibold text-violet-100">GİB e-Tebligat Bilgileri</h3>
        <p className="mt-1 text-sm text-gray-400">
          {companyName} için GİB giriş bilgileri şifreli olarak saklanır. Şifreler ekranda
          maskelenir ve çözülerek gösterilmez.
        </p>
      </div>

      {message ? (
        <div
          className={`rounded-lg border px-3 py-2 text-sm ${
            message.type === "success"
              ? "border-emerald-700 bg-emerald-950 text-emerald-200"
              : "border-red-700 bg-red-950 text-red-200"
          }`}
        >
          {message.text}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm text-gray-400">GİB kullanıcı kodu</span>
          <input
            value={form.gibUserCode}
            disabled={isLoading}
            onChange={(event) =>
              setForm((current) => ({ ...current, gibUserCode: event.target.value }))
            }
            className={inputClassName}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm text-gray-400">GİB şifre</span>
          <input
            type="password"
            value={form.password}
            placeholder={hasExisting ? masked.password || "••••••••" : "Yeni şifre"}
            disabled={isLoading}
            onChange={(event) =>
              setForm((current) => ({ ...current, password: event.target.value }))
            }
            className={inputClassName}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm text-gray-400">GİB parola (varsa)</span>
          <input
            type="password"
            value={form.parola}
            placeholder={masked.parola || "Opsiyonel"}
            disabled={isLoading}
            onChange={(event) =>
              setForm((current) => ({ ...current, parola: event.target.value }))
            }
            className={inputClassName}
          />
        </label>

        <label className="flex items-center gap-2 self-end text-sm">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(event) =>
              setForm((current) => ({ ...current, isActive: event.target.checked }))
            }
          />
          GİB sorgulaması aktif
        </label>
      </div>

      <button
        type="button"
        disabled={isSaving || isLoading}
        onClick={handleSave}
        className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold hover:bg-violet-500 disabled:opacity-50"
      >
        GİB Bilgilerini Kaydet
      </button>
    </div>
  );
}
