export default function PreviewEyeButton({ active = false, onClick, title = "Detay" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-expanded={active}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border transition ${
        active
          ? "border-indigo-500 bg-indigo-950/60 text-indigo-200"
          : "border-slate-700 bg-slate-950 text-slate-300 hover:border-blue-500 hover:text-white"
      }`}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        className="h-4 w-4"
      >
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    </button>
  );
}
