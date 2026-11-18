import { FolderCheck, Loader2, RefreshCw, RotateCcw, SlidersHorizontal } from "lucide-react";
import type { DashboardTelemetry, EngineType } from "../types/triage";

interface TopOperationalBarProps {
  telemetry: DashboardTelemetry;
  selectedEngine: EngineType;
  isBatchTriaging: boolean;
  isResetting?: boolean;
  onSelectEngine: (engine: EngineType) => void;
  onTriageQueue: () => void;
  onOpenSystemConfig: () => void;
  onOpenCasesModal: () => void;
  onResetDemo?: () => void;
}

export function TopOperationalBar({
  telemetry,
  selectedEngine,
  isBatchTriaging,
  isResetting = false,
  onSelectEngine,
  onTriageQueue,
  onOpenSystemConfig,
  onOpenCasesModal,
  onResetDemo,
}: TopOperationalBarProps) {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 lg:px-5">
        {/* Club identity */}
        <div className="flex items-center gap-2.5">
          <div
            aria-hidden="true"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-900 text-[11px] font-bold tracking-wider text-white"
          >
            NB
          </div>
          <h1 className="text-sm font-semibold tracking-tight text-slate-900">
            Northbank FC - Member Services
          </h1>
        </div>

        {/* Engine switch & queue actions */}
        <div className="flex flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label="Triage engine selector"
            className="inline-flex rounded-md border border-slate-300 bg-slate-100 p-0.5"
          >
            <button
              type="button"
              aria-pressed={selectedEngine === "jev"}
              onClick={() => onSelectEngine("jev")}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                selectedEngine === "jev"
                  ? "bg-white text-slate-900 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Jev
            </button>
            <button
              type="button"
              aria-pressed={selectedEngine === "claude"}
              onClick={() => onSelectEngine("claude")}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                selectedEngine === "claude"
                  ? "bg-white text-slate-900 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Claude
            </button>
          </div>

          <button
            type="button"
            onClick={onTriageQueue}
            disabled={isBatchTriaging}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-900 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-wait disabled:opacity-60"
          >
            {isBatchTriaging ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <span>
              {isBatchTriaging
                ? `Triaging (${selectedEngine === "jev" ? "Jev" : "Claude"})…`
                : `Re-triage Queue (${selectedEngine === "jev" ? "Jev" : "Claude"})`}
            </span>
          </button>

          <button
            type="button"
            onClick={onOpenCasesModal}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            <FolderCheck className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />
            <span>Cases ({telemetry.approved_cases_count})</span>
          </button>

          <button
            type="button"
            onClick={onOpenSystemConfig}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            <SlidersHorizontal className="h-3.5 w-3.5 text-slate-600" aria-hidden="true" />
            <span>Engines &amp; Latency</span>
          </button>

          {onResetDemo ? (
            <button
              type="button"
              onClick={onResetDemo}
              disabled={isResetting || isBatchTriaging}
              aria-label="Reset demo state"
              className="inline-flex min-h-6 min-w-6 items-center justify-center rounded-md border border-slate-200 bg-white p-1.5 text-slate-400 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-700 disabled:cursor-wait disabled:opacity-50"
            >
              <RotateCcw
                className={`h-3.5 w-3.5 ${isResetting ? "animate-spin" : ""}`}
                aria-hidden="true"
              />
            </button>
          ) : null}
        </div>
      </div>
    </header>
  );
}
