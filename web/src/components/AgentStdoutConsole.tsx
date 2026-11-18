import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Loader2, Terminal, Trash2 } from "lucide-react";
import type { ConsoleLogEntry, ConsoleLogStream, EngineType } from "../types/triage";

interface AgentStdoutConsoleProps {
  logs: ConsoleLogEntry[];
  triagingByTicket: Record<string, EngineType>;
  isBatchTriaging: boolean;
  onClear: () => void;
  onSelectTicket?: (ticketId: string) => void;
}

const STREAM_STYLE: Record<ConsoleLogStream, string> = {
  agent: "text-cyan-300",
  jev: "text-emerald-300",
  claude: "text-violet-300",
  mcp: "text-sky-300",
  staff: "text-amber-300",
  error: "text-red-400",
  system: "text-slate-400",
};

export function AgentStdoutConsole({
  logs,
  triagingByTicket,
  isBatchTriaging,
  onClear,
  onSelectTicket,
}: AgentStdoutConsoleProps) {
  const [collapsed, setCollapsed] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);

  const activePairs = Object.entries(triagingByTicket);
  const isActive = isBatchTriaging || activePairs.length > 0;

  useEffect(() => {
    if (!collapsed && viewportRef.current) {
      viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
    }
  }, [logs.length, collapsed]);

  return (
    <section
      aria-label="Agent stdout console"
      className="shrink-0 border-t border-slate-700/80 bg-slate-950 text-slate-200"
    >
      {/* Compact Console Header */}
      <div className="flex h-7 items-center justify-between border-b border-slate-800 bg-slate-900 px-3 text-[11px]">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex items-center gap-1.5 font-mono font-semibold text-slate-200">
            <Terminal className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
            <span>stdout</span>
          </span>

          {isActive ? (
            <span className="inline-flex items-center gap-1 rounded bg-emerald-950/90 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-emerald-300 ring-1 ring-emerald-700/70">
              <Loader2 className="h-2.5 w-2.5 animate-spin" aria-hidden="true" />
              <span>
                AGENT ACTIVE
                {activePairs.length === 1
                  ? ` - ${activePairs[0][1]} (${activePairs[0][0]})`
                  : isBatchTriaging
                    ? " - batch"
                    : ` - ${activePairs.length} running`}
              </span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
              <span className="h-1.5 w-1.5 rounded-full bg-slate-500" aria-hidden="true" />
              <span>IDLE</span>
            </span>
          )}

          <span className="hidden font-mono text-[10px] text-slate-500 tabular-nums sm:inline">
            {logs.length} {logs.length === 1 ? "line" : "lines"}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onClear}
            disabled={logs.length === 0}
            aria-label="Clear stdout console"
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100 disabled:opacity-40"
          >
            <Trash2 className="h-3 w-3" aria-hidden="true" />
            <span>Clear</span>
          </button>

          <button
            type="button"
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Show stdout console" : "Hide stdout console"}
            onClick={() => setCollapsed((v) => !v)}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
          >
            {collapsed ? (
              <>
                <ChevronUp className="h-3 w-3" aria-hidden="true" />
                <span>Show</span>
              </>
            ) : (
              <>
                <ChevronDown className="h-3 w-3" aria-hidden="true" />
                <span>Hide</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* 4-5 row scrollable monospace log viewport */}
      {!collapsed ? (
        <div
          ref={viewportRef}
          role="log"
          aria-live="polite"
          aria-label="Agent stdout log output"
          className="h-24 overflow-y-auto px-3 py-1 font-mono text-[11px] leading-[18px] text-slate-200"
        >
          {logs.length === 0 ? (
            <div className="py-1 text-slate-500">
              stdout cleared - waiting for next agent or MCP call…
            </div>
          ) : (
            logs.map((entry) => (
              <div key={entry.id} className="flex items-start gap-1.5 whitespace-pre-wrap break-words">
                <span className="shrink-0 text-slate-500 tabular-nums select-none">
                  [{entry.timestamp}]
                </span>
                <span className={`shrink-0 font-semibold ${STREAM_STYLE[entry.stream]}`}>
                  [{entry.stream}]
                </span>
                {entry.ticketId ? (
                  <button
                    type="button"
                    onClick={() => onSelectTicket?.(entry.ticketId!)}
                    className="shrink-0 rounded bg-slate-800/90 px-1 text-[10px] font-semibold text-blue-300 hover:bg-slate-700 hover:text-blue-200"
                  >
                    {entry.ticketId}
                  </button>
                ) : null}
                <span
                  className={
                    entry.stream === "error"
                      ? "text-red-300"
                      : entry.stream === "agent"
                        ? "text-cyan-100"
                        : "text-slate-200"
                  }
                >
                  {entry.message}
                </span>
              </div>
            ))
          )}
        </div>
      ) : null}
    </section>
  );
}
