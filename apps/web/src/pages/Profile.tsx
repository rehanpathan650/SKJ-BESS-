import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDate } from "@skj/shared";
import { useState } from "react";
import { Card, ErrorBox, Field, PageHead } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { MfaSetup } from "./auth/Gates";

export function ProfilePage() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const sessions = useQuery({ queryKey: ["my-sessions"], queryFn: api.auth.sessions });
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [enrolling, setEnrolling] = useState(false);
  const [disable, setDisable] = useState({ password: "", code: "" });
  const change = useMutation({
    mutationFn: () => {
      if (pw.next !== pw.confirm) throw new Error("New passwords do not match");
      return api.auth.changePassword(pw.current, pw.next);
    },
    onSuccess: () => { setPw({ current: "", next: "", confirm: "" }); sessions.refetch(); },
  });
  const revoke = useMutation({ mutationFn: api.auth.revokeSession, onSuccess: () => sessions.refetch() });
  const off = useMutation({ mutationFn: () => api.auth.mfaDisable(disable.password, disable.code),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }) });

  return (
    <>
      <PageHead title="My profile & security" sub={`${me?.email} · ${me?.role?.name ?? ""}`} />
      <div className="grid cols-2">
        <Card title="Change password">
          <form className="stack" onSubmit={(e) => { e.preventDefault(); change.mutate(); }}>
            <ErrorBox error={change.error} />
            {change.isSuccess && <div className="success">{change.data.detail}</div>}
            <Field label="Current password"><input type="password" autoComplete="current-password" required value={pw.current}
              onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
            <Field label="New password" help="At least 12 characters"><input type="password" autoComplete="new-password" minLength={12} required
              value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
            <Field label="Confirm new password"><input type="password" autoComplete="new-password" required value={pw.confirm}
              onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></Field>
            <div><button className="primary">Change password</button></div>
          </form>
        </Card>
        <Card title="Two-step verification (MFA)">
          {me?.mfa_enabled ? (
            <div className="stack">
              <div className="success">MFA is on for your account.</div>
              {!me.mfa_required && (
                <form className="stack" onSubmit={(e) => { e.preventDefault(); off.mutate(); }}>
                  <ErrorBox error={off.error} />
                  <div className="form-grid">
                    <Field label="Password"><input type="password" value={disable.password} onChange={(e) => setDisable({ ...disable, password: e.target.value })} /></Field>
                    <Field label="Current code"><input inputMode="numeric" maxLength={6} value={disable.code}
                      onChange={(e) => setDisable({ ...disable, code: e.target.value.replace(/\D/g, "") })} /></Field>
                  </div>
                  <div><button className="danger">Turn off MFA</button></div>
                </form>
              )}
            </div>
          ) : enrolling ? <MfaSetup onDone={() => { setEnrolling(false); qc.invalidateQueries({ queryKey: ["me"] }); }} /> : (
            <div className="stack">
              <p>Protect your account with an authenticator app.</p>
              <div><button className="primary" onClick={() => setEnrolling(true)}>Set up MFA</button></div>
            </div>
          )}
        </Card>
      </div>
      <div className="spacer" />
      <Card title="Where you're signed in">
        <ErrorBox error={revoke.error} />
        <table>
          <thead><tr><th>Device</th><th>IP</th><th>Signed in</th><th>Last active</th><th /></tr></thead>
          <tbody>{sessions.data?.map((s) => (
            <tr key={s.id}>
              <td>{s.client_type === "mobile" ? "Android app" : "Web browser"}<div className="small muted">{s.user_agent.slice(0, 80)}</div></td>
              <td className="mono">{s.ip}</td><td>{formatDate(s.created_at, true)}</td><td>{formatDate(s.last_used_at, true)}</td>
              <td className="right">{s.current ? <span className="badge brand">This device</span> :
                <button className="small" onClick={() => revoke.mutate(s.id)}>Sign out</button>}</td>
            </tr>
          ))}</tbody>
        </table>
      </Card>
    </>
  );
}
