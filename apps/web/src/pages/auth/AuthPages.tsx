import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ChargeMeter, ErrorBox, Field } from "../../components/ui";
import { api } from "../../lib/api";

export function AuthShell({ title, children, foot }: { title: string; children: ReactNode; foot?: ReactNode }) {
  return (
    <div className="auth-wrap">
      <aside className="auth-side" aria-hidden="true">
        <div className="brand"><img src="/favicon.svg" alt="" />SKJ Energy Solutions</div>
        <div>
          <ChargeMeter pct={80} size="lg" showPct={false} label="" />
          <h2 style={{ marginTop: 20 }}>Size, price and propose battery storage in one place.</h2>
          <p>Upload a customer's electricity bills, model peak shaving and time-of-day savings, and send an approved proposal.</p>
        </div>
        <p className="small">Internal BESS platform</p>
      </aside>
      <main className="auth-main">
        <div className="auth-card">
          <div className="brand">
            <img src="/favicon.svg" alt="" style={{ width: 36, height: 36 }} />
            <div>SKJ Energy Solutions<small>Internal BESS platform</small></div>
          </div>
          <div className="card">
            <h2>{title}</h2>
            {children}
          </div>
          {foot && <div className="row" style={{ justifyContent: "center", marginTop: 14 }}>{foot}</div>}
          <p className="small muted" style={{ textAlign: "center", marginTop: 16 }}>
            For authorised SKJ employees only. Activity is logged.
          </p>
        </div>
      </main>
    </div>
  );
}

export function LoginPage() {
  const qc = useQueryClient();
  const cfg = useQuery({ queryKey: ["app-config"], queryFn: api.quotations.appConfig, staleTime: Infinity });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [ticket, setTicket] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = ticket ? await api.auth.mfaLogin(ticket, code, "web") : await api.auth.login(email, password, "web");
      if (r.mfa_required && r.mfa_ticket) {
        setTicket(r.mfa_ticket);
        setPassword("");
      } else {
        await qc.invalidateQueries({ queryKey: ["me"] });
      }
    } catch (err) {
      setError(err);
      if (ticket) setCode("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title={ticket ? "Enter your authenticator code" : "Log in"}
      foot={<>{!cfg.data?.single_user_mode && <><Link to="/signup">Create an account</Link><span className="muted">·</span></>}<Link to="/forgot-password">Forgot password?</Link></>}>
      <form className="stack" onSubmit={submit}>
        <ErrorBox error={error} />
        {!ticket ? (
          <>
            <Field label="Work email">
              <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Password">
              <input type="password" autoComplete="current-password" required value={password}
                onChange={(e) => setPassword(e.target.value)} />
            </Field>
          </>
        ) : (
          <Field label="6-digit code" help="Open your authenticator app (e.g. Microsoft Authenticator).">
            <input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required autoFocus
              value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
          </Field>
        )}
        <button className="primary" disabled={busy}>{busy ? "Please wait…" : ticket ? "Verify" : "Log in"}</button>
        {ticket && <button type="button" className="ghost" onClick={() => { setTicket(null); setCode(""); }}>Back</button>}
      </form>
    </AuthShell>
  );
}

export function SignupPage() {
  const depts = useQuery({ queryKey: ["departments"], queryFn: api.auth.departments });
  const [form, setForm] = useState({ full_name: "", email: "", password: "", confirm: "", department_id: "" });
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (form.password !== form.confirm) return setError(new Error("Passwords do not match"));
    if (form.password.length < 12) return setError(new Error("Password must be at least 12 characters"));
    setBusy(true);
    setError(null);
    try {
      const r = await api.auth.signup({ full_name: form.full_name, email: form.email, password: form.password,
        department_id: form.department_id || null });
      setDone(r.detail);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <AuthShell title="Check your email" foot={<Link to="/login">Back to log in</Link>}>
        <div className="stack">
          <div className="success">{done}</div>
          <ol className="small muted" style={{ paddingLeft: 18, margin: 0 }}>
            <li>Click the link in the email to verify your address.</li>
            <li>An administrator reviews your account and assigns your role.</li>
            <li>You'll get an email when you can start using the app.</li>
          </ol>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Create your account" foot={<>Already registered? <Link to="/login">Log in</Link></>}>
      <form className="stack" onSubmit={submit}>
        <ErrorBox error={error} />
        <Field label="Full name"><input required minLength={2} maxLength={200} value={form.full_name} onChange={set("full_name")} /></Field>
        <Field label="Work email" help="Use your SKJ company email address.">
          <input type="email" required autoComplete="username" value={form.email} onChange={set("email")} />
        </Field>
        <Field label="Department (optional)">
          <select value={form.department_id} onChange={set("department_id")}>
            <option value="">Select…</option>
            {depts.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        <Field label="Password" help="At least 12 characters. A short sentence works well.">
          <input type="password" required minLength={12} maxLength={128} autoComplete="new-password" value={form.password}
            onChange={set("password")} />
        </Field>
        <Field label="Confirm password">
          <input type="password" required autoComplete="new-password" value={form.confirm} onChange={set("confirm")} />
        </Field>
        <button className="primary" disabled={busy}>{busy ? "Creating…" : "Sign up"}</button>
        <p className="small muted">New accounts can't see any data until an administrator approves them.</p>
      </form>
    </AuthShell>
  );
}

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [state, setState] = useState<{ ok?: string; error?: unknown }>({});
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    // Remove the token from the address bar and history straight away.
    window.history.replaceState(null, "", "/verify-email");
    api.auth.verifyEmail(token).then((r) => setState({ ok: r.detail }), (e) => setState({ error: e }));
  }, [token]);
  return (
    <AuthShell title="Email verification" foot={<Link to="/login">Go to log in</Link>}>
      {state.ok && <div className="success">{state.ok}</div>}
      <ErrorBox error={state.error} />
      {!state.ok && !state.error && <p className="muted">Verifying…</p>}
    </AuthShell>
  );
}

export function ForgotPage() {
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  return (
    <AuthShell title="Reset your password" foot={<Link to="/login">Back to log in</Link>}>
      <form className="stack" onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        try { setMsg((await api.auth.forgot(email)).detail); } catch (err) { setError(err); }
      }}>
        <ErrorBox error={error} />
        {msg ? <div className="success">{msg}</div> : (
          <>
            <Field label="Work email"><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <button className="primary">Send reset link</button>
          </>
        )}
      </form>
    </AuthShell>
  );
}

export function ResetPage() {
  const [params] = useSearchParams();
  const [token] = useState(params.get("token") ?? "");
  const nav = useNavigate();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { window.history.replaceState(null, "", "/reset-password"); }, []);
  return (
    <AuthShell title="Choose a new password">
      <form className="stack" onSubmit={async (e) => {
        e.preventDefault();
        if (pw !== pw2) return setError(new Error("Passwords do not match"));
        try {
          await api.auth.reset(token, pw);
          nav("/login", { replace: true });
        } catch (err) { setError(err); }
      }}>
        <ErrorBox error={error} />
        <Field label="New password" help="At least 12 characters.">
          <input type="password" required minLength={12} autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        </Field>
        <Field label="Confirm"><input type="password" required value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
        <button className="primary">Update password</button>
      </form>
    </AuthShell>
  );
}
