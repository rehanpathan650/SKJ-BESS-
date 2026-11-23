// Shapes returned by the SKJ API (/api/v1). Kept in one place so web and mobile agree.

export type UserStatus = "pending_verification" | "pending_approval" | "active" | "rejected" | "disabled";

export interface Ref { id: string; name: string }
export interface PersonRef { id: string; full_name: string }

export interface Me {
  id: string;
  email: string;
  full_name: string;
  status: UserStatus;
  role: Ref | null;
  department: Ref | null;
  permissions: string[];
  mfa_enabled: boolean;
  mfa_required: boolean;
  session_id: string;
  /** One account generates quotations end to end (no sign-up, no approval chain). */
  single_user_mode?: boolean;
}

export interface AdminUser {
  id: string;
  email: string;
  full_name: string;
  status: UserStatus;
  role: Ref | null;
  department: Ref | null;
  requested_department: Ref | null;
  mfa_enabled: boolean;
  locked_until: string | null;
  last_login_at: string | null;
  created_at: string;
}

export interface Role {
  id: string;
  name: string;
  description: string;
  is_system: boolean;
  permissions: string[];
  user_count: number;
}

export interface PermissionInfo { key: string; description: string; requires_mfa: boolean }

export interface Customer {
  id: string;
  name: string;
  company: string;
  industry: string;
  contact_name: string;
  email: string;
  phone: string;
  state: string;
  discom: string;
  tariff_category: string;
  owner: PersonRef | null;
  department_id: string | null;
  updated_at: string;
  created_at: string;
  address?: string;
  gstin?: string;
  consumer_number?: string;
  assignments?: { user_id: string; full_name: string }[];
  projects?: Project[];
}

export type ProjectStage =
  | "lead" | "site_survey" | "technical_validation" | "proposal" | "negotiation"
  | "won" | "installation" | "commissioned" | "lost";

export interface Project {
  id: string;
  name: string;
  customer_id: string;
  customer_name: string;
  site_address: string;
  stage: ProjectStage;
  progress_pct: number;
  estimated_value_inr: number;
  target_capacity_kwh: number;
  engineer: PersonRef | null;
  owner: PersonRef | null;
  created_at: string;
  updated_at: string;
  bill_count?: number;
  calculation_count?: number;
  proposal_count?: number;
}

export interface Note { id: string; body: string; author: string; created_at: string }

export type BillStatus = "queued" | "scanning" | "extracting" | "needs_review" | "reviewed" | "failed" | "rejected";

export interface Bill {
  id: string;
  customer_id: string;
  project_id: string | null;
  status: BillStatus;
  status_detail: string;
  file_name: string;
  file_size: number;
  mime: string;
  scan_status: string;
  extraction_method: string;
  security_flags: string[];
  created_at: string;
  reviewed_at: string | null;
  bill_month: string | null;
  units_kwh: number | null;
  extracted?: Record<string, unknown> | null;
  reviewed?: Record<string, unknown> | null;
  editable_fields?: string[];
}

export interface BillAnalysis {
  bill_count: number;
  message?: string;
  avg_monthly_kwh?: number | null;
  max_recorded_demand_kva?: number | null;
  contract_demand_kva?: number | null;
  avg_monthly_bill_inr?: number | null;
  effective_rate_inr_per_kwh?: number | null;
  peak_share_pct?: number;
  demand_charge_share_pct?: number | null;
  monthly?: { month: string | null; units_kwh: number | null; max_demand_kva: number | null; total_inr: number | null }[];
  insights?: string[];
  calculator_prefill?: Partial<CalcInputs>;
  /** "reviewed" = values confirmed by a person; "unreviewed" = extracted values not yet confirmed. */
  basis?: "reviewed" | "unreviewed";
  /** Automatic estimate (only for users with calculator access). */
  estimate?: BillEstimate;
}

/** Automatic BESS estimate from bills: an indication, not a quote (proposals need a validated configuration). */
export interface BillEstimate {
  available: boolean;
  basis: "reviewed" | "unreviewed";
  bill_count: number;
  reason?: string;
  inputs?: CalcInputs;
  results?: CalcResults;
  commercial?: Commercial;
}

export interface CalcInputs {
  monthly_consumption_kwh: number;
  peak_share_pct: number;
  peak_window_hours: number;
  peak_tariff_inr: number;
  offpeak_tariff_inr: number;
  contract_demand_kva: number;
  recorded_max_demand_kva: number;
  demand_charge_inr_per_kva: number;
  min_billing_demand_pct: number;
  power_factor: number;
  peak_shaving_kva: number | null;
  battery_capacity_kwh: number;
  battery_power_kw: number;
  depth_of_discharge_pct: number;
  round_trip_efficiency_pct: number;
  cycles_per_day: number;
  operating_days_per_year: number;
  degradation_pct_per_year: number | null;
  project_life_years: number | null;
  tariff_escalation_pct: number | null;
  discount_rate_pct: number | null;
  om_pct_of_capex: number | null;
  sales_discount_pct: number;
  /** Quotation options */
  project_value_ex_gst_inr?: number | null;
  proposed_contract_demand_kva?: number | null;
  count_cd_revision_in_savings?: boolean;
}

export interface YearRow {
  year: number;
  battery_health_pct: number;
  energy_shifted_kwh: number;
  arbitrage_saving_inr: number;
  demand_saving_inr: number;
  om_cost_inr: number;
  net_saving_inr: number;
  cumulative_inr: number;
}

export interface CalcResults {
  summary: {
    battery_capacity_kwh: number;
    battery_power_kw: number;
    usable_capacity_kwh: number;
    c_rate: number;
    duration_hours: number;
    daily_energy_shifted_kwh: number;
    peak_daily_load_kwh: number;
    peak_shaving_kva: number;
    billed_demand_before_kva: number;
    billed_demand_after_kva: number;
  };
  financial: {
    price_ex_gst_inr: number;
    gst_inr: number;
    capex_inr: number;
    year1_arbitrage_saving_inr: number;
    year1_demand_saving_inr: number;
    year1_om_cost_inr: number;
    year1_net_saving_inr: number;
    monthly_saving_inr: number;
    lifetime_net_saving_inr: number;
    simple_payback_years: number | null;
    discounted_payback_years: number | null;
    npv_inr: number;
    irr_pct: number | null;
    roi_pct: number | null;
    lcos_inr_per_kwh: number | null;
    project_life_years: number;
    discount_rate_pct: number;
    tariff_escalation_pct: number;
  };
  yearly: YearRow[];
  warnings: string[];
  assumptions_note: string;
}

export interface Commercial {
  vendor_battery_cost_inr: number;
  vendor_pcs_cost_inr: number;
  installation_cost_inr: number;
  total_cost_inr: number;
  list_price_ex_gst_inr: number;
  sales_discount_pct: number;
  gross_margin_inr: number;
  gross_margin_pct: number;
}

export interface Calculation {
  id: string;
  project_id: string;
  name: string;
  inputs: CalcInputs;
  results: CalcResults;
  commercial?: Commercial;
  validation_status: "pending" | "approved" | "rejected";
  validation_note: string;
  validated_at: string | null;
  created_by_id: string;
  created_at: string;
}

export type ProposalStatus =
  | "draft" | "pending_approval" | "approved" | "rejected" | "sent" | "accepted" | "declined" | "superseded";

export interface Proposal {
  id: string;
  project_id: string;
  project_name: string;
  customer_id: string;
  customer_name: string;
  calculation_id: string;
  revision: number;
  title: string;
  status: ProposalStatus;
  status_note: string;
  created_by_id: string;
  approved_by_id: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
  has_pdf: boolean;
  has_quotation?: boolean;
  quotation_number?: string | null;
  /** Full techno-commercial quotation (only on GET /proposals/{id}). */
  quotation?: Quotation | null;
  key_figures: {
    battery_capacity_kwh: number;
    battery_power_kw: number;
    capex_inr: number;
    year1_net_saving_inr: number;
    simple_payback_years: number | null;
    irr_pct: number | null;
  };
  results?: CalcResults;
}

export interface Notification {
  id: string;
  kind: string;
  title: string;
  body: string;
  link: string;
  read: boolean;
  created_at: string;
}

export interface Dashboard {
  kpis: {
    customers: number;
    active_projects: number;
    pipeline_value_inr: number;
    pipeline_capacity_kwh: number;
    won_projects: number;
    win_rate_pct: number | null;
    proposals_pending_approval: number;
    pending_technical_validations: number;
    bills_to_review: number;
    gross_margin_in_open_proposals_inr?: number;
  };
  projects_by_stage: Record<string, number>;
  proposals_by_status: Record<string, number>;
  /** New pipeline created and won per month, last 12 months (oldest first). */
  pipeline_by_month?: { month: string; created_value_inr: number; won_value_inr: number; projects: number }[];
  my_projects: { id: string; name: string; customer_name: string; stage: ProjectStage; progress_pct: number }[];
  opportunities: {
    id: string; name: string; customer_name: string; stage: ProjectStage;
    estimated_value_inr: number; target_capacity_kwh: number;
  }[];
}

export interface AuditEntry {
  id: number;
  ts: string;
  category: string;
  action: string;
  outcome: string;
  actor_id: string | null;
  actor_email: string;
  target_type: string;
  target_id: string;
  ip: string;
  details: Record<string, unknown>;
}

export interface SecurityOverview {
  logins_24h: number;
  failed_logins_24h: number;
  locked_accounts: number;
  permission_denials_24h: number;
  rate_limited_24h: number;
  active_sessions: number;
  pending_users: number;
  ai_calls_month: number;
  ai_cost_month_usd: number;
  alerts: { severity: "high" | "medium" | "low"; type: string; message: string }[];
}

export interface SessionInfo {
  id: string;
  client_type: string;
  ip: string;
  user_agent: string;
  created_at: string;
  last_used_at: string;
  current?: boolean;
  user?: { id: string; email: string; full_name: string };
}

// ---------- Techno-commercial quotation ----------

export interface QuoteMilestone { label: string; pct: number }

export interface QuoteOptions {
  purpose: "peak_shift" | "peak_shaving" | "solar_shift" | "all";
  backup: "none" | "critical" | "full";
  financing: boolean;
  down_payment_pct: number;
  interest_pct: number;
  tenure_years: number;
  milestones: QuoteMilestone[];
  validity_days: number;
  execution_weeks: string;
  battery_warranty_years: number;
  pcs_warranty_years: number;
  extra_notes: string;
}

export interface SizeOption {
  battery_capacity_kwh: number; battery_power_kw: number; price_ex_gst_inr: number; net_year1: number;
  payback_years: number | null; npv: number; irr_pct: number | null; recommended: boolean;
}

export interface Quotation {
  number: string;
  date: string;
  valid_until: string;
  company: { name: string; address?: string; phone?: string; email?: string; gstin?: string; signatory?: string };
  customer: { name: string | null; address: string | null; consumer_number: string | null; activity: string | null };
  subject: string;
  purpose: string;
  executive_summary: string;
  recommendation: string;
  narrative_source: "ai" | "rules";
  bill: { month: string | null; rows: [string, string][] };
  observations: string[];
  system: { capacity_kwh: number; power_kw: number; duration_h: number; usable_kwh: number; rows: [string, string][] };
  size_options: SizeOption[];
  operating_strategy: string[];
  boq: { lines: { sr: number; item: string; amount: number }[]; subtotal: number; gst_pct: number; gst: number; total: number };
  payment_schedule: { milestone: string; pct: number; amount: number }[];
  financing: null | {
    project_cost: number; down_payment_pct: number; down_payment: number; loan: number; interest_pct: number;
    tenure_years: number; emi: number; months: number; total_payments: number; total_interest: number;
    total_outlay: number; net_monthly_during_loan: number;
    yearly: { year: number; principal: number; interest: number; closing_balance: number }[];
  };
  savings: {
    tod_yearly: number; battery_peak_shaving_yearly: number; cd_revision_yearly: number; cd_revision_counted: boolean;
    proposed_contract_demand_kva: number | null; om_yearly: number; net_year1: number; monthly: number;
    payback_years: number | null; discounted_payback_years: number | null; irr_pct: number | null; npv: number;
    lifetime: number; project_life_years: number; capex: number; yearly: YearRow[]; warnings: string[]; assumptions: string[];
  };
  scope: string[];
  warranty: string[];
  implementation: string;
  terms: string[];
}

export interface QuotePreview { inputs: CalcInputs; content: Quotation; commercial?: Commercial }
