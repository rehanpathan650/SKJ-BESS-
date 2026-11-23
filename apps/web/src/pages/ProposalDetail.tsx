import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDate, PERM, PROPOSAL_STATUS_LABELS } from "@skj/shared";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CalcResultsView } from "../components/Calculator";
import { QuotationView } from "../components/Quotation";
import { Card, ConfirmButton, ErrorBox, Field, Loading, PageHead, StatusBadge } from "../components/ui";
import { api, downloadFile, fetchBlobUrl } from "../lib/api";
import { useAuth } from "../lib/auth";

export function ProposalDetailPage() {
  const { id = "" } = useParams();
  const { can, me } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["proposal", id], queryFn: () => api.proposals.get(id) });
  const shares = useQuery({ queryKey: ["shares", id], queryFn: () => api.proposals.shares(id), enabled: can(PERM.proposalsShare) });
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [share, setShare] = useState({ recipient_note: "", days: 7 });
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const p = q.data;

  useEffect(() => {
    let url: string | null = null;
    if (p?.has_pdf) fetchBlobUrl(api.proposals.pdfPath(p.id)).then((u) => { url = u; setPdfUrl(u); });
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [p?.id, p?.status, p?.has_pdf]);

  const refresh = () => { qc.invalidateQueries({ queryKey: ["proposal", id] }); qc.invalidateQueries({ queryKey: ["proposals"] }); };
  const act = useMutation({
    mutationFn: async (a: "submit" | "approve" | "reject" | "sent" | "accepted" | "declined") => {
      if (a === "submit") return api.proposals.submit(id);
      if (a === "approve") return api.proposals.approve(id, note);
      if (a === "reject") return api.proposals.reject(id, note);
      return api.proposals.setStatus(id, a, note);
    },
    onSuccess: () => { setNote(""); refresh(); },
  });
  const createShare = useMutation({ mutationFn: () => api.proposals.share(id, share),
    onSuccess: (r) => { setShareUrl(r.url); shares.refetch(); refresh(); } });
  const revoke = useMutation({ mutationFn: (sid: string) => api.proposals.revokeShare(id, sid), onSuccess: () => shares.refetch() });

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  if (!p) return null;
  const own = p.created_by_id === me?.id;
  const canApprove = can(PERM.proposalsApprove) && p.status === "pending_approval" && !own;

  return (
    <>
      <PageHead title={p.quotation ? `Quotation ${p.quotation.number}` : `${p.title} · R${p.revision}`}
        sub={<><Link to={`/customers/${p.customer_id}`}>{p.customer_name}</Link> · <Link to={`/projects/${p.project_id}`}>{p.project_name}</Link></>}
        actions={p.has_pdf && <button className="primary" onClick={() => downloadFile(api.proposals.pdfPath(p.id),
          p.quotation ? `Quotation-${p.quotation.number.replace(/\//g, "-")}.pdf` : `SKJ-Proposal-R${p.revision}.pdf`)}>Download PDF</button>} />
      <div className="grid cols-2">
        <Card title="Status">
          <div className="stack">
            <div className="row"><StatusBadge status={p.status} /> <span>{PROPOSAL_STATUS_LABELS[p.status]}</span></div>
            {p.status_note && <p className="small">Note: “{p.status_note}”</p>}
            <p className="small muted">Created {formatDate(p.created_at, true)}{p.approved_at && ` · approved ${formatDate(p.approved_at, true)}`}</p>
            <ErrorBox error={act.error} />
            {(canApprove || ["approved", "sent"].includes(p.status)) && (
              <Field label="Note (optional)"><textarea value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} /></Field>
            )}
            <div className="row">
              {can(PERM.proposalsCreate) && ["draft", "rejected"].includes(p.status) &&
                <button className="primary" onClick={() => act.mutate("submit")}>Submit for approval</button>}
              {canApprove && <>
                <button className="primary" onClick={() => act.mutate("approve")}>Approve</button>
                <button className="danger" onClick={() => act.mutate("reject")}>Return for changes</button>
              </>}
              {can(PERM.proposalsApprove) && p.status === "pending_approval" && own &&
                <span className="small muted">Someone else must approve your proposal.</span>}
              {(can(PERM.proposalsShare) || can(PERM.proposalsApprove)) && ["approved", "sent"].includes(p.status) && <>
                {p.status === "approved" && <button onClick={() => act.mutate("sent")}>Mark as sent</button>}
                <button onClick={() => act.mutate("accepted")}>Customer accepted</button>
                <ConfirmButton message="Mark as declined?" onConfirm={() => act.mutate("declined")}>Customer declined</ConfirmButton>
              </>}
            </div>
          </div>
        </Card>
        {can(PERM.proposalsShare) && (
          <Card title="Secure share links">
            {["approved", "sent", "accepted"].includes(p.status) ? (
              <form className="stack" onSubmit={(e) => { e.preventDefault(); createShare.mutate(); }}>
                <ErrorBox error={createShare.error} />
                <div className="form-grid">
                  <Field label="Recipient (for the log)"><input maxLength={200} value={share.recipient_note}
                    onChange={(e) => setShare({ ...share, recipient_note: e.target.value })} placeholder="e.g. CFO, Shree Textiles" /></Field>
                  <Field label="Expires after (days)"><input type="number" min={1} max={30} value={share.days}
                    onChange={(e) => setShare({ ...share, days: Number(e.target.value) })} /></Field>
                </div>
                <div><button className="primary">Create link</button></div>
                {shareUrl && <div className="success" style={{ wordBreak: "break-all" }}>
                  Link (shown once): <span className="mono">{shareUrl}</span>{" "}
                  <button type="button" className="small" onClick={() => navigator.clipboard.writeText(shareUrl)}>Copy</button>
                </div>}
              </form>
            ) : <p className="muted">Only approved proposals can be shared.</p>}
            {!!shares.data?.length && (
              <table style={{ marginTop: 12 }}><thead><tr><th>Recipient</th><th>Expires</th><th className="num">Downloads</th><th /></tr></thead>
                <tbody>{shares.data.map((s) => (
                  <tr key={s.id}><td>{s.recipient_note || "–"}</td><td>{s.revoked_at ? "Revoked" : formatDate(s.expires_at)}</td>
                    <td className="num">{s.download_count}/{s.max_downloads}</td>
                    <td className="right">{!s.revoked_at && <button className="small" onClick={() => revoke.mutate(s.id)}>Revoke</button>}</td></tr>
                ))}</tbody></table>
            )}
          </Card>
        )}
      </div>
      <div className="spacer" />
      {p.quotation && <><QuotationView q={p.quotation} /><div className="spacer" /></>}
      <div className="split">
        <Card title="PDF preview">
          {pdfUrl ? <iframe className="pdf-frame" src={pdfUrl} title="Proposal PDF" /> : <p className="muted">No PDF.</p>}
        </Card>
        {p.results && !p.quotation && <CalcResultsView results={p.results} />}
      </div>
    </>
  );
}
