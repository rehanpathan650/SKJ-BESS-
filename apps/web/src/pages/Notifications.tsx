import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDate } from "@skj/shared";
import { useNavigate } from "react-router-dom";
import { Card, Empty, Loading, PageHead } from "../components/ui";
import { api } from "../lib/api";

export function NotificationsPage() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ["notifications"], queryFn: () => api.notifications.list() });
  const refresh = () => qc.invalidateQueries({ queryKey: ["notifications"] });
  const readAll = useMutation({ mutationFn: api.notifications.readAll, onSuccess: refresh });
  return (
    <>
      <PageHead title="Notifications" actions={<button onClick={() => readAll.mutate()}>Mark all as read</button>} />
      <Card>
        {q.isLoading ? <Loading /> : !q.data?.items.length ? <Empty>You're all caught up.</Empty> : q.data.items.map((n) => (
          <div key={n.id} style={{ borderBottom: "1px solid var(--border)", padding: "10px 0", cursor: n.link ? "pointer" : undefined,
            opacity: n.read ? 0.7 : 1 }}
            onClick={async () => { await api.notifications.read(n.id); refresh(); if (n.link.startsWith("/")) nav(n.link); }}>
            <div className="row between">
              <strong>{!n.read && "● "}{n.title}</strong>
              <span className="small muted">{formatDate(n.created_at, true)}</span>
            </div>
            {n.body && <div className="small">{n.body}</div>}
          </div>
        ))}
      </Card>
    </>
  );
}
