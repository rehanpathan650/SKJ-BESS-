import { useQuery } from "@tanstack/react-query";
import { PERM } from "@skj/shared";
import { motion } from "framer-motion";
import {
  Bell, Building2, Calculator, FilePlus2, FileText, FolderKanban, Gauge, KeyRound, LogOut, Menu, Monitor, Moon, ShieldCheck, Sun,
  UserCircle, Users, Wallet,
} from "lucide-react";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { getTheme, setTheme, type ThemePref } from "../theme";
import { Loading } from "./ui";

function ThemeSwitch() {
  const [t, setT] = useState<ThemePref>(getTheme());
  const opts: [ThemePref, ReactNode, string][] = [["light", <Sun size={14} />, "Light"], ["system", <Monitor size={14} />, "Match system"],
    ["dark", <Moon size={14} />, "Dark"]];
  return (
    <div className="theme-switch" role="group" aria-label="Colour theme">
      {opts.map(([key, icon, label]) => (
        <button key={key} className="small" aria-pressed={t === key} title={label} aria-label={label}
          onClick={() => { setTheme(key); setT(key); }}>{icon}</button>
      ))}
    </div>
  );
}

export function Layout() {
  const { me, can, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  const notes = useQuery({ queryKey: ["notifications", "count"], queryFn: () => api.notifications.list(true), refetchInterval: 60_000 });
  const pendingUsers = useQuery({ queryKey: ["users", "pending-count"], queryFn: () => api.users.list("pending_approval"),
    enabled: can(PERM.usersView) && !me?.single_user_mode, refetchInterval: 120_000 });
  const unread = notes.data?.unread ?? 0;

  const link = (to: string, label: string, icon: ReactNode, badge?: number) => (
    <NavLink to={to} end={to === "/"}>
      {icon}<span>{label}</span>
      {badge ? <span className="count" aria-label={`${badge} new`}>{badge}</span> : null}
    </NavLink>
  );
  const admin = can(PERM.usersView) || can(PERM.rolesManage) || can(PERM.pricingManage) || can(PERM.securityView) || can(PERM.auditView);

  return (
    <div className="app">
      <header className="topbar-mobile">
        <button aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(true)}><Menu size={22} /></button>
        <strong>SKJ Energy</strong>
        <NavLink to="/notifications" aria-label={`Notifications, ${unread} unread`}><Bell size={20} />{unread ? unread : null}</NavLink>
      </header>
      <aside className={`sidebar ${open ? "open" : ""}`} aria-label="Main navigation" onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
        <div className="brand">
          <img src="/favicon.svg" alt="" />
          <div>SKJ Energy<small>BESS platform</small></div>
        </div>
        <nav className="nav">
          {can(PERM.proposalsCreate) && can(PERM.billsUpload) && link("/quotations/new", "New quotation", <FilePlus2 size={18} />)}
          {link("/", "Dashboard", <Gauge size={18} />)}
          {link("/customers", "Customers", <Building2 size={18} />)}
          {link("/projects", "Projects", <FolderKanban size={18} />)}
          {can(PERM.calculatorUse) && link("/calculator", "BESS calculator", <Calculator size={18} />)}
          {can(PERM.proposalsView) && link("/proposals", me?.single_user_mode ? "Quotations" : "Proposals", <FileText size={18} />)}
          {link("/notifications", "Notifications", <Bell size={18} />, unread)}
          {admin && <div className="nav-group">Administration</div>}
          {/* Single-login mode: no sign-ups to approve and no roles to hand out. */}
          {!me?.single_user_mode && can(PERM.usersView) && link("/admin/users", "Users & approvals", <Users size={18} />, pendingUsers.data?.length)}
          {!me?.single_user_mode && (can(PERM.rolesManage) || can(PERM.usersView)) && link("/admin/roles", "Roles & permissions", <KeyRound size={18} />)}
          {can(PERM.confidential) && link("/admin/pricing", "Pricing & assumptions", <Wallet size={18} />)}
          {(can(PERM.securityView) || can(PERM.auditView)) && link("/security", "Security", <ShieldCheck size={18} />)}
          <div className="nav-group">Account</div>
          {link("/profile", "My profile & security", <UserCircle size={18} />)}
        </nav>
        <div className="sidebar-foot">
          <div><strong>{me?.full_name}</strong></div>
          <div className="muted">{me?.role?.name}{me?.department ? `, ${me.department.name}` : ""}</div>
          <div className="row between" style={{ marginTop: 10 }}>
            <ThemeSwitch />
            <button className="small" onClick={logout}><LogOut size={14} /> Log out</button>
          </div>
        </div>
      </aside>
      <main className="main" id="main">
        {/* Entrance-only transition: an exit phase would render the next page inside the outgoing layer too,
            mounting it twice (forms would lose what was typed). */}
        <motion.div key={loc.pathname} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}>
          <Suspense fallback={<Loading variant="page" />}>
            <Outlet />
          </Suspense>
        </motion.div>
      </main>
    </div>
  );
}
