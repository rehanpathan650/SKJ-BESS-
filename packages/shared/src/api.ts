// Transport-agnostic API client used by both the web app (cookies + CSRF) and the Android app
// (bearer tokens from Keystore-backed storage). It never logs request or response bodies.
import type {
  AdminUser, AuditEntry, Bill, BillAnalysis, BillEstimate, Calculation, QuoteOptions, QuotePreview, CalcInputs, CalcResults, Commercial, Customer,
  Dashboard, Me, Note, Notification, PermissionInfo, Project, Proposal, Role, SecurityOverview, SessionInfo,
} from "./types";

export class ApiError extends Error {
  constructor(public status: number, message: string, public errors?: { field: string; message: string }[]) {
    super(message);
  }
}

export interface AuthAdapter {
  /** Extra headers for each request (Authorization for mobile, X-CSRF-Token for web). */
  headers(method: string): Promise<Record<string, string>> | Record<string, string>;
  /** Try to refresh the session. Return true if the request should be retried. */
  refresh(): Promise<boolean>;
  credentials?: RequestCredentials;
  onSessionEnded?(): void;
}

type Body = unknown;

export class ApiClient {
  constructor(private baseUrl: string, private auth: AuthAdapter) {}

  private refreshing: Promise<boolean> | null = null;

  async raw(method: string, path: string, body?: Body, retry = true): Promise<Response> {
    const headers: Record<string, string> = { Accept: "application/json", ...(await this.auth.headers(method)) };
    let payload: BodyInit | undefined;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const res = await fetch(`${this.baseUrl}/api/v1${path}`, {
      method, headers, body: payload, credentials: this.auth.credentials ?? "same-origin",
    });
    if (res.status === 401 && retry && !path.startsWith("/auth/login") && !path.startsWith("/auth/refresh")) {
      this.refreshing ??= this.auth.refresh().finally(() => { this.refreshing = null; });
      if (await this.refreshing) return this.raw(method, path, body, false);
      this.auth.onSessionEnded?.();
    }
    if (!res.ok) {
      let detail = res.statusText || "Request failed";
      let errors;
      try {
        const j = await res.json();
        detail = typeof j.detail === "string" ? j.detail : detail;
        errors = j.errors;
      } catch { /* non-JSON error */ }
      throw new ApiError(res.status, detail, errors);
    }
    return res;
  }

  async json<T>(method: string, path: string, body?: Body): Promise<T> {
    const res = await this.raw(method, path, body);
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  get<T>(path: string) { return this.json<T>("GET", path); }
  post<T>(path: string, body?: Body) { return this.json<T>("POST", path, body ?? {}); }
  put<T>(path: string, body?: Body) { return this.json<T>("PUT", path, body); }
  patch<T>(path: string, body?: Body) { return this.json<T>("PATCH", path, body); }
  del<T>(path: string) { return this.json<T>("DELETE", path); }
}

const q = (params: Record<string, string | number | boolean | undefined | null>) => {
  const s = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  return s ? `?${s}` : "";
};
const id = (s: string) => encodeURIComponent(s);

export interface LoginResult {
  status?: string;
  mfa_required?: boolean;
  mfa_ticket?: string;
  access_token?: string;
  refresh_token?: string;
  csrf_token?: string;
  expires_in?: number;
}

/** Typed endpoint helpers. */
export function endpoints(api: ApiClient) {
  return {
    auth: {
      departments: () => api.get<{ id: string; name: string }[]>("/auth/departments"),
      signup: (b: { full_name: string; email: string; password: string; department_id?: string | null }) =>
        api.post<{ detail: string }>("/auth/signup", b),
      verifyEmail: (token: string) => api.post<{ detail: string }>("/auth/verify-email", { token }),
      resendVerification: (email: string) => api.post<{ detail: string }>("/auth/resend-verification", { email }),
      login: (email: string, password: string, client: "web" | "mobile") =>
        api.post<LoginResult>("/auth/login", { email, password, client }),
      mfaLogin: (mfa_ticket: string, code: string, client: "web" | "mobile") =>
        api.post<LoginResult>("/auth/mfa/login", { mfa_ticket, code, client }),
      me: () => api.get<Me>("/auth/me"),
      logout: () => api.post<{ detail: string }>("/auth/logout"),
      mfaSetup: () => api.post<{ secret: string; otpauth_uri: string }>("/auth/mfa/setup"),
      mfaEnable: (code: string) => api.post<{ detail: string }>("/auth/mfa/enable", { code }),
      mfaDisable: (password: string, code: string) => api.post<{ detail: string }>("/auth/mfa/disable", { password, code }),
      forgot: (email: string) => api.post<{ detail: string }>("/auth/forgot-password", { email }),
      reset: (token: string, password: string) => api.post<{ detail: string }>("/auth/reset-password", { token, password }),
      changePassword: (current_password: string, new_password: string) =>
        api.post<{ detail: string }>("/auth/change-password", { current_password, new_password }),
      sessions: () => api.get<SessionInfo[]>("/auth/sessions"),
      revokeSession: (sid: string) => api.del<{ detail: string }>(`/auth/sessions/${id(sid)}`),
    },
    users: {
      list: (status?: string, search?: string) => api.get<AdminUser[]>(`/users${q({ status, q: search })}`),
      approve: (uid: string, role_id: string, department_id?: string | null) =>
        api.post<AdminUser>(`/users/${id(uid)}/approve`, { role_id, department_id }),
      reject: (uid: string, reason: string) => api.post<AdminUser>(`/users/${id(uid)}/reject`, { reason }),
      update: (uid: string, b: { role_id?: string; department_id?: string; full_name?: string }) =>
        api.patch<AdminUser>(`/users/${id(uid)}`, b),
      disable: (uid: string) => api.post<AdminUser>(`/users/${id(uid)}/disable`),
      enable: (uid: string) => api.post<AdminUser>(`/users/${id(uid)}/enable`),
      unlock: (uid: string) => api.post<AdminUser>(`/users/${id(uid)}/unlock`),
      resetMfa: (uid: string) => api.post<AdminUser>(`/users/${id(uid)}/reset-mfa`),
      revokeSessions: (uid: string) => api.post<{ revoked: number }>(`/users/${id(uid)}/revoke-sessions`),
      directory: () => api.get<{ id: string; full_name: string; role: string | null }[]>("/users-directory"),
    },
    roles: {
      list: () => api.get<Role[]>("/roles"),
      permissions: () => api.get<PermissionInfo[]>("/roles/permissions"),
      create: (b: { name: string; description: string; permissions: string[] }) => api.post<Role>("/roles", b),
      update: (rid: string, b: { name: string; description: string; permissions: string[] }) =>
        api.patch<Role>(`/roles/${id(rid)}`, b),
      remove: (rid: string) => api.del<{ detail: string }>(`/roles/${id(rid)}`),
    },
    customers: {
      list: (search?: string, limit = 50, offset = 0) =>
        api.get<{ total: number; items: Customer[] }>(`/customers${q({ q: search, limit, offset })}`),
      get: (cid: string) => api.get<Customer>(`/customers/${id(cid)}`),
      create: (b: Partial<Customer>) => api.post<Customer>("/customers", b),
      update: (cid: string, b: Partial<Customer> & { owner_id?: string }) => api.patch<Customer>(`/customers/${id(cid)}`, b),
      remove: (cid: string) => api.del<{ detail: string }>(`/customers/${id(cid)}`),
      assign: (cid: string, user_id: string) => api.post(`/customers/${id(cid)}/assignments`, { user_id }),
      unassign: (cid: string, uid: string) => api.del(`/customers/${id(cid)}/assignments/${id(uid)}`),
      notes: (cid: string) => api.get<Note[]>(`/customers/${id(cid)}/notes`),
      addNote: (cid: string, body: string) => api.post<Note>(`/customers/${id(cid)}/notes`, { body }),
      bills: (cid: string) => api.get<Bill[]>(`/customers/${id(cid)}/bills`),
      analysis: (cid: string) => api.get<BillAnalysis>(`/customers/${id(cid)}/bill-analysis`),
      uploadBills: (cid: string, form: FormData) => api.json<Bill[]>("POST", `/customers/${id(cid)}/bills`, form),
    },
    projects: {
      list: (p: { customer_id?: string; stage?: string; mine?: boolean; limit?: number; offset?: number } = {}) =>
        api.get<Project[]>(`/projects${q(p)}`),
      get: (pid: string) => api.get<Project>(`/projects/${id(pid)}`),
      create: (b: { customer_id: string; name: string; site_address?: string; estimated_value_inr?: number;
        target_capacity_kwh?: number; engineer_id?: string | null }) => api.post<Project>("/projects", b),
      update: (pid: string, b: Partial<Omit<Project, "engineer">> & { engineer_id?: string | null }) =>
        api.patch<Project>(`/projects/${id(pid)}`, b),
      bills: (pid: string) => api.get<Bill[]>(`/projects/${id(pid)}/bills`),
      analysis: (pid: string) => api.get<BillAnalysis>(`/projects/${id(pid)}/bill-analysis`),
      calculations: (pid: string) => api.get<Calculation[]>(`/projects/${id(pid)}/calculations`),
      saveCalculation: (pid: string, name: string, inputs: Partial<CalcInputs>) =>
        api.post<Calculation>(`/projects/${id(pid)}/calculations`, { name, inputs }),
      proposals: (pid: string) => api.get<Proposal[]>(`/projects/${id(pid)}/proposals`),
      createProposal: (pid: string, calculation_id: string, title?: string) =>
        api.post<Proposal>(`/projects/${id(pid)}/proposals`, title ? { calculation_id, title } : { calculation_id }),
    },
    bills: {
      get: (bid: string) => api.get<Bill>(`/bills/${id(bid)}`),
      review: (bid: string, values: Record<string, unknown>, confirm = true) =>
        api.put<Bill>(`/bills/${id(bid)}/review`, { values, confirm }),
      reprocess: (bid: string) => api.post<Bill>(`/bills/${id(bid)}/reprocess`),
      remove: (bid: string) => api.del(`/bills/${id(bid)}`),
      fileUrl: (bid: string) => `/api/v1/bills/${id(bid)}/file`,
      estimate: (bid: string) => api.get<BillEstimate>(`/bills/${id(bid)}/estimate`),
    },
    calculator: {
      defaults: () => api.get<Record<string, number> & { confidential?: Record<string, number> }>("/calculator/defaults"),
      preview: (inputs: Partial<CalcInputs>) =>
        api.post<{ results: CalcResults; commercial?: Commercial }>("/calculator/preview", inputs),
      get: (cid: string) => api.get<Calculation>(`/calculations/${id(cid)}`),
      validate: (cid: string, decision: "approved" | "rejected", note: string) =>
        api.post<Calculation>(`/calculations/${id(cid)}/validate`, { decision, note }),
      compare: (ids: string[]) => api.post<Record<string, number | string | null>[]>("/calculations/compare", { ids }),
    },
    proposals: {
      list: (status?: string) => api.get<Proposal[]>(`/proposals${q({ status })}`),
      get: (pid: string) => api.get<Proposal>(`/proposals/${id(pid)}`),
      submit: (pid: string) => api.post<Proposal>(`/proposals/${id(pid)}/submit`),
      approve: (pid: string, note: string) => api.post<Proposal>(`/proposals/${id(pid)}/approve`, { note }),
      reject: (pid: string, note: string) => api.post<Proposal>(`/proposals/${id(pid)}/reject`, { note }),
      setStatus: (pid: string, status: "sent" | "accepted" | "declined", note = "") =>
        api.post<Proposal>(`/proposals/${id(pid)}/status`, { status, note }),
      share: (pid: string, b: { recipient_note: string; days: number; max_downloads?: number }) =>
        api.post<{ id: string; url: string; expires_at: string }>(`/proposals/${id(pid)}/share`, b),
      shares: (pid: string) => api.get<{ id: string; recipient_note: string; expires_at: string; revoked_at: string | null;
        download_count: number; max_downloads: number; created_at: string }[]>(`/proposals/${id(pid)}/shares`),
      revokeShare: (pid: string, sid: string) => api.del(`/proposals/${id(pid)}/shares/${id(sid)}`),
      pdfPath: (pid: string) => `/api/v1/proposals/${id(pid)}/pdf`,
    },
    notifications: {
      list: (unread = false) => api.get<{ unread: number; items: Notification[] }>(`/notifications${q({ unread })}`),
      read: (nid: string) => api.post(`/notifications/${id(nid)}/read`),
      readAll: () => api.post("/notifications/read-all"),
      registerPush: (token: string) => api.post("/push-tokens", { token }),
    },
    dashboard: () => api.get<Dashboard>("/dashboard"),
    quotations: {
      appConfig: () => api.get<{ single_user_mode: boolean }>("/app-config"),
      defaults: () => api.get<{ options: QuoteOptions; purposes: Record<string, string>; gst_pct: number;
        company: Record<string, string>; single_user_mode: boolean }>("/quotations/defaults"),
      /** Upload the customer's bill(s); without customerId a customer + project are created from the bill. */
      start: (form: FormData) => api.json<{ customer_id: string; project_id: string; bills: Bill[] }>("POST", "/quotations/start", form),
      preview: (pid: string, b: { inputs?: Partial<CalcInputs> | null; options?: Partial<QuoteOptions> }) =>
        api.post<QuotePreview>(`/projects/${id(pid)}/quotation/preview`, b),
      create: (pid: string, b: { inputs?: Partial<CalcInputs> | null; options?: Partial<QuoteOptions>; calculation_id?: string }) =>
        api.post<Proposal>(`/projects/${id(pid)}/quotation`, b),
    },
    settings: {
      company: () => api.get<Record<string, string>>("/settings/company"),
      saveCompany: (b: Record<string, string>) => api.put<Record<string, string>>("/settings/company", b),
      commercial: () => api.get<Record<string, number>>("/settings/commercial"),
      saveCommercial: (b: Record<string, number>) => api.put<Record<string, number>>("/settings/commercial", b),
    },
    security: {
      overview: () => api.get<SecurityOverview>("/security/overview"),
      audit: (p: { category?: string; action?: string; actor?: string; outcome?: string; days?: number } = {}) =>
        api.get<AuditEntry[]>(`/security/audit${q(p)}`),
      logins: () => api.get<AuditEntry[]>("/security/logins"),
      sessions: () => api.get<SessionInfo[]>("/admin/sessions"),
      revokeSession: (sid: string) => api.del(`/admin/sessions/${id(sid)}`),
      aiUsage: () => api.get<{ id: string; model: string; input_tokens: number; output_tokens: number;
        cost_usd: number; outcome: string; created_at: string }[]>("/security/ai-usage"),
      verifyAudit: () => api.get<{ valid: boolean; checked: number; broken_at_id: number | null }>("/security/audit/verify"),
    },
  };
}

export type Endpoints = ReturnType<typeof endpoints>;
