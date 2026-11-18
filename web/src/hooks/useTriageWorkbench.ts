import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchDashboard,
  fetchTicketTrace,
  resetWorkspace,
  runBatchTriage,
  runTicketTriage,
  submitStaffAction,
} from "../services/api";
import type {
  ApprovedCaseRecord,
  AuditEventRecord,
  ConsoleLogEntry,
  ConsoleLogStream,
  DashboardTelemetry,
  EngineType,
  EnrichedTicket,
  StaffActionPayload,
  TriageAction,
  TriageResult,
} from "../types/triage";
import { formatAuditEventAsStdout, formatStdoutTime } from "../utils/triageDisplay";

export type StatusFilter = "all" | "pending" | "actioned";
export type ActionFilter = "all" | TriageAction;

export interface WorkbenchNotice {
  id: number;
  tone: "success" | "error" | "info";
  message: string;
}

const EMPTY_TELEMETRY: DashboardTelemetry = {
  total_tickets: 0,
  triaged_count: 0,
  actioned_count: 0,
  pending_count: 0,
  approved_cases_count: 0,
  by_action: {},
  by_intent: {},
  by_engine: {},
  jev_avg_latency_ms: null,
  jev_run_count: 0,
  jev_avg_confidence: null,
  claude_avg_latency_ms: null,
  claude_run_count: 0,
  latency_history: [],
  human_model_agreement_rate: null,
  flywheel_labelled_count: 0,
  typesafe_api_key_configured: false,
  claude_api_key_configured: false,
};

export function useTriageWorkbench() {
  const [tickets, setTickets] = useState<EnrichedTicket[]>([]);
  const [kbArticles, setKbArticles] = useState<Record<string, string>>({});
  const [cases, setCases] = useState<ApprovedCaseRecord[]>([]);
  const [telemetry, setTelemetry] = useState<DashboardTelemetry>(EMPTY_TELEMETRY);
  const [recentAudit, setRecentAudit] = useState<AuditEventRecord[]>([]);

  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [selectedEngine, setSelectedEngine] = useState<EngineType>("jev");

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [actionFilter, setActionFilter] = useState<ActionFilter>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");

  const [activeTrace, setActiveTrace] = useState<AuditEventRecord[]>([]);
  const [isLoadingTrace, setIsLoadingTrace] = useState<boolean>(false);
  const [traceError, setTraceError] = useState<string | null>(null);

  const [isLoadingDashboard, setIsLoadingDashboard] = useState<boolean>(true);
  const [dashboardError, setDashboardError] = useState<string | null>(null);

  const [triagingByTicket, setTriagingByTicket] = useState<Record<string, EngineType>>({});
  const [isBatchTriaging, setIsBatchTriaging] = useState<boolean>(false);
  const [isResetting, setIsResetting] = useState<boolean>(false);
  const [submittingTicketId, setSubmittingTicketId] = useState<string | null>(null);

  const [triageErrorByTicket, setTriageErrorByTicket] = useState<Record<string, string>>({});
  const [actionErrorByTicket, setActionErrorByTicket] = useState<Record<string, string>>({});

  // Preserve per-engine results and edited reply drafts across ticket switches
  const [engineHistoryByTicket, setEngineHistoryByTicket] = useState<
    Record<string, Partial<Record<EngineType, TriageResult>>>
  >({});
  const [draftRepliesByTicket, setDraftRepliesByTicket] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<WorkbenchNotice | null>(null);
  const [consoleLogs, setConsoleLogs] = useState<ConsoleLogEntry[]>([]);

  const selectedTicketIdRef = useRef<string | null>(null);
  selectedTicketIdRef.current = selectedTicketId;

  const traceSeqRef = useRef(0);
  const traceAbortRef = useRef<AbortController | null>(null);
  const dashboardSeqRef = useRef(0);
  const noticeTimerRef = useRef<number | null>(null);
  const seenAuditIdsRef = useRef<Set<number>>(new Set());
  const logSeqRef = useRef(0);

  const appendStdoutLine = useCallback(
    (stream: ConsoleLogStream, message: string, ticketId?: string | null) => {
      const entry: ConsoleLogEntry = {
        id: `live-${++logSeqRef.current}`,
        timestamp: formatStdoutTime(),
        stream,
        ticketId: ticketId ?? null,
        message,
      };
      setConsoleLogs((prev) => [...prev, entry].slice(-250));
    },
    []
  );

  const appendAuditStdoutLogs = useCallback((events: AuditEventRecord[]) => {
    if (!events.length) return;
    const ordered = [...events].sort((a, b) => a.id - b.id);
    const additions: ConsoleLogEntry[] = [];
    for (const ev of ordered) {
      if (seenAuditIdsRef.current.has(ev.id)) continue;
      seenAuditIdsRef.current.add(ev.id);
      additions.push(formatAuditEventAsStdout(ev));
    }
    if (additions.length > 0) {
      setConsoleLogs((prev) => [...prev, ...additions].slice(-250));
    }
  }, []);

  const clearConsoleLogs = useCallback(() => {
    setConsoleLogs([]);
  }, []);

  const pushNotice = useCallback((tone: WorkbenchNotice["tone"], message: string) => {
    if (noticeTimerRef.current !== null) {
      window.clearTimeout(noticeTimerRef.current);
    }
    setNotice({ id: Date.now(), tone, message });
    noticeTimerRef.current = window.setTimeout(() => {
      setNotice(null);
    }, 4500);
  }, []);

  const dismissNotice = useCallback(() => {
    if (noticeTimerRef.current !== null) {
      window.clearTimeout(noticeTimerRef.current);
    }
    setNotice(null);
  }, []);

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current !== null) {
        window.clearTimeout(noticeTimerRef.current);
      }
      traceAbortRef.current?.abort();
    };
  }, []);

  const loadTrace = useCallback(async (ticketId: string) => {
    traceAbortRef.current?.abort();
    const controller = new AbortController();
    traceAbortRef.current = controller;
    const seq = ++traceSeqRef.current;

    setIsLoadingTrace(true);
    setTraceError(null);
    try {
      const data = await fetchTicketTrace(ticketId, controller.signal);
      if (seq !== traceSeqRef.current || selectedTicketIdRef.current !== ticketId) {
        return;
      }
      setActiveTrace(data.events ?? []);
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      if (seq !== traceSeqRef.current || selectedTicketIdRef.current !== ticketId) {
        return;
      }
      setActiveTrace([]);
      setTraceError(err instanceof Error ? err.message : "Failed to load audit trace");
    } finally {
      if (seq === traceSeqRef.current && selectedTicketIdRef.current === ticketId) {
        setIsLoadingTrace(false);
      }
    }
  }, []);

  const refreshDashboard = useCallback(
    async (preferredTicketId?: string | null) => {
      const seq = ++dashboardSeqRef.current;
      setDashboardError(null);
      try {
        const data = await fetchDashboard();
        if (seq !== dashboardSeqRef.current) return;

        const nextTickets = data.tickets ?? [];
        setTickets(nextTickets);
        setKbArticles(data.kb_articles ?? {});
        setCases(data.cases ?? []);
        setTelemetry(data.telemetry ?? EMPTY_TELEMETRY);
        setRecentAudit(data.recent_audit ?? []);

        const recentEvents = data.recent_audit ?? [];
        if (recentEvents.length > 0) {
          appendAuditStdoutLogs(recentEvents);
        } else {
          setConsoleLogs((prev) =>
            prev.length === 0
              ? [
                  {
                    id: `live-${++logSeqRef.current}`,
                    timestamp: formatStdoutTime(),
                    stream: "system",
                    ticketId: null,
                    message:
                      "Northbank FC agent stdout stream ready. Run Jev or Claude to inspect live tool and model calls.",
                  },
                ]
              : prev
          );
        }

        const fallbackToClaude =
          !data.telemetry?.typesafe_api_key_configured &&
          Boolean(data.telemetry?.claude_api_key_configured);
        setEngineHistoryByTicket((prev) => {
          const next = { ...prev };
          for (const item of nextTickets) {
            if (item.result) {
              const eng = item.result.engine;
              next[item.ticket_id] = {
                ...next[item.ticket_id],
                [eng]: item.result,
                ...(fallbackToClaude && eng === "claude" ? { jev: item.result } : {}),
              };
            }
          }
          return next;
        });

        const currentSelected = selectedTicketIdRef.current;
        const resolvedId =
          preferredTicketId && nextTickets.some((t) => t.ticket_id === preferredTicketId)
            ? preferredTicketId
            : currentSelected && nextTickets.some((t) => t.ticket_id === currentSelected)
              ? currentSelected
              : nextTickets[0]?.ticket_id ?? null;

        setSelectedTicketId(resolvedId);
        if (resolvedId) {
          void loadTrace(resolvedId);
        } else {
          setActiveTrace([]);
        }
      } catch (err) {
        if (seq !== dashboardSeqRef.current) return;
        const msg = err instanceof Error ? err.message : "Unable to load Member Services console";
        setDashboardError(msg);
      } finally {
        if (seq === dashboardSeqRef.current) {
          setIsLoadingDashboard(false);
        }
      }
    },
    [loadTrace, appendAuditStdoutLogs]
  );

  useEffect(() => {
    void refreshDashboard();
  }, [refreshDashboard]);

  const selectTicket = useCallback(
    (ticketId: string) => {
      if (ticketId === selectedTicketIdRef.current) return;
      setSelectedTicketId(ticketId);
      void loadTrace(ticketId);
    },
    [loadTrace]
  );

  const handleEngineSwitch = useCallback(
    (engine: EngineType) => {
      setSelectedEngine(engine);
      pushNotice(
        "info",
        engine === "jev"
          ? "Active engine switched to Jev (System 1, calibrated primitives)"
          : "Active engine switched to Claude (System 2, multi-turn MCP)"
      );
    },
    [pushNotice]
  );

  const filteredTickets = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return tickets.filter((entry) => {
      const isActioned = Boolean(entry.staff_action);
      if (statusFilter === "pending" && isActioned) return false;
      if (statusFilter === "actioned" && !isActioned) return false;

      if (actionFilter !== "all") {
        const recAction = entry.result?.agent?.action;
        if (recAction !== actionFilter) return false;
      }

      if (!q) return true;
      const haystack = [
        entry.ticket_id,
        entry.ticket.from_email,
        entry.ticket.from,
        entry.ticket.subject,
        entry.ticket.body,
        entry.result?.agent?.intent,
        entry.result?.agent?.member?.name,
        entry.result?.agent?.member?.member_id,
        entry.matched_member?.tier,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [tickets, statusFilter, actionFilter, searchQuery]);

  const selectedEntry = useMemo(
    () => tickets.find((t) => t.ticket_id === selectedTicketId) ?? null,
    [tickets, selectedTicketId]
  );

  const displayedResult: TriageResult | null = useMemo(() => {
    if (!selectedEntry) return null;
    const history = engineHistoryByTicket[selectedEntry.ticket_id];
    if (history?.[selectedEngine]) {
      return history[selectedEngine] ?? null;
    }
    return selectedEntry.result ?? null;
  }, [selectedEntry, engineHistoryByTicket, selectedEngine]);

  const getDraftReplyForTicket = useCallback(
    (entry: EnrichedTicket | null, result: TriageResult | null): string => {
      if (!entry) return "";
      if (entry.ticket_id in draftRepliesByTicket) {
        return draftRepliesByTicket[entry.ticket_id];
      }
      if (entry.staff_action?.reply_text) {
        return entry.staff_action.reply_text;
      }
      return result?.agent?.draft_reply ?? "";
    },
    [draftRepliesByTicket]
  );

  const setDraftReplyForTicket = useCallback((ticketId: string, value: string) => {
    setDraftRepliesByTicket((prev) => ({
      ...prev,
      [ticketId]: value,
    }));
  }, []);

  const resetDraftReplyForTicket = useCallback((ticketId: string) => {
    setDraftRepliesByTicket((prev) => {
      const next = { ...prev };
      delete next[ticketId];
      return next;
    });
  }, []);

  const triageOne = useCallback(
    async (ticketId: string, engineOverride?: EngineType) => {
      const targetEngine = engineOverride ?? selectedEngine;
      setTriagingByTicket((prev) => ({ ...prev, [ticketId]: targetEngine }));
      setTriageErrorByTicket((prev) => {
        const next = { ...prev };
        delete next[ticketId];
        return next;
      });

      appendStdoutLine(
        "agent",
        `▶ Calling agent engine=${targetEngine} (${
          targetEngine === "jev"
            ? "TypeSafe System-1 - jev-latest"
            : "Anthropic System-2 - claude-haiku-4-5"
        }) on ${ticketId}…`,
        ticketId
      );

      try {
        const resp = await runTicketTriage(ticketId, targetEngine, null);
        const result = resp.result;

        setEngineHistoryByTicket((prev) => ({
          ...prev,
          [ticketId]: {
            ...prev[ticketId],
            [targetEngine]: result,
            [result.engine]: result,
          },
        }));

        // Clear unedited draft override so the new engine draft is surfaced cleanly
        setDraftRepliesByTicket((prev) => {
          if (!(ticketId in prev)) return prev;
          const next = { ...prev };
          delete next[ticketId];
          return next;
        });

        if (selectedTicketIdRef.current === ticketId) {
          setActiveTrace(resp.events ?? []);
        }
        appendAuditStdoutLogs(resp.events ?? []);

        if (result.error) {
          appendStdoutLine("error", `✗ Agent ${result.engine} error on ${ticketId}: ${result.error}`, ticketId);
          setTriageErrorByTicket((prev) => ({ ...prev, [ticketId]: result.error! }));
          pushNotice("error", `${ticketId} triage returned an error: ${result.error}`);
        } else {
          const latText =
            typeof result.latency_ms === "number" ? `${result.latency_ms.toFixed(1)}ms` : "-";
          appendStdoutLine(
            result.engine,
            `✓ Agent ${result.engine} (${result.model || result.engine}) completed ${ticketId} in ${latText} -> action=${result.agent?.action ?? "?"} intent=${result.agent?.intent ?? "?"}`,
            ticketId
          );
          pushNotice(
            "success",
            `Triaged ${ticketId} using ${targetEngine === "jev" ? "Jev (System 1)" : "Claude (System 2)"}`
          );
        }

        await refreshDashboard(selectedTicketIdRef.current);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Triage request failed";
        appendStdoutLine("error", `✗ Agent ${targetEngine} request failed on ${ticketId}: ${msg}`, ticketId);
        setTriageErrorByTicket((prev) => ({ ...prev, [ticketId]: msg }));
        pushNotice("error", `Triage failed for ${ticketId}: ${msg}`);
      } finally {
        setTriagingByTicket((prev) => {
          const next = { ...prev };
          delete next[ticketId];
          return next;
        });
      }
    },
    [selectedEngine, refreshDashboard, pushNotice, appendStdoutLine, appendAuditStdoutLogs]
  );

  const triageQueue = useCallback(async () => {
    if (isBatchTriaging) return;
    setIsBatchTriaging(true);
    appendStdoutLine(
      "agent",
      `▶ Batch triage started: calling engine=${selectedEngine} across queue…`
    );
    try {
      const resp = await runBatchTriage(selectedEngine, null);
      setEngineHistoryByTicket((prev) => {
        const next = { ...prev };
        for (const r of resp.results ?? []) {
          next[r.ticket_id] = {
            ...next[r.ticket_id],
            [selectedEngine]: r,
            [r.engine]: r,
          };
        }
        return next;
      });
      await refreshDashboard(selectedTicketIdRef.current);
      for (const r of resp.results ?? []) {
        if (r.error) {
          appendStdoutLine("error", `✗ Agent ${r.engine} error on ${r.ticket_id}: ${r.error}`, r.ticket_id);
        } else {
          const latText = typeof r.latency_ms === "number" ? `${r.latency_ms.toFixed(1)}ms` : "-";
          appendStdoutLine(
            r.engine,
            `✓ Agent ${r.engine} completed ${r.ticket_id} in ${latText} -> action=${r.agent?.action ?? "?"}`,
            r.ticket_id
          );
        }
      }
      appendStdoutLine(
        resp.engine === "claude" ? "claude" : "jev",
        `✓ Batch triage finished: ${resp.count} tickets triaged via ${resp.engine}.`
      );
      pushNotice(
        "success",
        `Re-triaged ${resp.count} tickets with ${resp.engine === "jev" ? "Jev" : "Claude"}`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Batch triage failed";
      appendStdoutLine("error", `✗ Batch triage failed (${selectedEngine}): ${msg}`);
      pushNotice("error", `Batch triage failed: ${msg}`);
    } finally {
      setIsBatchTriaging(false);
    }
  }, [isBatchTriaging, selectedEngine, refreshDashboard, pushNotice, appendStdoutLine]);

  const selectNextPendingAfter = useCallback(
    (currentTicketId: string, updatedTickets?: EnrichedTicket[]) => {
      const source = updatedTickets ?? tickets;
      const idx = source.findIndex((t) => t.ticket_id === currentTicketId);
      const after = source.slice(idx + 1).find((t) => !t.staff_action && t.ticket_id !== currentTicketId);
      const before = source.slice(0, Math.max(0, idx)).find((t) => !t.staff_action && t.ticket_id !== currentTicketId);
      const nextTarget = after ?? before ?? null;
      if (nextTarget) {
        setSelectedTicketId(nextTarget.ticket_id);
        void loadTrace(nextTarget.ticket_id);
        return nextTarget.ticket_id;
      }
      return null;
    },
    [tickets, loadTrace]
  );

  const submitDecision = useCallback(
    async (
      ticketId: string,
      payload: StaffActionPayload,
      options?: { advanceToNextPending?: boolean }
    ): Promise<boolean> => {
      if (submittingTicketId === ticketId) return false;
      setSubmittingTicketId(ticketId);
      setActionErrorByTicket((prev) => {
        const next = { ...prev };
        delete next[ticketId];
        return next;
      });

      try {
        const resp = await submitStaffAction(ticketId, payload);
        if (selectedTicketIdRef.current === ticketId) {
          setActiveTrace(resp.events ?? []);
        }

        // Refresh full dashboard from server so SQLite cases & telemetry stay canonical
        const dash = await fetchDashboard();
        const nextTickets = dash.tickets ?? [];
        setTickets(nextTickets);
        setKbArticles(dash.kb_articles ?? {});
        setCases(dash.cases ?? []);
        setTelemetry(dash.telemetry ?? EMPTY_TELEMETRY);
        setRecentAudit(dash.recent_audit ?? []);

        const caseNote = resp.staff_action.case_id
          ? ` (Case ${resp.staff_action.case_id.slice(0, 8)} created)`
          : "";
        appendStdoutLine(
          "staff",
          `staff_action: decision=${resp.staff_action.decision_type} final=${resp.staff_action.final_action}${caseNote}`,
          ticketId
        );
        pushNotice(
          "success",
          `Recorded '${resp.staff_action.final_action}' for ${ticketId}${caseNote}`
        );

        if (options?.advanceToNextPending) {
          selectNextPendingAfter(ticketId, nextTickets);
        }
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to save staff action";
        setActionErrorByTicket((prev) => ({ ...prev, [ticketId]: msg }));
        pushNotice("error", `Action failed for ${ticketId}: ${msg}`);
        return false;
      } finally {
        setSubmittingTicketId(null);
      }
    },
    [submittingTicketId, pushNotice, selectNextPendingAfter, appendStdoutLine]
  );

  const resetFilters = useCallback(() => {
    setStatusFilter("all");
    setActionFilter("all");
    setSearchQuery("");
  }, []);

  const resetAll = useCallback(async () => {
    if (isResetting || isBatchTriaging) return;
    setIsResetting(true);
    traceAbortRef.current?.abort();
    try {
      const dash = await resetWorkspace();
      const nextTickets = dash.tickets ?? [];
      setTickets(nextTickets);
      setKbArticles(dash.kb_articles ?? {});
      setCases(dash.cases ?? []);
      setTelemetry(dash.telemetry ?? EMPTY_TELEMETRY);
      setRecentAudit(dash.recent_audit ?? []);

      setEngineHistoryByTicket({});
      setDraftRepliesByTicket({});
      setTriageErrorByTicket({});
      setActionErrorByTicket({});
      setActiveTrace([]);
      seenAuditIdsRef.current.clear();
      setStatusFilter("all");
      setActionFilter("all");
      setSearchQuery("");
      setConsoleLogs([
        {
          id: `live-${++logSeqRef.current}`,
          timestamp: formatStdoutTime(),
          stream: "system",
          ticketId: null,
          message: "Workspace reset. Ready for live triage.",
        },
      ]);

      const firstId = nextTickets[0]?.ticket_id ?? null;
      setSelectedTicketId(firstId);
      pushNotice("info", "Demo state reset: cleared triage results, cases, actions, and audit logs");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to reset workspace";
      pushNotice("error", `Reset failed: ${msg}`);
    } finally {
      setIsResetting(false);
    }
  }, [isResetting, isBatchTriaging, pushNotice]);

  const { currentTicketIndex, prevTicketId, nextTicketId, nextPendingTicketId } = useMemo(() => {
    const idx = filteredTickets.findIndex((t) => t.ticket_id === selectedTicketId);
    const prev = idx > 0 ? filteredTickets[idx - 1]?.ticket_id ?? null : null;
    const next =
      idx >= 0 && idx + 1 < filteredTickets.length
        ? filteredTickets[idx + 1]?.ticket_id ?? null
        : filteredTickets.length > 1
          ? filteredTickets[0]?.ticket_id ?? null
          : null;

    const findNextPending = (list: EnrichedTicket[], fromIdx: number) => {
      const after = list
        .slice(Math.max(0, fromIdx + 1))
        .find((t) => !t.staff_action && t.ticket_id !== selectedTicketId);
      const before = list
        .slice(0, Math.max(0, fromIdx))
        .find((t) => !t.staff_action && t.ticket_id !== selectedTicketId);
      return after?.ticket_id ?? before?.ticket_id ?? null;
    };

    const nextPendingInFiltered = findNextPending(filteredTickets, idx);
    const allIdx = tickets.findIndex((t) => t.ticket_id === selectedTicketId);
    const nextPending = nextPendingInFiltered ?? findNextPending(tickets, allIdx);

    return {
      currentTicketIndex: idx,
      prevTicketId: prev,
      nextTicketId: next,
      nextPendingTicketId: nextPending,
    };
  }, [filteredTickets, tickets, selectedTicketId]);

  const goToNextTicket = useCallback(() => {
    const target = nextPendingTicketId ?? nextTicketId;
    if (target) {
      selectTicket(target);
    }
  }, [nextPendingTicketId, nextTicketId, selectTicket]);

  return {
    // Data
    tickets,
    filteredTickets,
    kbArticles,
    cases,
    telemetry,
    recentAudit,
    selectedEntry,
    displayedResult,
    activeTrace,
    engineHistoryByTicket,

    // Selection & controls
    selectedTicketId,
    selectTicket,
    currentTicketIndex,
    prevTicketId,
    nextTicketId,
    nextPendingTicketId,
    goToNextTicket,
    selectedEngine,
    setSelectedEngine: handleEngineSwitch,
    statusFilter,
    setStatusFilter,
    actionFilter,
    setActionFilter,
    searchQuery,
    setSearchQuery,
    resetFilters,

    // Draft replies
    getDraftReplyForTicket,
    setDraftReplyForTicket,
    resetDraftReplyForTicket,

    // Async state
    isLoadingDashboard,
    dashboardError,
    isLoadingTrace,
    traceError,
    triagingByTicket,
    isBatchTriaging,
    isResetting,
    submittingTicketId,
    triageErrorByTicket,
    actionErrorByTicket,
    notice,
    dismissNotice,
    consoleLogs,
    clearConsoleLogs,

    // Actions
    refreshDashboard,
    loadTrace,
    triageOne,
    triageQueue,
    resetAll,
    submitDecision,
  };
}
