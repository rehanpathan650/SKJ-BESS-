import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PERM } from "@skj/shared";
import { useEffect, useState } from "react";
import { Card, ErrorBox, Field, Loading, PageHead } from "../../components/ui";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";

const FIELDS: [string, string, string, boolean][] = [
  ["vendor_battery_inr_per_kwh", "Vendor battery cost (₹/kWh)", "Confidential", true],
  ["vendor_pcs_inr_per_kw", "Vendor PCS/inverter cost (₹/kW)", "Confidential", true],
  ["installation_pct", "Installation & BoS (% of equipment)", "Confidential", true],
  ["margin_pct", "Target margin (%)", "Confidential", true],
  ["max_sales_discount_pct", "Max sales discount (%)", "Sales can't exceed this", false],
  ["gst_pct", "GST (%)", "", false],
  ["om_pct_of_capex", "O&M (% of price per year)", "", false],
  ["discount_rate_pct", "Discount rate for NPV (%)", "", false],
  ["tariff_escalation_pct", "Tariff escalation (%/year)", "", false],
  ["degradation_pct_per_year", "Battery degradation (%/year)", "", false],
  ["project_life_years", "Project life (years)", "", false],
];

export function PricingPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["commercial"], queryFn: api.settings.commercial });
  const [v, setV] = useState<Record<string, string>>({});
  useEffect(() => { if (q.data) setV(Object.fromEntries(Object.entries(q.data).map(([k, x]) => [k, String(x)]))); }, [q.data]);
  const save = useMutation({
    mutationFn: () => api.settings.saveCommercial(Object.fromEntries(FIELDS.map(([k]) => [k, Number(v[k])]))),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["commercial"] }),
  });
  const editable = can(PERM.pricingManage);
  if (q.isLoading) return <Loading />;
  return (
    <>
      <PageHead title="Pricing & financial assumptions"
        sub="Confidential. Vendor costs and margins are never shown to sales or included in proposals." />
      <Card>
        <form className="stack" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <ErrorBox error={q.error || save.error} />
          {save.isSuccess && <div className="success">Saved. New calculations use these values; existing ones keep theirs until re-validated.</div>}
          <div className="notice">Default figures are placeholders. Replace them with SKJ's current vendor quotes before quoting customers.</div>
          <div className="form-grid">
            {FIELDS.map(([k, label, help, secret]) => (
              <Field key={k} label={label} help={help}>
                <input type="number" step="any" min={0} disabled={!editable} value={v[k] ?? ""} style={secret ? { borderColor: "var(--charge)" } : undefined}
                  onChange={(e) => setV({ ...v, [k]: e.target.value })} />
              </Field>
            ))}
          </div>
          {editable && <div><button className="primary" disabled={save.isPending}>Save assumptions</button></div>}
          <p className="small muted">Every change is recorded in the audit log with old and new values.</p>
        </form>
      </Card>
      <CompanyCard editable={editable} />
    </>
  );
}

const COMPANY_FIELDS: [string, string][] = [["name", "Company name"], ["address", "Address"], ["phone", "Phone"],
  ["email", "Email"], ["gstin", "GSTIN"], ["signatory", "Authorised signatory"]];

/** Company details printed on every quotation (letterhead, GSTIN, signature block). */
function CompanyCard({ editable }: { editable: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["company"], queryFn: api.settings.company });
  const [v, setV] = useState<Record<string, string>>({});
  useEffect(() => { if (q.data) setV(q.data); }, [q.data]);
  const save = useMutation({ mutationFn: () => api.settings.saveCompany(v), onSuccess: () => qc.invalidateQueries({ queryKey: ["company"] }) });
  return (
    <Card title="Company details on quotations">
      <form className="stack" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <ErrorBox error={q.error || save.error} />
        {save.isSuccess && <div className="success">Saved. New quotations use these details.</div>}
        <div className="form-grid">
          {COMPANY_FIELDS.map(([k, label]) => (
            <Field key={k} label={label}>
              <input disabled={!editable} value={v[k] ?? ""} maxLength={k === "address" ? 400 : 200}
                onChange={(e) => setV({ ...v, [k]: k === "gstin" ? e.target.value.toUpperCase() : e.target.value })} />
            </Field>
          ))}
        </div>
        {editable && <div><button className="primary" disabled={save.isPending}>Save company details</button></div>}
      </form>
    </Card>
  );
}
