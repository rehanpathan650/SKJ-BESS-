import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDate, PERM, type AdminUser, isFuture } from "@skj/shared";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Card, ConfirmButton, Empty, ErrorBox, Field, Loading, Modal, PageHead, StatusBadge, Tabs } from "../../components/ui";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";

type Tab = "pending_approval" | "active" | "all";

export function UsersPage() {
  const { can, me } = useAuth();
  const [params] = useSearchParams();
  const [tab, setTab] = useState<Tab>(params.get("status") === "pending_approval" ? "pending_approval" : "pending_approval");
  const [search, setSearch] = useState("");
  const [approving, setApproving] = useState<AdminUser | null>(null);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ["users", tab, search], queryFn: () => api.users.list(tab === "all" ? undefined : tab, search || undefined) });
  const pendingCount = useQuery({ queryKey: ["users", "pending-count"], queryFn: () => api.users.list("pending_approval") });
  const roles = useQuery({ queryKey: ["roles"], queryFn: api.roles.list });
  const depts = useQuery({ queryKey: ["departments"], queryFn: api.auth.departments });
  const refresh = () => qc.invalidateQueries({ queryKey: ["users"] });
  const action = useMutation({
    mutationFn: ({ fn }: { fn: () => Promise<unknown> }) => fn(),
    onSuccess: refresh,
  });
  const manage = can(PERM.usersManage);

  return (
    <>
      <PageHead title="Users & approvals" sub="New sign-ups wait here until an administrator assigns a role." />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { key: "pending_approval", label: `Awaiting approval (${pendingCount.data?.length ?? 0})` },
        { key: "active", label: "Active" }, { key: "all", label: "All users" },
      ]} />
      <Card>
        <input type="search" placeholder="Search name or email" value={search} onChange={(e) => setSearch(e.target.value)} style={{ marginBottom: 12 }} />
        <ErrorBox error={action.error} />
        {users.isLoading ? <Loading /> : !users.data?.length ? <Empty>No users here.</Empty> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Name</th><th>Status</th><th>Role</th><th>Department</th><th>MFA</th><th>Last login</th><th /></tr></thead>
            <tbody>{users.data.map((u) => (
              <tr key={u.id}>
                <td>{u.full_name}<div className="small muted">{u.email}</div></td>
                <td><StatusBadge status={u.status} />{isFuture(u.locked_until) && <span className="badge danger">locked</span>}</td>
                <td>{u.role?.name ?? "–"}</td>
                <td>{u.department?.name ?? (u.requested_department ? `${u.requested_department.name} (requested)` : "–")}</td>
                <td>{u.mfa_enabled ? "On" : "Off"}</td>
                <td>{formatDate(u.last_login_at, true)}</td>
                <td className="right nowrap">{manage && u.id !== me?.id && (
                  <span className="row" style={{ justifyContent: "flex-end" }}>
                    {u.status === "pending_approval" && <>
                      <button className="small primary" onClick={() => setApproving(u)}>Approve</button>
                      <ConfirmButton className="small" message="Reject?" onConfirm={() => action.mutate({ fn: () => api.users.reject(u.id, "") })}>Reject</ConfirmButton>
                    </>}
                    {u.status === "active" && <>
                      <button className="small" onClick={() => setEditing(u)}>Edit</button>
                      <ConfirmButton className="small danger" message="Disable and sign out?" onConfirm={() => action.mutate({ fn: () => api.users.disable(u.id) })}>Disable</ConfirmButton>
                    </>}
                    {u.status === "disabled" && <button className="small" onClick={() => action.mutate({ fn: () => api.users.enable(u.id) })}>Enable</button>}
                    {u.locked_until && <button className="small" onClick={() => action.mutate({ fn: () => api.users.unlock(u.id) })}>Unlock</button>}
                  </span>
                )}</td>
              </tr>))}
            </tbody>
          </table></div>
        )}
      </Card>
      {approving && (
        <RoleModal title={`Approve ${approving.full_name}`} user={approving} roles={roles.data ?? []} depts={depts.data ?? []}
          submitLabel="Approve and give access" onClose={() => setApproving(null)}
          onSubmit={async (role_id, department_id) => { await api.users.approve(approving.id, role_id, department_id); refresh(); setApproving(null); }} />
      )}
      {editing && (
        <RoleModal title={`Edit ${editing.full_name}`} user={editing} roles={roles.data ?? []} depts={depts.data ?? []}
          submitLabel="Save" onClose={() => setEditing(null)}
          extra={<div className="row">
            <button type="button" onClick={async () => { await api.users.resetMfa(editing.id); refresh(); setEditing(null); }}>Reset MFA</button>
            {can(PERM.sessionsManage) && <button type="button" onClick={async () => { await api.users.revokeSessions(editing.id); setEditing(null); }}>Sign out everywhere</button>}
          </div>}
          onSubmit={async (role_id, department_id) => {
            await api.users.update(editing.id, { role_id, department_id: department_id ?? "" }); refresh(); setEditing(null);
          }} />
      )}
    </>
  );
}

function RoleModal({ title, user, roles, depts, submitLabel, onSubmit, onClose, extra }: {
  title: string; user: AdminUser; roles: { id: string; name: string; description: string }[]; depts: { id: string; name: string }[];
  submitLabel: string; onSubmit: (role: string, dept: string | null) => Promise<void>; onClose: () => void; extra?: React.ReactNode;
}) {
  const [role, setRole] = useState(user.role?.id ?? "");
  const [dept, setDept] = useState(user.department?.id ?? user.requested_department?.id ?? "");
  const [error, setError] = useState<unknown>(null);
  const r = roles.find((x) => x.id === role);
  return (
    <Modal title={title} onClose={onClose}>
      <form className="stack" onSubmit={async (e) => {
        e.preventDefault();
        try { await onSubmit(role, dept || null); } catch (err) { setError(err); }
      }}>
        <p className="small muted">{user.email}</p>
        <ErrorBox error={error} />
        <Field label="Role">
          <select required value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">Choose a role…</option>
            {roles.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </Field>
        {r && <p className="small muted">{r.description}</p>}
        <Field label="Department">
          <select value={dept} onChange={(e) => setDept(e.target.value)}>
            <option value="">None</option>
            {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        <p className="small muted">You can only assign roles whose permissions you hold yourself. Role changes sign the user out.</p>
        <div className="row"><button className="primary" disabled={!role}>{submitLabel}</button></div>
        {extra}
      </form>
    </Modal>
  );
}
