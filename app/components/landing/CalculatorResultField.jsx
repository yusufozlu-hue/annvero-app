export default function CalculatorResultField({
  label,
  value,
  highlight = false,
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        highlight
          ? "border-violet-200 bg-gradient-to-br from-violet-50 to-white"
          : "border-violet-100 bg-slate-50"
      }`}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p
        className={`mt-1 text-lg font-bold sm:text-xl ${
          highlight ? "text-violet-700" : "text-slate-900"
        }`}
      >
        {value} TL
      </p>
    </div>
  );
}
