"use client";

import { useEffect, useState } from "react";
import {
  KNOWLEDGE_BUILDER_DOCUMENT_TYPES,
  KNOWLEDGE_BUILDER_ENTITY_FAMILIES,
  KNOWLEDGE_BUILDER_RISK_LEVELS,
  KNOWLEDGE_BUILDER_SOURCE_TYPES,
} from "@/src/utils/knowledgeBuilderForm";

const labelClass = "mb-1 block text-xs font-medium text-gray-400";
const inputClass =
  "w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white disabled:opacity-60";

const EMPTY_FORM = {
  company_id: "",
  company_name: "",
  keyword: "",
  entity_name: "",
  entity_family: "other",
  transaction_type: "",
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

export default function KnowledgeTeachModal({
  open,
  initialForm = {},
  canTeachGlobal = false,
  isSaving = false,
  onClose,
  onSubmit,
}) {
  const [form, setForm] = useState({ ...EMPTY_FORM, ...initialForm });

  useEffect(() => {
    if (open) {
      setForm({ ...EMPTY_FORM, ...initialForm, is_global: false });
    }
  }, [open, initialForm]);

  if (!open) return null;

  const setField = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    onSubmit?.(form);
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-gray-700 bg-gray-900 p-6 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-xl font-semibold text-white">CORE&apos;a Öğret</h3>
            <p className="mt-1 text-sm text-gray-400">
              Tanınmayan veya düşük güvenli hareket için firma hafızası veya global kural kaydı.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="rounded-lg border border-gray-700 px-3 py-1 text-sm text-gray-300 hover:bg-gray-800"
          >
            Kapat
          </button>
        </div>

        <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Firma">
            <input
              className={inputClass}
              value={form.company_name || form.company_id}
              disabled
              readOnly
            />
          </Field>

          <Field label="Açıklama / keyword *">
            <input
              className={inputClass}
              value={form.keyword}
              onChange={(e) => setField("keyword", e.target.value)}
              required
            />
          </Field>

          <Field label="Entity adı">
            <input
              className={inputClass}
              value={form.entity_name}
              onChange={(e) => setField("entity_name", e.target.value)}
              placeholder="Örn: Google"
            />
          </Field>

          <Field label="Entity family / Kural tipi">
            <select
              className={inputClass}
              value={form.entity_family}
              onChange={(e) => setField("entity_family", e.target.value)}
            >
              {KNOWLEDGE_BUILDER_ENTITY_FAMILIES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </Field>

          <Field label="İşlem / kural tipi">
            <input
              className={inputClass}
              value={form.rule_type || form.transaction_type}
              onChange={(e) => {
                setField("rule_type", e.target.value);
                setField("transaction_type", e.target.value);
              }}
            />
          </Field>

          <Field label="Kaynak tipi">
            <select
              className={inputClass}
              value={form.source_type}
              onChange={(e) => setField("source_type", e.target.value)}
            >
              {KNOWLEDGE_BUILDER_SOURCE_TYPES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Banka">
            <input
              className={inputClass}
              value={form.bank_name}
              onChange={(e) => setField("bank_name", e.target.value)}
            />
          </Field>

          <Field label="Hesap kodu *">
            <input
              className={inputClass}
              value={form.account_code}
              onChange={(e) => setField("account_code", e.target.value)}
              required
            />
          </Field>

          <Field label="Hesap adı">
            <input
              className={inputClass}
              value={form.account_name}
              onChange={(e) => setField("account_name", e.target.value)}
            />
          </Field>

          <Field label="Karşı hesap kodu">
            <input
              className={inputClass}
              value={form.counter_account_code}
              onChange={(e) => setField("counter_account_code", e.target.value)}
            />
          </Field>

          <Field label="Cari">
            <input
              className={inputClass}
              value={form.cari}
              onChange={(e) => setField("cari", e.target.value)}
            />
          </Field>

          <Field label="Belge türü *">
            <select
              className={inputClass}
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

          <Field label="KDV oranı">
            <input
              className={inputClass}
              type="number"
              step="0.01"
              value={form.vat_rate}
              onChange={(e) => setField("vat_rate", e.target.value)}
            />
          </Field>

          <Field label="Güven skoru (CORE)">
            <input
              className={inputClass}
              value={
                form.confidence_score === "" || form.confidence_score == null
                  ? ""
                  : `${Math.round(Number(form.confidence_score) * 100)}%`
              }
              disabled
              readOnly
            />
          </Field>

          <Field label="Risk seviyesi">
            <select
              className={inputClass}
              value={form.risk_level}
              onChange={(e) => setField("risk_level", e.target.value)}
            >
              {KNOWLEDGE_BUILDER_RISK_LEVELS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </Field>

          <div className="md:col-span-2">
            <label className={labelClass}>Açıklama şablonu</label>
            <textarea
              className={`${inputClass} min-h-[72px]`}
              value={form.description_template}
              onChange={(e) => setField("description_template", e.target.value)}
            />
          </div>

          {canTeachGlobal ? (
            <div className="md:col-span-2 rounded-lg border border-amber-800/50 bg-amber-950/20 px-3 py-2">
              <label className="flex items-center gap-2 text-sm text-amber-100">
                <input
                  type="checkbox"
                  checked={Boolean(form.is_global)}
                  onChange={(e) => setField("is_global", e.target.checked)}
                />
                Global kural olarak kaydet (yönetici)
              </label>
            </div>
          ) : (
            <p className="md:col-span-2 text-xs text-gray-500">
              Global kural eklemek için yönetim yetkisi gerekir. Bu kayıt firma özel hafızaya yazılır.
            </p>
          )}

          <div className="md:col-span-2 flex flex-wrap justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-200 hover:bg-gray-800"
            >
              Vazgeç
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
            >
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
