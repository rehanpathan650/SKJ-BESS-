import type { BillStatus, ProjectStage, ProposalStatus } from "./types";

/** Indian-style grouping: 12,34,567 */
export function formatINR(value: number | null | undefined, opts: { compact?: boolean } = {}): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "–";
  if (opts.compact) {
    const abs = Math.abs(value);
    if (abs >= 1e7) return `₹${(value / 1e7).toFixed(2)} Cr`;
    if (abs >= 1e5) return `₹${(value / 1e5).toFixed(2)} L`;
  }
  return "₹" + Math.round(value).toLocaleString("en-IN");
}

export function formatNumber(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "–";
  return value.toLocaleString("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

/** Parse a server timestamp. Times without a zone (SQLite in development) are UTC, not local time. */
export function parseApiDate(iso: string): Date {
  return new Date(/[zZ]$|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + "Z");
}

/** True while a server timestamp (e.g. an account lock) is still in the future. */
export function isFuture(iso: string | null | undefined): boolean {
  return !!iso && parseApiDate(iso).getTime() > Date.now();
}

export function formatDate(iso: string | null | undefined, withTime = false): string {
  if (!iso) return "–";
  const d = parseApiDate(iso);
  return withTime
    ? d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export const STAGE_LABELS: Record<ProjectStage, string> = {
  lead: "Lead",
  site_survey: "Site survey",
  technical_validation: "Technical validation",
  proposal: "Proposal",
  negotiation: "Negotiation",
  won: "Won",
  installation: "Installation",
  commissioned: "Commissioned",
  lost: "Lost",
};
export const STAGES = Object.keys(STAGE_LABELS) as ProjectStage[];

export const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string> = {
  draft: "Draft",
  pending_approval: "Awaiting approval",
  approved: "Approved",
  rejected: "Returned",
  sent: "Sent to customer",
  accepted: "Accepted",
  declined: "Declined",
  superseded: "Superseded",
};

export const BILL_STATUS_LABELS: Record<BillStatus, string> = {
  queued: "Queued",
  scanning: "Scanning for malware",
  extracting: "Reading bill",
  needs_review: "Needs review",
  reviewed: "Reviewed",
  failed: "Failed",
  rejected: "Rejected (malware)",
};

export const BILL_FIELD_LABELS: Record<string, string> = {
  document_is_electricity_bill: "Is an electricity bill",
  consumer_name: "Consumer name",
  consumer_number: "Consumer number",
  discom: "DISCOM",
  tariff_category: "Tariff category",
  bill_month: "Bill month (YYYY-MM)",
  billing_days: "Billing days",
  sanctioned_load_kw: "Sanctioned load (kW)",
  contract_demand_kva: "Contract demand (kVA)",
  recorded_max_demand_kva: "Recorded max demand (kVA)",
  billed_demand_kva: "Billed demand (kVA)",
  units_kwh: "Units consumed (kWh)",
  units_kvah: "Units (kVAh)",
  power_factor: "Power factor",
  tod_peak_kwh: "Peak ToD units (kWh)",
  tod_normal_kwh: "Normal ToD units (kWh)",
  tod_offpeak_kwh: "Off-peak ToD units (kWh)",
  energy_rate_inr_per_unit: "Energy rate (₹/unit)",
  demand_rate_inr_per_kva: "Demand rate (₹/kVA)",
  tod_peak_surcharge_inr_per_unit: "Peak ToD surcharge (₹/unit)",
  energy_charge_inr: "Energy charges (₹)",
  demand_charge_inr: "Demand charges (₹)",
  fixed_charge_inr: "Fixed charges (₹)",
  electricity_duty_inr: "Electricity duty (₹)",
  other_charges_inr: "Other charges (₹)",
  total_amount_inr: "Total amount (₹)",
  confidence: "Extraction confidence (0–1)",
  notes: "Notes",
};

export const TEXT_BILL_FIELDS = new Set(["consumer_name", "consumer_number", "discom", "tariff_category", "bill_month", "notes"]);

export const SECURITY_FLAG_LABELS: Record<string, string> = {
  possible_prompt_injection: "Document contains text that tries to instruct the AI. Values may be manipulated.",
  ai_reported_embedded_instructions: "The AI noticed embedded instructions in the document.",
  script_like_content: "Document contains script-like content.",
  hidden_unicode_characters: "Document contains hidden characters.",
  pdf_active_content_ignored: "PDF contained active content (ignored, never executed).",
  not_an_electricity_bill: "This may not be an electricity bill.",
  tod_sum_mismatch: "ToD units don't add up to total units.",
  max_demand_far_above_contract: "Recorded demand is far above contract demand.",
  invalid_ai_output: "AI output was invalid and was discarded.",
  daily_ai_limit_reached: "Daily AI limit reached; rule-based extraction used.",
  monthly_ai_budget_reached: "Monthly AI budget reached; rule-based extraction used.",
};

/** Default calculator inputs (matches the backend defaults). */
export const DEFAULT_CALC_INPUTS = {
  monthly_consumption_kwh: 100000,
  peak_share_pct: 25,
  peak_window_hours: 4,
  peak_tariff_inr: 10.5,
  offpeak_tariff_inr: 7,
  contract_demand_kva: 0,
  recorded_max_demand_kva: 0,
  demand_charge_inr_per_kva: 0,
  min_billing_demand_pct: 75,
  power_factor: 0.95,
  peak_shaving_kva: null,
  battery_capacity_kwh: 500,
  battery_power_kw: 250,
  depth_of_discharge_pct: 90,
  round_trip_efficiency_pct: 88,
  cycles_per_day: 1,
  operating_days_per_year: 300,
  degradation_pct_per_year: null,
  project_life_years: null,
  tariff_escalation_pct: null,
  discount_rate_pct: null,
  om_pct_of_capex: null,
  sales_discount_pct: 0,
} as const;
