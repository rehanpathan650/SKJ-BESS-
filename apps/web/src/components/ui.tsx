import { ApiError, chargeSegments, toneOf, type Tone } from "@skj/shared";
import { AnimatePresence, motion } from "framer-motion";
import { Inbox, X } from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.errors?.length) return e.errors.map((x) => `${x.field || "input"}: ${x.message}`).join("; ");
    return e.message;
  }
  if (e instanceof Error) return e.message;
  return "Something went wrong";
}

export function ErrorBox({ error }: { error: unknown }) {
  return (
    <AnimatePresence initial={false}>
      {error ? (
        <motion.div className="error" role="alert" key="err" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }} transition={{ duration: 0.16 }}>
          {errorMessage(error)}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export function PageHead({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <div className="muted">{sub}</div>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children }: { title?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      {(title || actions) && (
        <div className="card-head">
          {title ? <h2>{title}</h2> : <span />}
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Kpi({ label, value, hint, tone, to }: {
  label: string; value: ReactNode; hint?: ReactNode; tone?: "accent" | "warn"; to?: string;
}) {
  const body = (
    <>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {hint && <div className="hint">{hint}</div>}
    </>
  );
  return to ? <Link to={to} className={`kpi ${tone ?? ""}`}>{body}</Link> : <div className={`kpi ${tone ?? ""}`}>{body}</div>;
}

export function Badge({ tone, children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge ${tone && tone !== "neutral" ? tone : ""}`}>{children}</span>;
}

/** Battery state-of-charge meter: the platform's signature element (progress, completion, utilisation). */
export function ChargeMeter({ pct, cells = 10, size, label, showPct = true }: {
  pct: number; cells?: number; size?: "lg"; label?: string; showPct?: boolean;
}) {
  const lit = chargeSegments(pct, cells);
  const value = Math.round(Math.max(0, Math.min(100, pct || 0)));
  return (
    <span className={`charge ${size ?? ""} ${value >= 100 ? "full" : ""}`} role="meter" aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={value} aria-label={label ?? `${value}% complete`}>
      <span className="cells">
        {Array.from({ length: cells }, (_, i) => (
          <motion.span key={i} className={`cell ${i < lit ? "on" : ""}`}
            initial={i < lit ? { opacity: 0.25 } : false} animate={{ opacity: 1 }} transition={{ delay: i * 0.03, duration: 0.15 }} />
        ))}
      </span>
      <span className="cap" />
      {showPct && <span className="pct">{value}%</span>}
    </span>
  );
}

export function Skeleton({ h = 16, w = "100%", style }: { h?: number; w?: number | string; style?: React.CSSProperties }) {
  return <div className="skeleton" style={{ height: h, width: w, ...style }} aria-hidden="true" />;
}

/** Loading placeholder shaped like the content it replaces (no layout jump when data arrives). */
export function Loading({ what = "Loading", variant = "list" }: { what?: string; variant?: "page" | "list" | "inline" }) {
  if (variant === "inline") return <div className="empty">{what}…</div>;
  return (
    <div role="status" aria-live="polite" aria-label={what}>
      {variant === "page" && (
        <>
          <Skeleton h={28} w={260} style={{ marginBottom: 8 }} />
          <Skeleton h={14} w={340} style={{ marginBottom: 22 }} />
          <div className="grid kpis" style={{ marginBottom: 16 }}>
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} h={92} />)}
          </div>
        </>
      )}
      <div className="card stack">
        {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} h={18} w={`${92 - i * 9}%`} />)}
      </div>
    </div>
  );
}

export function Empty({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return <div className="empty">{icon ?? <Inbox size={28} aria-hidden="true" />}{children}</div>;
}

export function Field({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return (
    <label className="field">
      {label}
      {children}
      {help && <span className="help">{help}</span>}
    </label>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <motion.div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }}>
      <motion.div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}
        initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}>
        <div className="card-head">
          <h2>{title}</h2>
          <button className="ghost" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        {children}
      </motion.div>
    </motion.div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  const id = useId();
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.key} role="tab" aria-selected={value === t.key} className={value === t.key ? "active" : ""}
          onClick={() => onChange(t.key)}>
          {t.label}
          {value === t.key && <motion.span className="tab-line" layoutId={`tab-${id}`} transition={{ duration: 0.22 }} />}
        </button>
      ))}
    </div>
  );
}

export function Progress({ pct }: { pct: number }) {
  return <ChargeMeter pct={pct} />;
}

/** Button that asks for confirmation before running an irreversible action. */
export function ConfirmButton({ onConfirm, children, message, className }: {
  onConfirm: () => void; children: ReactNode; message: string; className?: string;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking) return <button className={className} onClick={() => setAsking(true)}>{children}</button>;
  return (
    <span className="row">
      <span className="small muted">{message}</span>
      <button className="small danger" onClick={() => { setAsking(false); onConfirm(); }}>Yes</button>
      <button className="small" onClick={() => setAsking(false)}>No</button>
    </span>
  );
}

/** Ranked horizontal bars for a single series (labels on the left, values on the right). */
export function BarList({ data, format = (n: number) => String(n), onSelect }: {
  data: [string, number][]; format?: (n: number) => string; onSelect?: (label: string) => void;
}) {
  const max = Math.max(1, ...data.map(([, v]) => v));
  if (!data.length) return <Empty>No data yet</Empty>;
  return (
    <div className="bars">
      {data.map(([k, v], i) => (
        <div className="bar-row" key={k} title={`${k}: ${format(v)}`}
          style={onSelect ? { cursor: "pointer" } : undefined} onClick={onSelect ? () => onSelect(k) : undefined}>
          <span>{k}</span>
          <div className="bar-track">
            <motion.div className="bar-fill" style={{ width: `${(v / max) * 100}%` }} initial={{ scaleX: 0 }} animate={{ scaleX: 1 }}
              transition={{ delay: i * 0.04, duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }} />
          </div>
          <span className="right tabular">{format(v)}</span>
        </div>
      ))}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={toneOf(status)}>{status.replace(/_/g, " ")}</Badge>;
}

/** "Load more" for paged lists. */
export function LoadMore({ shown, total, onMore, loading }: { shown: number; total?: number; onMore: () => void; loading?: boolean }) {
  if (total !== undefined && shown >= total) return null;
  return (
    <div className="load-more">
      <button onClick={onMore} disabled={loading}>
        {loading ? "Loading…" : total !== undefined ? `Show more (${shown} of ${total})` : `Show more (showing ${shown})`}
      </button>
    </div>
  );
}
