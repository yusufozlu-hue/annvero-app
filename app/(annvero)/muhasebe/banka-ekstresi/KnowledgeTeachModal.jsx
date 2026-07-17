"use client";

import { useEffect, useState } from "react";
import { KNOWLEDGE_BUILDER_DOCUMENT_TYPES } from "@/src/utils/knowledgeBuilderForm";
import { annveroBtnPrimary, annveroCardClass, annveroInputClass } from "@/src/styles/annveroDesign";

const labelClass = "mb-1 block text-xs font-medium text-slate-400";

const EMPTY_FORM = {
  company_id: "",
  company_name: "",
  keyword: "",
  entity_name: "",
  entity_family: "other",
  transaction_type: "bank_movement",
  source_type: "bank",
  bank_name: "",
  account_code: "",
  account_name: "",
  counter_account_code: "",
  cari: "",
  document_type: "DK",
  vat_rate: "",
  description_template: "",
  risk_level: "low",
  confidence_score: "",
  rule_type: "bank_movement",
  is_global: false,
};

/**
 * CORE 2.0 — sade öğretme: yalnızca gerekli alanlar görünür.
 * Diğer alanlar initialForm'dan sessizce taşınır.
 */
export default function KnowledgeTeachModal({
  open,
  initialForm = {},
  canTeachGlobal = false,
  isSaving = false,
  onClose,
  onSubmit,
}) {
  const [form, setForm] = useState({ ...EMPTY_FORM, ...initialForm });
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({ ...EMPTY_FORM, ...initialForm, is_global: false });
      setShowAdvanced(false);
    }
  }, [open, initialForm]);

  if (!open) return null;

  const setField = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    onSubmit?.({
      ...form,
      description_template: form.description_template || form.keyword,
      entity_name: form.entity_name || form.keyword,
    });
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4">
      <div className={`max-h-[90vh] w-full max-w-lg overflow-y-auto p-6 ${annveroCardClass}`}>
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-white">CORE&apos;a Öğret</h3>
            <p className="mt-1 text-sm text-slate-400">
              Bu işlem firma hafızasına kaydedilir; parser ve CORE bir sonraki seferde tanır.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="rounded-lg border border-slate-700 px-3 py-1 text-sm text-slate-300 hover:bg-slate-800"
          >
            Kapat
          </button>
        </div>

        <p className="mb-4 rounded-lg border border-slate-800/80 bg-slate-950/50 px-3 py-2 text-sm text-slate-300">
          <span className="text-slate-500">Firma: </span>
          {form.company_name || form.company_id || "—"}
          {form.bank_name ? (
            <>
              <span className="mx-2 text-slate-600">·</span>
              <span className="text-slate-500">Banka: </span>
              {form.bank_name}
            </>
          ) : null}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Açıklama *">
            <input
              className={annveroInputClass}
              value={form.keyword}
              onChange={(e) => setField("keyword", e.target.value)}
              required
            />
          </Field>

          <Field label="Hesap kodu *">
            <input
              className={annveroInputClass}
              value={form.account_code}
              onChange={(e) => setField("account_code", e.target.value)}
              required
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Cari">
              <input
                className={annveroInputClass}
                value={form.cari}
                onChange={(e) => setField("cari", e.target.value)}
              />
            </Field>

            <Field label="Belge türü *">
              <select
                className={annveroInputClass}
                value={form.document_type}
                onChange={(e) => setField("document_type", e.target.value)}
                required
              >
                {KNOWLEDGE_BUILDER_DOCUMENT_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="text-xs font-medium text-indigo-300 hover:text-indigo-200"
          >
            {showAdvanced ? "Gelişmiş alanları gizle" : "Gelişmiş alanlar (isteğe bağlı)"}
          </button>

          {showAdvanced ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Entity">
                <input
                  className={annveroInputClass}
                  value={form.entity_name}
                  onChange={(e) => setField("entity_name", e.target.value)}
                />
              </Field>
              <Field label="Hesap adı">
                <input
                  className={annveroInputClass}
                  value={form.account_name}
                  onChange={(e) => setField("account_name", e.target.value)}
                />
              </Field>
              {form.confidence_score !== "" && form.confidence_score != null ? (
                <Field label="CORE güven">
                  <input
                    className={annveroInputClass}
                    value={`${Math.round(Number(form.confidence_score) * 100)}%`}
                    disabled
                    readOnly
                  />
                </Field>
              ) : null}
              {canTeachGlobal ? (
                <div className="sm:col-span-2 rounded-lg border border-amber-800/40 bg-amber-950/20 px-3 py-2">
                  <label className="flex items-center gap-2 text-sm text-amber-100">
                    <input
                      type="checkbox"
                      checked={Boolean(form.is_global)}
                      onChange={(e) => setField("is_global", e.target.checked)}
                    />
                    Global kural (yönetici)
                  </label>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-wrap justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
            >
              Vazgeç
            </button>
            <button type="submit" disabled={isSaving} className={annveroBtnPrimary}>
              {isSaving ? "Kaydediliyor…" : "Kaydet"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className={labelClass}>{label}</label>
      {children}
    </div>
  );
}
