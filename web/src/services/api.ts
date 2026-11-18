import type {
  ApprovedCaseRecord,
  AuditEventRecord,
  DashboardResponse,
  EngineType,
  StaffActionPayload,
  StaffActionRecord,
  TriageResult,
} from "../types/triage";

export class ApiError extends Error {
  readonly status: number;
  readonly detail: string;

  constructor(status: number, detail: string) {
    super(detail);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

async function requestJson<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const detail =
      typeof data.detail === "string" && data.detail.trim()
        ? data.detail
        : `Request failed with status ${response.status}`;
    throw new ApiError(response.status, detail);
  }
  return data as T;
}

export function fetchDashboard(signal?: AbortSignal): Promise<DashboardResponse> {
  return requestJson<DashboardResponse>("/api/dashboard", { signal });
}

export function fetchTicketTrace(
  ticketId: string,
  signal?: AbortSignal
): Promise<{ ticket_id: string; events: AuditEventRecord[] }> {
  return requestJson<{ ticket_id: string; events: AuditEventRecord[] }>(
    `/api/tickets/${encodeURIComponent(ticketId)}/trace`,
    { signal }
  );
}

export function runTicketTriage(
  ticketId: string,
  engine: EngineType,
  apiKey?: string | null,
  signal?: AbortSignal
): Promise<{ result: TriageResult; events: AuditEventRecord[] }> {
  return requestJson<{ result: TriageResult; events: AuditEventRecord[] }>(
    `/api/tickets/${encodeURIComponent(ticketId)}/triage`,
    {
      method: "POST",
      body: JSON.stringify({
        engine,
        api_key: apiKey?.trim() || null,
      }),
      signal,
    }
  );
}

export function runBatchTriage(
  engine: EngineType,
  apiKey?: string | null,
  signal?: AbortSignal
): Promise<{ count: number; engine: EngineType; results: TriageResult[] }> {
  return requestJson<{ count: number; engine: EngineType; results: TriageResult[] }>(
    "/api/triage-all",
    {
      method: "POST",
      body: JSON.stringify({
        engine,
        api_key: apiKey?.trim() || null,
      }),
      signal,
    }
  );
}

export function submitStaffAction(
  ticketId: string,
  payload: StaffActionPayload
): Promise<{
  staff_action: StaffActionRecord;
  events: AuditEventRecord[];
  cases: ApprovedCaseRecord[];
}> {
  return requestJson<{
    staff_action: StaffActionRecord;
    events: AuditEventRecord[];
    cases: ApprovedCaseRecord[];
  }>(`/api/tickets/${encodeURIComponent(ticketId)}/action`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function resetWorkspace(): Promise<DashboardResponse> {
  return requestJson<DashboardResponse>("/api/reset", {
    method: "POST",
  });
}
