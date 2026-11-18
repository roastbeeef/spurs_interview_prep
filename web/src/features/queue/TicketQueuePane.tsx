import { useEffect, useRef } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FilePlus2,
  Loader2,
  RotateCcw,
  Search,
  ShieldAlert,
  UserCheck,
  UserX,
} from "lucide-react";
import type { ActionFilter, StatusFilter } from "../../hooks/useTriageWorkbench";
import type { EngineType, EnrichedTicket } from "../../types/triage";
import { getActionMeta, getStaffOutcomeLabel } from "../../utils/triageDisplay";
import { StatusBadge } from "../../components/StatusBadge";

interface TicketQueuePaneProps {
  allTickets: EnrichedTicket[];
  filteredTickets: EnrichedTicket[];
  selectedTicketId: string | null;
  statusFilter: StatusFilter;
  actionFilter: ActionFilter;
  searchQuery: string;
  triagingByTicket: Record<string, EngineType>;
  onSelectTicket: (ticketId: string) => void;
  onStatusFilterChange: (filter: StatusFilter) => void;
  onActionFilterChange: (filter: ActionFilter) => void;
  onSearchQueryChange: (query: string) => void;
  onResetFilters: () => void;
  onFocusWorkspace?: () => void;
}

export function TicketQueuePane({
  allTickets,
  filteredTickets,
  selectedTicketId,
  statusFilter,
  actionFilter,
  searchQuery,
  triagingByTicket,
  onSelectTicket,
  onStatusFilterChange,
  onActionFilterChange,
  onSearchQueryChange,
  onResetFilters,
  onFocusWorkspace,
}: TicketQueuePaneProps) {
  const searchInputRef = useRef<HTMLInputElement>(null);

  const pendingCount = allTickets.filter((t) => !t.staff_action).length;
  const actionedCount = allTickets.filter((t) => Boolean(t.staff_action)).length;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTyping =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable;

      if (e.key === "/" && !isTyping) {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      if (isTyping || !filteredTickets.length) return;

      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        const idx = filteredTickets.findIndex((t) => t.ticket_id === selectedTicketId);
        const nextIdx = idx < 0 ? 0 : Math.min(filteredTickets.length - 1, idx + 1);
        onSelectTicket(filteredTickets[nextIdx].ticket_id);
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        const idx = filteredTickets.findIndex((t) => t.ticket_id === selectedTicketId);
        const prevIdx = idx <= 0 ? 0 : idx - 1;
        onSelectTicket(filteredTickets[prevIdx].ticket_id);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [filteredTickets, selectedTicketId, onSelectTicket]);

  return (
    <section
      aria-label="Ticket work queue"
      className="flex h-full min-h-0 flex-col border-slate-200 bg-white lg:border-r"
    >
      {/* Search & Filter Controls */}
      <div className="border-b border-slate-200 p-3">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xs font-semibold tracking-wider text-slate-600 uppercase">
            Inbound Queue
          </h2>
          <span className="font-mono text-[11px] text-slate-500 tabular-nums">
            {filteredTickets.length} of {allTickets.length}
          </span>
        </div>

        <search className="space-y-2">
          <div className="relative">
            <label htmlFor="queue-search-input" className="visually-hidden">
              Search tickets by ID, sender, subject, or member
            </label>
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              ref={searchInputRef}
              id="queue-search-input"
              type="search"
              value={searchQuery}
              onChange={(e) => onSearchQueryChange(e.target.value)}
              placeholder="Search tickets…"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              className="w-full rounded-md border border-slate-300 bg-white py-1.5 pr-2.5 pl-8 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-600"
            />
          </div>

          {/* Status tabs */}
          <div
            role="group"
            aria-label="Filter by staff review status"
            className="flex items-center gap-0.5 rounded-md border border-slate-200 bg-slate-100 p-0.5 text-[11px] font-medium"
          >
            {(
              [
                { id: "all", label: "All", count: allTickets.length },
                { id: "pending", label: "Needs Review", count: pendingCount },
                { id: "actioned", label: "Actioned", count: actionedCount },
              ] as const
            ).map((tab) => {
              const active = statusFilter === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onStatusFilterChange(tab.id)}
                  className={`flex-1 whitespace-nowrap rounded px-2 py-1 transition-colors ${
                    active
                      ? "bg-white text-slate-900 shadow-xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {tab.label}{" "}
                  <span className="font-mono text-[10px] text-slate-500 tabular-nums">
                    ({tab.count})
                  </span>
                </button>
              );
            })}
          </div>

          {/* Action type filter */}
          <div className="flex items-center gap-2">
            <label htmlFor="queue-action-filter" className="text-[11px] font-medium text-slate-500">
              Action:
            </label>
            <select
              id="queue-action-filter"
              value={actionFilter}
              onChange={(e) => onActionFilterChange(e.target.value as ActionFilter)}
              className="flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800"
            >
              <option value="all">All recommendations</option>
              <option value="resolve">Send Grounded Reply</option>
              <option value="create_case">Case Proposal</option>
              <option value="escalate_to_human">Escalate to Specialist</option>
              <option value="ask_clarification">Request Verification</option>
            </select>
          </div>
        </search>
      </div>

      {/* Queue List */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {filteredTickets.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
            <p className="text-sm font-medium text-slate-700">No matching tickets</p>
            <p className="mt-1 text-xs text-slate-500">
              Try clearing your search query or switching back to all statuses.
            </p>
            <button
              type="button"
              onClick={onResetFilters}
              className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Reset filters</span>
            </button>
          </div>
        ) : (
          <ul role="list" className="divide-y divide-slate-200">
            {filteredTickets.map((entry) => {
              const isSelected = entry.ticket_id === selectedTicketId;
              const isTriaging = Boolean(triagingByTicket[entry.ticket_id]);
              const agent = entry.result?.agent;
              const sys1 = entry.result?.system_one;
              const staff = entry.staff_action;

              const actionMeta = getActionMeta(agent?.action);
              const memberMatched = agent?.member?.status === "matched";
              const urgencyScore = sys1?.scores?.urgency?.score;
              const isUrgent = typeof urgencyScore === "number" && urgencyScore >= 3;
              const injectionRisk = sys1?.nouls?.prompt_injection_risk?.noul;
              const isInjection = typeof injectionRisk === "number" && injectionRisk >= 0.5;

              const actionConf = sys1?.choices?.action?.confidence;
              const confText =
                typeof actionConf === "number" ? `${Math.round(actionConf * 100)}%` : null;

              const staffOutcome = staff ? getStaffOutcomeLabel(staff) : null;

              return (
                <li key={entry.ticket_id}>
                  <button
                    type="button"
                    aria-current={isSelected ? "true" : undefined}
                    onClick={() => {
                      onSelectTicket(entry.ticket_id);
                      onFocusWorkspace?.();
                    }}
                    className={`group relative block w-full border-l-3 px-3.5 py-3 text-left transition-colors ${
                      isSelected
                        ? "border-l-blue-700 bg-blue-50/60"
                        : "border-l-transparent bg-white hover:bg-slate-50"
                    }`}
                  >
                    {/* Row 1: Ticket ID, risk indicator, review status */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs font-semibold text-slate-900">
                          {entry.ticket_id}
                        </span>
                        {isInjection ? (
                          <StatusBadge
                            tone="crimson"
                            icon={<ShieldAlert className="h-3 w-3" />}
                          >
                            Injection Risk
                          </StatusBadge>
                        ) : isUrgent ? (
                          <StatusBadge
                            tone="crimson"
                            icon={<AlertTriangle className="h-3 w-3" />}
                          >
                            Urgent
                          </StatusBadge>
                        ) : null}
                      </div>

                      {isTriaging ? (
                        <StatusBadge tone="cobalt" icon={<Loader2 className="h-3 w-3 animate-spin" />}>
                          Triaging
                        </StatusBadge>
                      ) : staffOutcome ? (
                        <StatusBadge
                          tone={staffOutcome.tone}
                          icon={<CheckCircle2 className="h-3 w-3" />}
                        >
                          {staffOutcome.label}
                        </StatusBadge>
                      ) : (
                        <StatusBadge tone="amber" icon={<Clock className="h-3 w-3" />}>
                          Needs Review
                        </StatusBadge>
                      )}
                    </div>

                    {/* Row 2: Subject */}
                    <p className="mt-1 truncate text-[13px] font-semibold text-slate-900">
                      {entry.ticket.subject || "(No subject)"}
                    </p>

                    {/* Row 3: Sender / Matched Member */}
                    <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-600">
                      {memberMatched && agent?.member ? (
                        <>
                          <UserCheck
                            className="h-3.5 w-3.5 shrink-0 text-emerald-700"
                            aria-hidden="true"
                          />
                          <span className="truncate">
                            {agent.member.name || agent.member.member_id}{" "}
                            <span className="font-mono text-[11px] text-slate-500">
                              ({agent.member.member_id}
                              {agent.member.tier ? `, ${agent.member.tier}` : ""})
                            </span>
                          </span>
                        </>
                      ) : (
                        <>
                          <UserX
                            className="h-3.5 w-3.5 shrink-0 text-red-700"
                            aria-hidden="true"
                          />
                          <span className="truncate font-mono text-[11px] text-slate-600">
                            {entry.ticket.from_email || entry.ticket.from}
                          </span>
                        </>
                      )}
                    </div>

                    {/* Row 4: Recommended action + confidence + engine */}
                    <div className="mt-2 flex items-center justify-between gap-2 text-[11px]">
                      <div className="flex items-center gap-1.5">
                        {agent?.action === "create_case" ? (
                          <FilePlus2 className="h-3.5 w-3.5 text-amber-700" aria-hidden="true" />
                        ) : null}
                        <span
                          className={`font-medium ${
                            actionMeta.tone === "crimson"
                              ? "text-red-800"
                              : actionMeta.tone === "amber"
                                ? "text-amber-800"
                                : actionMeta.tone === "emerald"
                                  ? "text-emerald-800"
                                  : "text-slate-500"
                          }`}
                        >
                          {entry.result?.error ? "Triage error" : actionMeta.label}
                        </span>
                      </div>
                      {confText ? (
                        <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                          {confText}
                        </span>
                      ) : null}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
