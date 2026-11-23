import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDate, PERM, PROPOSAL_STATUS_LABELS } from "@skj/shared";
import { Stack, useLocalSearchParams } from "expo-router";
import { usePreventScreenCapture } from "expo-screen-capture";
import { useState } from "react";
import { RefreshControl, ScrollView, Share, View } from "react-native";
import { CalcResultsMobile } from "../../components/calc";
import { QuotationSummary } from "../../components/quotation";
import { Badge, Button, Card, ErrorBox, Input, Loading, Notice, P, Row, s, statusTone, useTheme } from "../../components/ui";
import { useAuth } from "../../lib/auth";
import { openPdf, sharePdf } from "../../lib/files";
import { api } from "../../lib/session";

export default function ProposalScreen() {
  usePreventScreenCapture("proposal");
  const { id } = useLocalSearchParams<{ id: string }>();
  const { can, me } = useAuth();
  const t = useTheme();
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [fileError, setFileError] = useState<unknown>(null);
  const [busyFile, setBusyFile] = useState(false);
  const q = useQuery({ queryKey: ["proposal", id], queryFn: () => api.proposals.get(id) });
  const shares = useQuery({ queryKey: ["shares", id], queryFn: () => api.proposals.shares(id), enabled: can(PERM.proposalsShare) });
  const refresh = () => { void q.refetch(); void qc.invalidateQueries({ queryKey: ["proposals"] }); };
  const act = useMutation({
    mutationFn: (a: "submit" | "approve" | "reject" | "sent" | "accepted" | "declined") =>
      a === "submit" ? api.proposals.submit(id) : a === "approve" ? api.proposals.approve(id, note)
        : a === "reject" ? api.proposals.reject(id, note) : api.proposals.setStatus(id, a, note),
    onSuccess: () => { setNote(""); refresh(); },
  });
  const link = useMutation({
    mutationFn: () => api.proposals.share(id, { recipient_note: note || "Shared from Android app", days: 7 }),
    onSuccess: async (r) => { void shares.refetch(); refresh(); await Share.share({ message: `SKJ Energy proposal (link valid 7 days): ${r.url}` }); },
  });

  const revoke = useMutation({ mutationFn: (sid: string) => api.proposals.revokeShare(id, sid), onSuccess: () => void shares.refetch() });

  async function withFile(fn: () => Promise<void>) {
    setFileError(null);
    setBusyFile(true);
    try { await fn(); } catch (e) { setFileError(e); } finally { setBusyFile(false); }
  }

  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <View style={s.content}><ErrorBox error={q.error} /></View>;
  const p = q.data;
  const own = p.created_by_id === me?.id;
  const shareable = ["approved", "sent", "accepted"].includes(p.status);
  const pdfName = p.quotation ? `Quotation-${p.quotation.number.replace(/\//g, "-")}.pdf` : `SKJ-Proposal-R${p.revision}.pdf`;

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={refresh} />}>
      <Stack.Screen options={{ title: p.quotation ? "Quotation" : `${p.customer_name} · R${p.revision}` }} />
      <Card title={p.title}>
        <View style={[s.row, { marginBottom: 6 }]}><Badge label={PROPOSAL_STATUS_LABELS[p.status]} tone={statusTone(p.status)} /></View>
        <Row label="Project" value={p.project_name} />
        <Row label="Created" value={formatDate(p.created_at)} />
        {p.approved_at && <Row label="Approved" value={formatDate(p.approved_at)} />}
        {!!p.status_note && <P small style={{ marginTop: 6 }}>Note: “{p.status_note}”</P>}
      </Card>

      <Card title="Document">
        <ErrorBox error={fileError} />
        <View style={s.row}>
          <Button title="Preview PDF" variant="primary" loading={busyFile} disabled={!p.has_pdf}
            onPress={() => withFile(() => openPdf(api.proposals.pdfPath(p.id), pdfName))} />
          {can(PERM.proposalsShare) && shareable && (
            <Button title="Share PDF" disabled={busyFile} onPress={() => withFile(() => sharePdf(api.proposals.pdfPath(p.id), pdfName))} />
          )}
        </View>
        {!shareable && <P small muted style={{ marginTop: 6 }}>Draft proposals carry a “DRAFT” watermark and can't be shared.</P>}
      </Card>
      {p.quotation && <QuotationSummary q={p.quotation} />}

      <Card title="Actions">
        <ErrorBox error={act.error || link.error} />
        <Input label="Note (optional)" value={note} onChangeText={setNote} multiline maxLength={2000} />
        <View style={s.row}>
          {can(PERM.proposalsCreate) && ["draft", "rejected"].includes(p.status) &&
            <Button title="Submit for approval" variant="primary" onPress={() => act.mutate("submit")} />}
          {can(PERM.proposalsApprove) && p.status === "pending_approval" && !own && <>
            <Button title="Approve" variant="primary" onPress={() => act.mutate("approve")} />
            <Button title="Return" variant="danger" onPress={() => act.mutate("reject")} />
          </>}
          {(can(PERM.proposalsShare) || can(PERM.proposalsApprove)) && ["approved", "sent"].includes(p.status) && <>
            <Button title="Customer accepted" onPress={() => act.mutate("accepted")} />
            <Button title="Declined" variant="danger" onPress={() => act.mutate("declined")} />
          </>}
          {can(PERM.proposalsShare) && shareable && <Button title="Send secure link" onPress={() => link.mutate()} loading={link.isPending} />}
        </View>
        {can(PERM.proposalsApprove) && p.status === "pending_approval" && own && <Notice tone="info">Someone else must approve your proposal.</Notice>}
      </Card>

      {!!shares.data?.length && (
        <Card title="Share links">
          <ErrorBox error={revoke.error} />
          {shares.data.map((x) => (
            <View key={x.id} style={{ marginBottom: 6 }}>
              <Row label={x.recipient_note || "Link"} value={x.revoked_at ? "Revoked" : `${x.download_count}/${x.max_downloads} · until ${formatDate(x.expires_at)}`} />
              {!x.revoked_at && <View style={{ alignItems: "flex-end", marginTop: 4 }}>
                <Button small title="Revoke link" onPress={() => revoke.mutate(x.id)} /></View>}
            </View>
          ))}
        </Card>
      )}

      {p.results && !p.quotation && <CalcResultsMobile results={p.results} />}
    </ScrollView>
  );
}
