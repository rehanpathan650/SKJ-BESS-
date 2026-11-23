import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BILL_FIELD_LABELS, BILL_STATUS_LABELS, PERM, SECURITY_FLAG_LABELS, TEXT_BILL_FIELDS } from "@skj/shared";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { EstimateCard } from "../components/Estimate";
import { Card, ConfirmButton, ErrorBox, Field, Loading, PageHead, StatusBadge } from "../components/ui";
import { api, downloadFile, fetchBlobUrl } from "../lib/api";
import { useAuth } from "../lib/auth";

export function BillReviewPage() {
  const { id = "" } = useParams();
  const { can } = useAuth();
  const qc = useQueryClient();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ["bill", id], queryFn: () => api.bills.get(id),
    refetchInterval: (x) => (["queued", "scanning", "extracting"].includes(x.state.data?.status ?? "") ? 3000 : false) });
  // Automatic estimate, recalculated whenever the bill is read or its values are saved.
  const estimate = useQuery({
    queryKey: ["bill-estimate", id, q.data?.status, q.data?.reviewed_at, JSON.stringify(q.data?.reviewed ?? null)],
    queryFn: () => api.bills.estimate(id),
    enabled: can(PERM.calculatorUse) && ["needs_review", "reviewed"].includes(q.data?.status ?? ""),
  });
  const [values, setValues] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<string | null>(null);
  const bill = q.data;

  useEffect(() => {
    if (!bill) return;
    const src = (bill.reviewed ?? bill.extracted ?? {}) as Record<string, unknown>;
    setValues(Object.fromEntries((bill.editable_fields ?? []).map((k) => [k, src[k] === null || src[k] === undefined ? "" : String(src[k])])));
  }, [bill?.id, bill?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let url: string | null = null;
    if (bill && ["clean", "skipped"].includes(bill.scan_status) && (bill.mime.startsWith("image/") || bill.mime === "application/pdf")) {
      fetchBlobUrl(api.bills.fileUrl(bill.id)).then((u) => { url = u; setPreview(u); }).catch(() => setPreview(null));
    }
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [bill?.id, bill?.scan_status]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: (confirm: boolean) => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(values)) {
        if (k === "document_is_electricity_bill" || k === "confidence") continue;
        out[k] = v === "" ? null : TEXT_BILL_FIELDS.has(k) ? v : Number(v);
      }
      return api.bills.review(id, out, confirm);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["bill", id] }); qc.invalidateQueries({ queryKey: ["customer-bills"] });
      qc.invalidateQueries({ queryKey: ["project-bills"] }); },
  });
  const reprocess = useMutation({ mutationFn: () => api.bills.reprocess(id), onSuccess: () => qc.invalidateQueries({ queryKey: ["bill", id] }) });
  const remove = useMutation({ mutationFn: () => api.bills.remove(id), onSuccess: () => nav(-1) });

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  if (!bill) return null;
  const editable = can(PERM.billsReview) && ["needs_review", "reviewed"].includes(bill.status);
  const fields = (bill.editable_fields ?? []).filter((k) => k !== "document_is_electricity_bill" && k !== "confidence");

  return (
    <>
      <PageHead title={bill.file_name}
        sub={<><Link to={`/customers/${bill.customer_id}`}>Customer</Link>{bill.project_id && <> · <Link to={`/projects/${bill.project_id}`}>Project</Link></>}
          {" · "}{BILL_STATUS_LABELS[bill.status]}</>}
        actions={<>
          {["clean", "skipped"].includes(bill.scan_status) && <button onClick={() => downloadFile(api.bills.fileUrl(bill.id), bill.file_name)}>Download</button>}
          {can(PERM.billsUpload) && bill.status !== "rejected" && <button onClick={() => reprocess.mutate()}>Re-extract</button>}
          {can(PERM.billsUpload) && <ConfirmButton className="danger" message="Delete bill?" onConfirm={() => remove.mutate()}>Delete</ConfirmButton>}
        </>} />
      <div className="stack">
        <div className="row"><StatusBadge status={bill.status} /><span className="muted small">{bill.status_detail}</span>
          <span className="badge">scan: {bill.scan_status}</span>{bill.extraction_method && <span className="badge">method: {bill.extraction_method}</span>}</div>
        {bill.security_flags.length > 0 && (
          <div className="notice">
            <strong>Check carefully:</strong>
            <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
              {bill.security_flags.map((f) => <li key={f}>{SECURITY_FLAG_LABELS[f] ?? f.replace(/_/g, " ")}</li>)}
            </ul>
          </div>
        )}
        <ErrorBox error={save.error || reprocess.error || remove.error} />
        {save.isSuccess && <div className="success">Saved{save.variables ? " and confirmed" : " as draft"}.</div>}
      </div>
      {can(PERM.calculatorUse) && ["needs_review", "reviewed"].includes(bill.status) && (
        <>
          <div className="spacer" />
          <EstimateCard e={estimate.data} action={bill.project_id
            ? <Link className="btn small" to={`/projects/${bill.project_id}`}>Open project</Link> : undefined} />
        </>
      )}
      <div className="spacer" />
      <div className="split">
        <Card title="Extracted values">
          {["queued", "scanning", "extracting"].includes(bill.status) ? <Loading what="Processing" /> : (
            <form onSubmit={(e) => { e.preventDefault(); save.mutate(true); }}>
              <div className="form-grid">
                {fields.map((k) => (
                  <Field key={k} label={BILL_FIELD_LABELS[k] ?? k}>
                    <input type={TEXT_BILL_FIELDS.has(k) ? "text" : "number"} step="any" disabled={!editable} value={values[k] ?? ""}
                      onChange={(e) => setValues({ ...values, [k]: e.target.value })} />
                  </Field>
                ))}
              </div>
              {editable && (
                <div className="row" style={{ marginTop: 16 }}>
                  <button className="primary" disabled={save.isPending}>Confirm values</button>
                  <button type="button" disabled={save.isPending} onClick={() => save.mutate(false)}>Save draft</button>
                </div>
              )}
              <p className="small muted" style={{ marginTop: 8 }}>
                AI and rule-based extraction can be wrong. Compare with the original bill before confirming.
              </p>
            </form>
          )}
        </Card>
        <Card title="Original document">
          {preview ? (bill.mime === "application/pdf"
            ? <iframe className="pdf-frame" src={preview} title="Bill preview" />
            : <img src={preview} alt="Bill" style={{ maxWidth: "100%", borderRadius: 8 }} />)
            : <p className="muted">Preview not available for this file type or scan status.</p>}
        </Card>
      </div>
    </>
  );
}
