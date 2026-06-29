import { DOCUMENT_TYPE_OPTIONS } from "@/src/utils/previewRowEdit";

export default function PreviewVoucherDetailPanel({
  draft,
  onChange,
  onSave,
  onCancel,
  cariOptions = [],
  isSaving = false,
}) {
  if (!draft) return null;

  const updateField = (field, value) => {
    onChange({ ...draft, [field]: value });
  };

  return (
    <div className="rounded-xl border border-indigo-700/50 bg-slate-950 p-4">
      <h4 className="mb-4 text-base font-semibold text-slate-100">
        Fiş Satırı Düzenle
      </h4>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <PreviewField label="Hesap Kodu">
          <input
            value={draft.accountCode}
            onChange={(event) => updateField("accountCode", event.target.value)}
            className={inputClassName}
          />
        </PreviewField>

        <PreviewField label="Karşı Hesap">
          <input
            value={draft.counterAccountCode || ""}
            onChange={(event) =>
              updateField("counterAccountCode", event.target.value)
            }
            className={inputClassName}
          />
        </PreviewField>

        <PreviewField label="Belge Türü">
          <select
            value={draft.documentType}
            onChange={(event) => updateField("documentType", event.target.value)}
            className={inputClassName}
          >
            {DOCUMENT_TYPE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </PreviewField>

        <PreviewField label="Açıklama" className="md:col-span-3">
          <input
            value={draft.description}
            onChange={(event) => updateField("description", event.target.value)}
            className={inputClassName}
          />
        </PreviewField>

        <PreviewField label="Borç">
          <input
            value={draft.borc}
            onChange={(event) => updateField("borc", event.target.value)}
            className={inputClassName}
          />
        </PreviewField>

        <PreviewField label="Alacak">
          <input
            value={draft.alacak}
            onChange={(event) => updateField("alacak", event.target.value)}
            className={inputClassName}
          />
        </PreviewField>

        {cariOptions.length > 0 ? (
          <PreviewField label="Cari / Personel Eşleşmesi">
            <select
              value={draft.cariAccountCode}
              onChange={(event) =>
                updateField("cariAccountCode", event.target.value)
              }
              className={inputClassName}
            >
              <option value="">Seçiniz</option>
              {cariOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </PreviewField>
        ) : null}

        <PreviewField label="Kontrol Notu" className="md:col-span-3">
          <input
            value={draft.controlNote}
            onChange={(event) => updateField("controlNote", event.target.value)}
            className={inputClassName}
          />
        </PreviewField>
      </div>

      <label className="mt-4 flex items-center gap-2 text-sm text-slate-300">
        <input
          type="checkbox"
          checked={!!draft.saveToMemory}
          onChange={(event) => updateField("saveToMemory", event.target.checked)}
        />
        Bu düzeltmeyi öğrenen hesap hafızasına kaydet
      </label>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={isSaving}
          className="rounded-lg bg-indigo-600 px-4 py-2 font-semibold hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSaving ? "Kaydediliyor..." : "Kaydet"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isSaving}
          className="rounded-lg bg-slate-700 px-4 py-2 hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          İptal
        </button>
      </div>
    </div>
  );
}

const inputClassName =
  "w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white outline-none focus:border-indigo-500";

function PreviewField({ label, children, className = "" }) {
  return (
    <label className={`block ${className}`}>
      <div className="mb-1 text-sm text-slate-400">{label}</div>
      {children}
    </label>
  );
}
