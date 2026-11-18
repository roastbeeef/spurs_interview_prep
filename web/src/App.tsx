import { useState } from "react";
import { AlertCircle, CheckCircle2, Info, RefreshCw, X } from "lucide-react";
import { AgentStdoutConsole } from "./components/AgentStdoutConsole";
import { ApprovedCasesDialog } from "./components/ApprovedCasesDialog";
import { OverrideDialog } from "./components/OverrideDialog";
import { SystemConfigDialog } from "./components/SystemConfigDialog";
import { TopOperationalBar } from "./components/TopOperationalBar";
import {
  ContextInspectorPane,
  type InspectorTab,
} from "./features/context/ContextInspectorPane";
import { TicketQueuePane } from "./features/queue/TicketQueuePane";
import { TicketWorkspacePane } from "./features/workspace/TicketWorkspacePane";
import { useTriageWorkbench } from "./hooks/useTriageWorkbench";

type MobilePane = "queue" | "workspace" | "context";

export function App() {
  const wb = useTriageWorkbench();

  const [mobilePane, setMobilePane] = useState<MobilePane>("workspace");
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("evidence");
  const [highlightedArticleId, setHighlightedArticleId] = useState<string | null>(null);
  const [isOverrideOpen, setIsOverrideOpen] = useState(false);
  const [isSystemConfigOpen, setIsSystemConfigOpen] = useState(false);
  const [isCasesOpen, setIsCasesOpen] = useState(false);

  const selectedEntry = wb.selectedEntry;
  const displayedResult = wb.displayedResult;
  const draftReply = wb.getDraftReplyForTicket(selectedEntry, displayedResult);

  const hasNextPending = wb.tickets.some(
    (t) => !t.staff_action && t.ticket_id !== wb.selectedTicketId
  );

  const handleInspectCitation = (articleId: string) => {
    setInspectorTab("evidence");
    setHighlightedArticleId(articleId);
    setMobilePane("context");
  };

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900 lg:h-screen lg:overflow-hidden">
      <a href="#main-workbench" className="skip-link visually-hidden">
        Skip to triage workspace
      </a>

      <TopOperationalBar
        telemetry={wb.telemetry}
        selectedEngine={wb.selectedEngine}
        isBatchTriaging={wb.isBatchTriaging}
        isResetting={wb.isResetting}
        onSelectEngine={wb.setSelectedEngine}
        onTriageQueue={() => void wb.triageQueue()}
        onOpenSystemConfig={() => setIsSystemConfigOpen(true)}
        onOpenCasesModal={() => setIsCasesOpen(true)}
        onResetDemo={() => void wb.resetAll()}
      />

      {/* Narrow-viewport pane switcher (< 1024px) */}
      <nav
        aria-label="Mobile workspace view switcher"
        className="grid grid-cols-3 border-b border-slate-200 bg-white text-xs font-medium lg:hidden"
      >
        {(
          [
            { id: "queue", label: `Queue (${wb.filteredTickets.length})` },
            {
              id: "workspace",
              label: selectedEntry ? `Ticket ${selectedEntry.ticket_id}` : "Workspace",
            },
            { id: "context", label: "Context" },
          ] as const
        ).map((tab) => {
          const active = mobilePane === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => setMobilePane(tab.id)}
              className={`border-b-2 py-2.5 text-center transition-colors ${
                active
                  ? "border-blue-700 font-semibold text-blue-800"
                  : "border-transparent text-slate-600 hover:text-slate-900"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </nav>

      {/* Main 3-Pane Operational Workbench */}
      <main id="main-workbench" tabIndex={-1} className="min-h-0 flex-1 overflow-hidden">
        {wb.isLoadingDashboard && wb.tickets.length === 0 ? (
          <div className="flex h-full items-center justify-center p-8 text-xs text-slate-500">
            Loading Northbank FC Member Services console…
          </div>
        ) : wb.dashboardError && wb.tickets.length === 0 ? (
          <div className="flex h-full items-center justify-center p-8">
            <div
              role="alert"
              className="max-w-md rounded-md border border-red-200 bg-white p-5 text-center shadow-xs"
            >
              <AlertCircle className="mx-auto h-6 w-6 text-red-700" aria-hidden="true" />
              <h2 className="mt-2 text-sm font-semibold text-slate-900">
                Unable to load ticket queue
              </h2>
              <p className="mt-1 text-xs text-slate-600">{wb.dashboardError}</p>
              <button
                type="button"
                onClick={() => void wb.refreshDashboard()}
                className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Retry</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[310px_minmax(0,1fr)_340px] xl:grid-cols-[335px_minmax(0,1fr)_375px]">
            <div
              className={`min-h-0 ${
                mobilePane === "queue" ? "block h-[calc(100vh-105px)]" : "hidden"
              } lg:block lg:h-full`}
            >
              <TicketQueuePane
                allTickets={wb.tickets}
                filteredTickets={wb.filteredTickets}
                selectedTicketId={wb.selectedTicketId}
                statusFilter={wb.statusFilter}
                actionFilter={wb.actionFilter}
                searchQuery={wb.searchQuery}
                triagingByTicket={wb.triagingByTicket}
                onSelectTicket={(id) => {
                  setHighlightedArticleId(null);
                  wb.selectTicket(id);
                }}
                onStatusFilterChange={wb.setStatusFilter}
                onActionFilterChange={wb.setActionFilter}
                onSearchQueryChange={wb.setSearchQuery}
                onResetFilters={wb.resetFilters}
                onFocusWorkspace={() => setMobilePane("workspace")}
              />
            </div>

            <div
              className={`min-h-0 ${
                mobilePane === "workspace" ? "block" : "hidden"
              } lg:block lg:h-full`}
            >
              <TicketWorkspacePane
                entry={selectedEntry}
                displayedResult={displayedResult}
                selectedEngine={wb.selectedEngine}
                draftReply={draftReply}
                isTriaging={Boolean(
                  selectedEntry && wb.triagingByTicket[selectedEntry.ticket_id]
                )}
                triageError={
                  selectedEntry ? wb.triageErrorByTicket[selectedEntry.ticket_id] ?? null : null
                }
                isSubmittingAction={Boolean(
                  selectedEntry && wb.submittingTicketId === selectedEntry.ticket_id
                )}
                actionError={
                  selectedEntry ? wb.actionErrorByTicket[selectedEntry.ticket_id] ?? null : null
                }
                hasNextPending={hasNextPending}
                queuePosition={
                  wb.currentTicketIndex >= 0
                    ? { index: wb.currentTicketIndex, total: wb.filteredTickets.length }
                    : null
                }
                prevTicketId={wb.prevTicketId}
                nextTicketId={wb.nextTicketId}
                canGoNext={Boolean(wb.nextPendingTicketId || wb.nextTicketId)}
                onSelectTicket={(id) => {
                  setHighlightedArticleId(null);
                  wb.selectTicket(id);
                }}
                onNextTicket={() => {
                  setHighlightedArticleId(null);
                  wb.goToNextTicket();
                }}
                onDraftReplyChange={wb.setDraftReplyForTicket}
                onResetDraftReply={wb.resetDraftReplyForTicket}
                onRunTriage={(tid, engine) => void wb.triageOne(tid, engine)}
                onSubmitAction={wb.submitDecision}
                onOpenOverride={() => setIsOverrideOpen(true)}
                onInspectCitation={handleInspectCitation}
              />
            </div>

            <div
              className={`min-h-0 ${
                mobilePane === "context" ? "block" : "hidden"
              } lg:block lg:h-full`}
            >
              <ContextInspectorPane
                entry={selectedEntry}
                displayedResult={displayedResult}
                engineHistory={
                  selectedEntry ? wb.engineHistoryByTicket[selectedEntry.ticket_id] : undefined
                }
                kbArticles={wb.kbArticles}
                approvedCases={wb.cases}
                activeTrace={wb.activeTrace}
                isLoadingTrace={wb.isLoadingTrace}
                traceError={wb.traceError}
                highlightedArticleId={highlightedArticleId}
                activeTab={inspectorTab}
                isTriaging={Boolean(
                  selectedEntry && wb.triagingByTicket[selectedEntry.ticket_id]
                )}
                onTabChange={setInspectorTab}
                onSelectTicket={(id) => {
                  setHighlightedArticleId(null);
                  wb.selectTicket(id);
                }}
                onRunComparisonEngine={(tid, engine) => void wb.triageOne(tid, engine)}
                onReloadTrace={(tid) => void wb.loadTrace(tid)}
              />
            </div>
          </div>
        )}
      </main>

      {/* Bottom Agent stdout Console */}
      <AgentStdoutConsole
        logs={wb.consoleLogs}
        triagingByTicket={wb.triagingByTicket}
        isBatchTriaging={wb.isBatchTriaging}
        onClear={wb.clearConsoleLogs}
        onSelectTicket={(id) => {
          setHighlightedArticleId(null);
          wb.selectTicket(id);
        }}
      />

      {/* Dialogs */}
      <OverrideDialog
        open={isOverrideOpen}
        entry={selectedEntry}
        displayedResult={displayedResult}
        draftReply={draftReply}
        isSubmitting={Boolean(
          selectedEntry && wb.submittingTicketId === selectedEntry.ticket_id
        )}
        onClose={() => setIsOverrideOpen(false)}
        onSubmitOverride={(tid, payload) => wb.submitDecision(tid, payload)}
      />

      <SystemConfigDialog
        open={isSystemConfigOpen}
        telemetry={wb.telemetry}
        selectedEngine={wb.selectedEngine}
        onClose={() => setIsSystemConfigOpen(false)}
      />

      <ApprovedCasesDialog
        open={isCasesOpen}
        cases={wb.cases}
        onClose={() => setIsCasesOpen(false)}
      />

      {/* Polite Status Toast */}
      <div aria-live="polite" className="pointer-events-none fixed right-4 bottom-36 z-40">
        {wb.notice ? (
          <div
            role="status"
            className={`pointer-events-auto flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-medium shadow-md ${
              wb.notice.tone === "error"
                ? "border-red-300 bg-red-950 text-white"
                : wb.notice.tone === "success"
                  ? "border-emerald-700 bg-slate-900 text-white"
                  : "border-slate-700 bg-slate-900 text-white"
            }`}
          >
            {wb.notice.tone === "error" ? (
              <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-300" aria-hidden="true" />
            ) : wb.notice.tone === "success" ? (
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-300" aria-hidden="true" />
            ) : (
              <Info className="h-3.5 w-3.5 shrink-0 text-blue-300" aria-hidden="true" />
            )}
            <span>{wb.notice.message}</span>
            <button
              type="button"
              onClick={wb.dismissNotice}
              aria-label="Dismiss notification"
              className="ml-1 rounded p-0.5 text-slate-300 hover:bg-white/10 hover:text-white"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default App;
