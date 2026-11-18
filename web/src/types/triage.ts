export type EngineType = "jev" | "claude";

export type TriageAction =
  | "resolve"
  | "create_case"
  | "escalate_to_human"
  | "ask_clarification";

export type IntentCategory =
  | "password_reset"
  | "membership_renewal"
  | "billing_dispute"
  | "seat_transfer"
  | "membership_cancellation"
  | "account_details_change"
  | "junior_membership"
  | "loyalty_points"
  | "account_status_or_upgrade"
  | "untrusted_or_other"
  | (string & {});

export type CaseCategory =
  | "cancellation"
  | "reinstatement"
  | "billing_investigation"
  | "account_update"
  | "general"
  | (string & {});

export type DecisionType = "accept" | "reject_case" | "override";

export interface TicketRecord {
  ticket_id?: string;
  id?: string;
  from: string;
  from_email?: string;
  subject: string;
  body: string;
  received_at?: string;
}

export interface MemberSummary {
  status: "matched" | "no_match" | string;
  member_id: string | null;
  name?: string | null;
  tier?: string | null;
  account_status?: string | null;
  joined?: string | null;
  loyalty_points?: number | null;
  reason?: string;
}

export interface MatchedMemberRecord {
  member_id: string;
  name: string;
  first_name?: string;
  last_name?: string;
  email: string;
  tier: string;
  joined?: string;
  status: string;
  renewal_date: string;
  loyalty_points: string;
}

export interface CasePreview {
  status: "preview" | "refused" | string;
  preview_id?: string;
  member_id?: string;
  category?: CaseCategory;
  summary?: string;
  requires_human_approval?: boolean;
  reason?: string;
}

export interface AgentRecommendation {
  intent: IntentCategory;
  member: MemberSummary;
  action: TriageAction;
  draft_reply: string;
  citations: string[];
  rationale: string;
  case_preview: CasePreview | null;
  confidence?: number | null;
  uncertainty?: string[];
  requires_staff_review?: boolean;
}

export interface SystemOneChoice {
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

export interface SystemOneScore {
  score: number;
  label?: string;
  confidence: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
}

export interface SystemOneNoul {
  noul: number;
}

export interface SystemOneTelemetry {
  model: string;
  provider: string;
  latency_ms: number;
  fallback_reason?: string;
  choices: Record<string, SystemOneChoice>;
  scores: Record<string, SystemOneScore>;
  nouls: Record<string, SystemOneNoul>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

export interface TriageResult {
  ticket_id: string;
  ticket: TicketRecord;
  engine: EngineType;
  model?: string;
  provider?: string;
  latency_ms?: number;
  turns?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  agent: AgentRecommendation | null;
  system_one: SystemOneTelemetry | null;
  error: string | null;
}

export interface StaffActionRecord {
  ticket_id: string;
  recommended_action: string;
  final_action: string;
  decision_type: DecisionType;
  reply_text: string;
  notes: string;
  case_id: string | null;
  preview_id: string | null;
  engine: string;
  actor: string;
  acted_at: string;
}

export interface ApprovedCaseRecord {
  case_id: string;
  preview_id: string;
  member_id: string;
  category: string;
  summary: string;
  approved_at: string;
}

export interface RelatedTicketSummary {
  ticket_id: string;
  subject: string;
  received_at: string;
}

export interface MemberCaseHistory {
  status: "matched" | "no_match" | string;
  member_id: string | null;
  reason?: string;
  cases: ApprovedCaseRecord[];
  total_cases: number;
  joined?: string | null;
  tenure_years?: number | null;
  account_status?: string;
  tier?: string;
  loyalty_points?: number;
  away_ballot_rank?: number;
  away_ballot_active_total?: number;
  away_ballot_percentile?: number;
  reinstatement_eligible?: boolean;
  reinstatement_deadline?: string | null;
  requires_guardian_approval?: boolean;
  is_suspended?: boolean;
  points_at_risk_on_cancel?: number;
  homonym_member_ids?: string[];
  related_tickets?: RelatedTicketSummary[];
}

export interface FixtureTicketRecord {
  fixture_id: string;
  member_id: string;
  opponent: string;
  kickoff: string;
  match_status: string;
  hours_until_kickoff: number;
  ticket_type: string;
  fixture_category: string;
  seating_block: string;
  exchange_eligible: boolean;
  exchange_cutoff_hours: number;
  within_exchange_cutoff: boolean;
  adult_upgrade_differential_gbp: number;
}

export interface FixtureTicketLookup {
  status: "matched" | "no_match" | string;
  member_id: string | null;
  reason?: string;
  tickets: FixtureTicketRecord[];
}

export interface TransactionRecord {
  transaction_id: string;
  member_id: string;
  timestamp: string;
  amount_gbp: number;
  currency: string;
  description: string;
  status: string;
  payment_method: string;
}

export interface RecentTransactionsLookup {
  status: "matched" | "no_match" | string;
  member_id: string | null;
  reason?: string;
  transactions: TransactionRecord[];
  has_duplicate_pending: boolean;
  pending_total_gbp: number;
}

export interface AuditEventRecord {
  id: number;
  at: string;
  ticket_id: string | null;
  event: string;
  inputs: string;
  result: string;
}

export interface LatencyHistoryPoint {
  id: number;
  at: string;
  ticket_id: string;
  engine: EngineType;
  model: string;
  run_index: number;
  latency_ms: number;
  running_avg_ms: number;
}

export interface DashboardTelemetry {
  total_tickets: number;
  triaged_count: number;
  actioned_count: number;
  pending_count: number;
  approved_cases_count: number;
  by_action: Record<string, number>;
  by_intent: Record<string, number>;
  by_engine: Record<string, number>;
  jev_avg_latency_ms: number | null;
  jev_run_count?: number;
  jev_avg_confidence: number | null;
  claude_avg_latency_ms: number | null;
  claude_run_count?: number;
  latency_history?: LatencyHistoryPoint[];
  human_model_agreement_rate: number | null;
  flywheel_labelled_count: number;
  typesafe_api_key_configured: boolean;
  claude_api_key_configured: boolean;
}

export interface EnrichedTicket {
  ticket_id: string;
  ticket: TicketRecord;
  result: TriageResult | null;
  staff_action: StaffActionRecord | null;
  matched_member: MatchedMemberRecord | null;
  case_history?: MemberCaseHistory | null;
  fixture_lookup?: FixtureTicketLookup | null;
  recent_transactions?: RecentTransactionsLookup | null;
}

export interface DashboardResponse {
  tickets: EnrichedTicket[];
  kb_articles: Record<string, string>;
  cases: ApprovedCaseRecord[];
  staff_actions: Record<string, StaffActionRecord>;
  recent_audit: AuditEventRecord[];
  telemetry: DashboardTelemetry;
}

export interface StaffActionPayload {
  recommended_action: string;
  final_action: string;
  decision_type: DecisionType;
  reply_text: string;
  notes: string;
  preview_id: string | null;
  engine: string;
  actor?: string;
}

export type ConsoleLogStream = "agent" | "jev" | "claude" | "mcp" | "staff" | "error" | "system";

export interface ConsoleLogEntry {
  id: string;
  timestamp: string;
  stream: ConsoleLogStream;
  ticketId?: string | null;
  message: string;
}
