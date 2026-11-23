import { useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";
import { ErrorBox, Field } from "../../components/ui";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { AuthShell } from "./AuthPages";

/** Shown to users who are logged in but not yet approved (or otherwise inactive). */
export function PendingPage() {
  const { me, logout, refresh } = useAuth();
  const text: Record<string, string> = {
    pending_approval: "Your account is awaiting approval. An administrator will assign your role shortly. " +
      "You'll receive an email when you can start.",
    pending_verification: "Please verify your email address using the link we sent you.",
  };
  return (
    <AuthShell title={`Hello, ${me?.full_name?.split(" ")[0] ?? ""}`}>
      <div className="stack">
        <div className="notice">{text[me?.status ?? ""] ?? "Your account is not active."}</div>
        <p className="small muted">Signed in as {me?.email}. You can't see customers, projects or pricing until approved.</p>
        <div className="row">
          <button onClick={() => refresh()}>Check again</button>
          <button className="ghost" onClick={logout}>Log out</button>
        </div>
      </div>
    </AuthShell>
  );
}

export function MfaSetup({ onDone }: { onDone: () => void }) {
  const [setup, setSetup] = useState<{ secret: string; otpauth_uri: string } | null>(null);
  const [qr, setQr] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<unknown>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // each call issues a new secret; run once
    started.current = true;
    api.auth.mfaSetup().then(async (s) => {
      setSetup(s);
      setQr(await QRCode.toDataURL(s.otpauth_uri, { margin: 1, width: 200 }));
    }, setError);
  }, []);

  return (
    <div className="stack">
      <ErrorBox error={error} />
      <ol className="small" style={{ paddingLeft: 18, margin: 0 }}>
        <li>Install an authenticator app (Microsoft Authenticator, Google Authenticator, …).</li>
        <li>Scan this QR code, or enter the key manually.</li>
        <li>Type the 6-digit code it shows.</li>
      </ol>
      {qr && <img src={qr} alt="MFA QR code" width={200} height={200} style={{ alignSelf: "center", background: "#fff", padding: 6, borderRadius: 8 }} />}
      {setup && <div className="mono" style={{ textAlign: "center", wordBreak: "break-all" }}>{setup.secret}</div>}
      <form className="stack" onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        try { await api.auth.mfaEnable(code); onDone(); } catch (err) { setError(err); }
      }}>
        <Field label="6-digit code">
          <input inputMode="numeric" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
        </Field>
        <button className="primary" disabled={!setup}>Turn on MFA</button>
      </form>
    </div>
  );
}

export function MfaSetupPage({ forced }: { forced?: boolean }) {
  const qc = useQueryClient();
  const { logout } = useAuth();
  return (
    <AuthShell title="Set up two-step verification">
      {forced && <div className="info" style={{ marginBottom: 12 }}>
        Your role has administrator or commercial privileges, so two-step verification is required.
      </div>}
      <MfaSetup onDone={() => qc.invalidateQueries({ queryKey: ["me"] })} />
      <button className="ghost" style={{ marginTop: 8 }} onClick={logout}>Log out</button>
    </AuthShell>
  );
}
