import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, can as canPerm, type Me } from "@skj/shared";
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from "react";
import { api, onSessionEnded } from "./api";

interface AuthCtx {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<unknown>;
  logout: () => Promise<void>;
  can: (perm: string) => boolean;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return await api.auth.me();
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
    retry: false,
  });

  useEffect(() => {
    onSessionEnded(() => {
      qc.setQueryData(["me"], null);
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
    });
  }, [qc]);

  const logout = useCallback(async () => {
    try { await api.auth.logout(); } catch { /* already logged out */ }
    // Keep the "me" query alive (the app is subscribed to it); drop all other cached data.
    qc.setQueryData(["me"], null);
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
  }, [qc]);

  const value = useMemo<AuthCtx>(() => ({
    me: meQuery.data ?? null,
    loading: meQuery.isLoading,
    refresh: () => meQuery.refetch(),
    logout,
    can: (perm: string) => canPerm(meQuery.data, perm),
  }), [meQuery, logout]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}
