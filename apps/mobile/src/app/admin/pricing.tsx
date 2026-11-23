import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PERM } from "@skj/shared";
import { usePreventScreenCapture } from "expo-screen-capture";
import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { Button, Card, ErrorBox, Input, Loading, Notice, P, s, useTheme } from "../../components/ui";
import { useAuth } from "../../lib/auth";
import { api } from "../../lib/session";

const FIELDS: [string, string, boolean][] = [
  ["vendor_battery_inr_per_kwh", "Vendor battery cost (₹/kWh)", true],
  ["vendor_pcs_inr_per_kw", "Vendor PCS/inverter cost (₹/kW)", true],
  ["installation_pct", "Installation & BoS (% of equipment)", true],
  ["margin_pct", "Target margin (%)", true],
  ["max_sales_discount_pct", "Max sales discount (%)", false],
  ["gst_pct", "GST (%)", false],
  ["om_pct_of_capex", "O&M (% of price per year)", false],
  ["discount_rate_pct", "Discount rate for NPV (%)", false],
  ["tariff_escalation_pct", "Tariff escalation (%/year)", false],
  ["degradation_pct_per_year", "Battery degradation (%/year)", false],
  ["project_life_years", "Project life (years)", false],
];

export default function Pricing() {
  usePreventScreenCapture("pricing"); // confidential vendor costs and margins
  const { can } = useAuth();
  const t = useTheme();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["commercial"], queryFn: api.settings.commercial });
  const [v, setV] = useState<Record<string, string>>({});
  useEffect(() => { if (q.data) setV(Object.fromEntries(Object.entries(q.data).map(([k, x]) => [k, String(x)]))); }, [q.data]);
  const save = useMutation({
    mutationFn: () => api.settings.saveCommercial(Object.fromEntries(FIELDS.map(([k]) => [k, Number(v[k])]))),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["commercial"] }),
  });
  const editable = can(PERM.pricingManage);
  if (q.isLoading) return <Loading />;
  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <Notice>Confidential. Vendor costs and margins are never shown to sales or included in proposals.</Notice>
      <Card title="Pricing & financial assumptions">
        <ErrorBox error={q.error || save.error} />
        {save.isSuccess && <Notice tone="ok">Saved. New calculations use these values.</Notice>}
        <View style={[s.row, { gap: 10 }]}>
          {FIELDS.map(([k, label, secret]) => (
            <Input key={k} label={label + (secret ? " 🔒" : "")} value={v[k] ?? ""} editable={editable} keyboardType="decimal-pad"
              onChangeText={(x) => setV({ ...v, [k]: x.replace(/[^0-9.-]/g, "") })} />
          ))}
        </View>
        {editable ? <Button title="Save assumptions" variant="primary" loading={save.isPending} onPress={() => save.mutate()} />
          : <P small muted>View only: editing needs the pricing.manage permission.</P>}
        <P small muted style={{ marginTop: 8 }}>Every change is recorded in the audit log with old and new values.</P>
      </Card>
    </ScrollView>
  );
}
