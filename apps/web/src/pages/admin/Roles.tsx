import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PERM, type Role } from "@skj/shared";
import { useState } from "react";
import { Card, ConfirmButton, ErrorBox, Field, Loading, Modal, PageHead } from "../../components/ui";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";

export function RolesPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const roles = useQuery({ queryKey: ["roles"], queryFn: api.roles.list });
  const perms = useQuery({ queryKey: ["perm-catalogue"], queryFn: api.roles.permissions });
  const [editing, setEditing] = useState<Partial<Role> | null>(null);
  const remove = useMutation({ mutationFn: api.roles.remove, onSuccess: () => qc.invalidateQueries({ queryKey: ["roles"] }) });
  const manage = can(PERM.rolesManage);

  return (
    <>
      <PageHead title="Roles & permissions" sub="Built-in roles can be adjusted; create custom roles for special cases."
        actions={manage && <button className="primary" onClick={() => setEditing({ name: "", description: "", permissions: [] })}>New role</button>} />
      <ErrorBox error={remove.error} />
      {roles.isLoading ? <Loading /> : (
        <div className="grid cols-2">
          {roles.data?.map((r) => (
            <Card key={r.id} title={<>{r.name} {r.is_system && <span className="badge">built-in</span>}</>}
              actions={manage && !r.permissions.includes("*") && <>
                <button className="small" onClick={() => setEditing(r)}>Edit</button>
                {!r.is_system && <ConfirmButton className="small danger" message="Delete role?" onConfirm={() => remove.mutate(r.id)}>Delete</ConfirmButton>}
              </>}>
              <p className="small muted">{r.description}</p>
              <p className="small">{r.user_count} user(s)</p>
              <div className="row">{(r.permissions.includes("*") ? ["All permissions"] : r.permissions).map((p) =>
                <span key={p} className="badge">{p}</span>)}</div>
            </Card>
          ))}
        </div>
      )}
      {editing && perms.data && (
        <RoleEditor role={editing} catalogue={perms.data} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: ["roles"] }); }} />
      )}
    </>
  );
}

function RoleEditor({ role, catalogue, onClose, onSaved }: {
  role: Partial<Role>; catalogue: { key: string; description: string; requires_mfa: boolean }[]; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(role.name ?? "");
  const [description, setDescription] = useState(role.description ?? "");
  const [selected, setSelected] = useState<string[]>(role.permissions ?? []);
  const save = useMutation({
    mutationFn: () => role.id ? api.roles.update(role.id, { name, description, permissions: selected })
      : api.roles.create({ name, description, permissions: selected }),
    onSuccess: onSaved,
  });
  return (
    <Modal wide title={role.id ? `Edit ${role.name}` : "New role"} onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <ErrorBox error={save.error} />
        <div className="form-grid">
          <Field label="Name"><input required minLength={2} value={name} disabled={role.is_system} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Description"><input value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} /></Field>
        </div>
        <div className="perm-grid">
          {catalogue.map((p) => (
            <label key={p.key}>
              <input type="checkbox" checked={selected.includes(p.key)}
                onChange={(e) => setSelected(e.target.checked ? [...selected, p.key] : selected.filter((x) => x !== p.key))} />
              <span><span className="mono">{p.key}</span>{p.requires_mfa && <span className="badge warn" style={{ marginLeft: 4 }}>MFA</span>}
                <br /><span className="small muted">{p.description}</span></span>
            </label>
          ))}
        </div>
        <p className="small muted">Saving signs out everyone with this role so the new permissions apply immediately.</p>
        <div><button className="primary" disabled={save.isPending}>Save role</button></div>
      </form>
    </Modal>
  );
}
