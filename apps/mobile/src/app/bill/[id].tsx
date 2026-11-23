import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BILL_FIELD_LABELS, BILL_STATUS_LABELS, PERM, SECURITY_FLAG_LABELS, TEXT_BILL_FIELDS } from "@skj/shared";
import { router, useLocalSearchParams } from "expo-router";
import { usePreventScreenCapture } from "expo-screen-capture";
import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { EstimateCard } from "../../components/estimate";
import { Badge, Button, Card, confirm, ErrorBox, Input, Loading, Notice, P, s, statusTone, useTheme } from "../../components/ui";
import { useAuth } from "../../lib/auth";
import { openFile } from "../../lib/files";
import { api } from "../../lib/session";

export default function BillScreen() {
  usePreventScreenCapture("bill");
  const { id } = useLocalSearchParams<{ id: string }>();
  const { can } = useAuth();
  const t = useTheme();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["bill", id], queryFn: () => api.bills.get(id),
    refetchInterval: (x) => (["queued", "scanning", "extracting"].includes(x.state.data?.status ?? "") ? 3000 : false) });
  // Automatic estimate, recalculated whenever the bill is read or its values are saved.
  const estimate = useQuery({
    queryKey: ["bill-estimate", id, q.data?.status, JSON.stringify(q.data?.reviewed ?? null)],
    queryFn: () => api.bills.estimate(id),
    enabled: can(PERM.calculatorUse) && ["needs_review", "reviewed"].includes(q.data?.status ?? ""),
  });
  const [values, setValues] = useState<Record<string, string>>({});
  const [fileError, setFileError] = useState<unknown>(null);
  const [opening, setOpening] = useState(false);
  const bill = q.data;

  useEffect(() => {
    if (!bill) return;
    const src = (bill.reviewed ?? bill.extracted ?? {}) as Record<string, unknown>;
    setValues(Object.fromEntries((bill.editable_fields ?? []).map((k) => [k, src[k] === null || src[k] === undefined ? "" : String(src[k])])));
  }, [bill?.id, bill?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: (confirm: boolean) => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(values)) {
        if (k === "document_is_electricity_bill" || k === "confidence") continue;
        out[k] = v === "" ? null : TEXT_BILL_FIELDS.has(k) ? v : Number(v);
      }
      return api.bills.review(id, out, confirm);
    },
    onSuccess: () => { void q.refetch(); void qc.invalidateQueries({ queryKey: ["customer-bills"] }); void qc.invalidateQueries({ queryKey: ["project-bills"] }); },
  });

  const reprocess = useMutation({ mutationFn: () => api.bills.reprocess(id), onSuccess: () => void q.refetch() });
  const remove = useMutation({ mutationFn: () => api.bills.remove(id), onSuccess: () => {
    void qc.invalidateQueries({ queryKey: ["customer-bills"] }); void qc.invalidateQueries({ queryKey: ["project-bills"] }); router.back();
  } });

  if (q.isLoading) return <Loading />;
  if (q.error || !bill) return <View style={s.content}><ErrorBox error={q.error} /></View>;
  const editable = can(PERM.billsReview) && ["needs_review", "reviewed"].includes(bill.status);
  const fields = (bill.editable_fields ?? []).filter((k) => k !== "document_is_electricity_bill" && k !== "confidence");

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <Card title={bill.file_name}>
        <View style={[s.row, { marginBottom: 6 }]}>
          <Badge label={BILL_STATUS_LABELS[bill.status]} tone={statusTone(bill.status)} />
          <Badge label={`scan: ${bill.scan_status}`} />
          {!!bill.extraction_method && <Badge label={`method: ${bill.extraction_method}`} />}
        </View>
        <P small muted>{bill.status_detail}</P>
        <ErrorBox error={fileError || reprocess.error || remove.error} />
        <View style={[s.row, { marginTop: 8 }]}>
          {["clean", "skipped"].includes(bill.scan_status) && (
            <Button small variant="primary" title="View original" loading={opening} onPress={async () => {
              setFileError(null); setOpening(true);
              try { await openFile(api.bills.fileUrl(bill.id), bill.file_name, bill.mime); }
              catch (e) { setFileError(e); } finally { setOpening(false); }
            }} />
          )}
          {can(PERM.billsUpload) && bill.status !== "rejected" && <Button small title="Re-extract" onPress={() => reprocess.mutate()} />}
          {can(PERM.billsUpload) && <Button small variant="danger" title="Delete" onPress={() =>
            confirm("Delete bill?", "The file and its extracted data will be permanently deleted.", () => remove.mutate(), "Delete")} />}
        </View>
      </Card>
      {bill.security_flags.length > 0 && (
        <Notice>{"Check carefully:\n" + bill.security_flags.map((f) => `• ${SECURITY_FLAG_LABELS[f] ?? f.replace(/_/g, " ")}`).join("\n")}</Notice>
      )}
      {can(PERM.calculatorUse) && ["needs_review", "reviewed"].includes(bill.status) && <EstimateCard e={estimate.data} />}
      {["queued", "scanning", "extracting"].includes(bill.status) ? <Loading /> : (
        <Card title="Extracted values">
          <View style={[s.row, { gap: 10 }]}>
            {fields.map((k) => (
              <Input key={k} label={BILL_FIELD_LABELS[k] ?? k} value={values[k] ?? ""} editable={editable}
                keyboardType={TEXT_BILL_FIELDS.has(k) ? "default" : "decimal-pad"}
                onChangeText={(v) => setValues({ ...values, [k]: TEXT_BILL_FIELDS.has(k) ? v : v.replace(/[^0-9.-]/g, "") })} />
            ))}
          </View>
          <ErrorBox error={save.error} />
          {save.isSuccess && <Notice tone="ok">Saved.</Notice>}
          {editable && (
            <View style={s.row}>
              <Button title="Confirm values" variant="primary" onPress={() => save.mutate(true)} loading={save.isPending} />
              <Button title="Save draft" onPress={() => save.mutate(false)} disabled={save.isPending} />
            </View>
          )}
          <P small muted style={{ marginTop: 8 }}>Automatic extraction can be wrong. Compare with the paper or PDF bill before confirming.</P>
        </Card>
      )}
    </ScrollView>
  );
}
