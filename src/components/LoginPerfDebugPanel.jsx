"use client";

import { useEffect, useState } from "react";
import {
  AUTH_PERF_EVENT,
  armAuthPerfDiagnosticsFromQuery,
  buildAuthPerfRows,
  clearAuthPerfRun,
  getAuthPerfDurations,
  isAuthPerfDiagnosticsEnabled,
  readAuthPerfRun,
} from "@/src/lib/auth/loginPerfDiagnostics";

/**
 * Yalnız staging + ?auth_perf=1 (veya armed session) iken görünür.
 * Hassas veri göstermez.
 */
export default function LoginPerfDebugPanel() {
  const [enabled, setEnabled] = useState(false);
  const [rows, setRows] = useState([]);
  const [durations, setDurations] = useState(null);

  useEffect(() => {
    armAuthPerfDiagnosticsFromQuery();
    const refresh = () => {
      const on = isAuthPerfDiagnosticsEnabled();
      setEnabled(on);
      if (!on) {
        setRows([]);
        setDurations(null);
        return;
      }
      const run = readAuthPerfRun();
      if (!run) {
        setRows([]);
        setDurations(null);
        return;
      }
      setRows(buildAuthPerfRows(run));
      setDurations(getAuthPerfDurations(run));
    };
    refresh();
    window.addEventListener(AUTH_PERF_EVENT, refresh);
    return () => window.removeEventListener(AUTH_PERF_EVENT, refresh);
  }, []);

  if (!enabled || !durations || rows.length === 0) return null;

  const fmt = (v) => (v == null ? "—" : `${v} ms`);

  return (
    <aside
      aria-label="Auth performans ölçümü"
      className="fixed bottom-3 right-3 z-[9999] max-h-[70vh] w-[min(100vw-1.5rem,22rem)] overflow-auto rounded-xl border border-amber-700/50 bg-black/90 p-3 text-xs text-amber-50 shadow-xl backdrop-blur"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="font-semibold tracking-wide text-amber-200">
          AUTH PERF · {durations.id}
        </p>
        <button
          type="button"
          onClick={() => clearAuthPerfRun()}
          className="rounded border border-amber-800/60 px-2 py-0.5 text-[10px] text-amber-200/80 hover:bg-amber-950/60"
        >
          Temizle
        </button>
      </div>
      <dl className="mb-2 grid grid-cols-2 gap-x-2 gap-y-1 text-[11px]">
        <dt className="text-amber-200/70">Supabase login</dt>
        <dd>{fmt(durations.supabase_login_ms)}</dd>
        <dt className="text-amber-200/70">Return-to</dt>
        <dd>{fmt(durations.return_to_ms)}</dd>
        <dt className="text-amber-200/70">Navigation</dt>
        <dd>{fmt(durations.navigation_ms)}</dd>
        <dt className="text-amber-200/70">AuthGate</dt>
        <dd>{fmt(durations.auth_gate_ms)}</dd>
        <dt className="text-amber-200/70">ANNVERO shell</dt>
        <dd>{fmt(durations.shell_ms)}</dd>
        <dt className="text-amber-200/70">Toplam</dt>
        <dd className="font-semibold text-amber-100">{fmt(durations.total_ms)}</dd>
      </dl>
      <table className="w-full border-collapse text-[10px]">
        <thead>
          <tr className="text-left text-amber-200/60">
            <th className="py-0.5 pr-1">stage</th>
            <th className="py-0.5 pr-1">Δ</th>
            <th className="py-0.5">Σ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.stage}-${row.ms_from_start}`}>
              <td className="py-0.5 pr-1 font-mono text-amber-50/90">
                {row.stage}
                {!row.ok ? " !" : ""}
              </td>
              <td className="py-0.5 pr-1 tabular-nums">{row.ms_step}</td>
              <td className="py-0.5 tabular-nums">{row.ms_from_start}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </aside>
  );
}
