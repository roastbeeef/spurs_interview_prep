import { Activity, X } from "lucide-react";
import type { DashboardTelemetry, EngineType } from "../types/triage";
import { formatTimestamp } from "../utils/triageDisplay";
import { NativeDialog } from "./NativeDialog";
import { StatusBadge } from "./StatusBadge";

interface SystemConfigDialogProps {
  open: boolean;
  telemetry: DashboardTelemetry;
  selectedEngine: EngineType;
  onClose: () => void;
}

function formatLatencyMs(ms: number | null | undefined, decimals = 1): string {
  if (ms == null || Number.isNaN(ms)) return "-";
  return `${ms.toFixed(decimals)} ms`;
}

export function SystemConfigDialog({
  open,
  telemetry,
  onClose,
}: SystemConfigDialogProps) {
  const jevAvg = telemetry.jev_avg_latency_ms;
  const claudeAvg = telemetry.claude_avg_latency_ms;
  const jevRunCount = telemetry.jev_run_count ?? 0;
  const claudeRunCount = telemetry.claude_run_count ?? 0;
  const history = telemetry.latency_history ?? [];
  const newestFirstHistory = [...history].reverse();

  const speedupRatio =
    typeof jevAvg === "number" &&
    jevAvg > 0 &&
    typeof claudeAvg === "number" &&
    claudeAvg > 0
      ? claudeAvg / jevAvg
      : null;

  const maxAvg = Math.max(jevAvg ?? 0, claudeAvg ?? 0, 1);

  return (
    <NativeDialog
      open={open}
      onClose={onClose}
      labelledBy="system-config-title"
      maxWidthClass="max-w-3xl"
    >
      <div className="p-5">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-3">
          <h2 id="system-config-title" className="text-base font-semibold text-slate-900">
            Triage Engines &amp; Running Latency Telemetry
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close engines and telemetry dialog"
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-4 space-y-4">
          {/* Measured Running Telemetry */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded border border-slate-200 bg-slate-50 p-2.5">
              <div className="text-[11px] font-medium text-slate-500">Queue Progress</div>
              <div className="mt-1 font-mono text-sm font-semibold text-slate-900 tabular-nums">
                {telemetry.actioned_count} / {telemetry.total_tickets}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-500 tabular-nums">
                {telemetry.pending_count} pending
              </div>
            </div>

            <div className="rounded border border-slate-200 bg-slate-50 p-2.5">
              <div className="text-[11px] font-medium text-slate-500">Jev Running Avg</div>
              <div className="mt-1 font-mono text-sm font-semibold text-slate-900 tabular-nums">
                {formatLatencyMs(jevAvg, 1)}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-500 tabular-nums">
                {jevRunCount} {jevRunCount === 1 ? "eval run" : "eval runs"}
              </div>
            </div>

            <div className="rounded border border-slate-200 bg-slate-50 p-2.5">
              <div className="text-[11px] font-medium text-slate-500">Claude Running Avg</div>
              <div className="mt-1 font-mono text-sm font-semibold text-slate-900 tabular-nums">
                {formatLatencyMs(claudeAvg, 0)}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-500 tabular-nums">
                {claudeRunCount} {claudeRunCount === 1 ? "eval run" : "eval runs"}
              </div>
            </div>

            <div className="rounded border border-slate-200 bg-slate-50 p-2.5">
              <div className="text-[11px] font-medium text-slate-500">Human Agreement</div>
              <div className="mt-1 font-mono text-sm font-semibold text-slate-900 tabular-nums">
                {telemetry.human_model_agreement_rate != null
                  ? `${Math.round(telemetry.human_model_agreement_rate * 100)}%`
                  : "-"}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-500 tabular-nums">
                {telemetry.flywheel_labelled_count} labelled actions
              </div>
            </div>
          </div>

          {/* Running Average Latency History */}
          <section
            aria-label="Running average latency history"
            className="border-t border-slate-200 pt-4"
          >
            <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <Activity className="h-3.5 w-3.5 text-slate-600" aria-hidden="true" />
                <h3 className="text-xs font-semibold text-slate-900">
                  Running Average Latency History
                </h3>
              </div>
              <div className="flex items-center gap-2">
                {speedupRatio !== null ? (
                  <StatusBadge tone="cobalt">
                    Jev{" "}
                    {speedupRatio >= 1
                      ? `${speedupRatio.toFixed(1)}x faster avg`
                      : `${(1 / speedupRatio).toFixed(1)}x slower avg`}
                  </StatusBadge>
                ) : null}
                <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                  {history.length} recent {history.length === 1 ? "run" : "runs"}
                </span>
              </div>
            </div>

            {/* Comparative Running Average Bars */}
            {jevAvg !== null || claudeAvg !== null ? (
              <div className="mb-3 space-y-2 rounded-md border border-slate-200 bg-slate-50/70 p-3 text-xs">
                <div className="grid grid-cols-[100px_minmax(0,1fr)_88px] items-center gap-3">
                  <span className="font-medium text-slate-700">Jev</span>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="h-full rounded-full bg-blue-700"
                      style={{
                        width: jevAvg != null ? `${Math.max(2, (jevAvg / maxAvg) * 100)}%` : "0%",
                      }}
                    />
                  </div>
                  <span className="text-right font-mono font-semibold text-slate-900 tabular-nums">
                    {formatLatencyMs(jevAvg, 1)}
                  </span>
                </div>

                <div className="grid grid-cols-[100px_minmax(0,1fr)_88px] items-center gap-3">
                  <span className="font-medium text-slate-700">Claude</span>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="h-full rounded-full bg-slate-700"
                      style={{
                        width:
                          claudeAvg != null ? `${Math.max(2, (claudeAvg / maxAvg) * 100)}%` : "0%",
                      }}
                    />
                  </div>
                  <span className="text-right font-mono font-semibold text-slate-900 tabular-nums">
                    {formatLatencyMs(claudeAvg, 0)}
                  </span>
                </div>
              </div>
            ) : null}

            {/* Chronological Audit Table */}
            {newestFirstHistory.length === 0 ? (
              <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-xs text-slate-500">
                No historical evaluations recorded yet. Run Jev or Claude on a ticket to record
                latency progression.
              </div>
            ) : (
              <div
                tabIndex={0}
                role="region"
                aria-labelledby="latency-history-caption"
                className="table-wrapper max-h-64"
              >
                <table>
                  <caption id="latency-history-caption" className="visually-hidden">
                    Historical triage latency and cumulative running average per engine
                  </caption>
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
                      <th scope="col" className="px-3 py-2">
                        Run
                      </th>
                      <th scope="col" className="px-3 py-2">
                        Ticket
                      </th>
                      <th scope="col" className="px-3 py-2">
                        Engine
                      </th>
                      <th scope="col" className="px-3 py-2 text-right">
                        Run Latency
                      </th>
                      <th scope="col" className="px-3 py-2 text-right">
                        Running Avg
                      </th>
                      <th scope="col" className="px-3 py-2 text-right">
                        Recorded
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {newestFirstHistory.map((pt) => (
                      <tr key={pt.id}>
                        <th
                          scope="row"
                          className="px-3 py-2 font-mono text-[11px] font-semibold text-slate-700 tabular-nums"
                        >
                          #{pt.run_index}
                        </th>
                        <td data-label="Ticket" className="px-3 py-2 font-mono text-xs text-slate-900">
                          {pt.ticket_id || "-"}
                        </td>
                        <td data-label="Engine" className="px-3 py-2">
                          <StatusBadge tone={pt.engine === "jev" ? "cobalt" : "neutral"}>
                            {pt.engine === "jev" ? "Jev" : "Claude"}
                          </StatusBadge>
                        </td>
                        <td
                          data-label="Run Latency"
                          className="px-3 py-2 text-right font-mono text-xs text-slate-700 tabular-nums"
                        >
                          {pt.latency_ms.toFixed(pt.engine === "jev" ? 1 : 0)} ms
                        </td>
                        <td
                          data-label="Running Avg"
                          className="px-3 py-2 text-right font-mono text-xs font-semibold text-slate-900 tabular-nums"
                        >
                          {pt.running_avg_ms.toFixed(pt.engine === "jev" ? 1 : 0)} ms
                        </td>
                        <td
                          data-label="Recorded"
                          className="px-3 py-2 text-right font-mono text-[11px] text-slate-500 whitespace-nowrap"
                        >
                          {formatTimestamp(pt.at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>
    </NativeDialog>
  );
}
