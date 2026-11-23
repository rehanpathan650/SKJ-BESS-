import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, can as canPerm, type Me } from "@skj/shared";
import * as LocalAuthentication from "expo-local-authentication";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { BACKGROUND_LOCK_MS, IDLE_LOGOUT_MS } from "./config";
import { cleanupTempFiles } from "./files";
import { registerForPush } from "./push";
import {
  api, clearTokens, getAccessToken, getBiometricEnabled, hasStoredSession, onSessionEnded, refreshTokens, saveTokens,
} from "./session";

interface AuthCtx {
  me: Me | null;
  loading: boolean;
  locked: boolean;
  can: (perm: string) => boolean;
  login: (email: string, password: string) => Promise<{ mfaTicket?: string }>;
  verifyMfa: (ticket: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
  unlock: () => Promise<boolean>;
  refresh: () => Promise<unknown>;
  touch: () => void;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [locked, setLocked] = useState(false);
  const lastActive = useRef(Date.now());
  const backgroundedAt = useRef<number | null>(null);

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      if (!getAccessToken()) {
        if (!(await hasStoredSession()) || !(await refreshTokens())) return null;
        // Restored a stored session after an app restart: require biometrics if enabled.
        if (await getBiometricEnabled()) setLocked(true);
      }
      try {
        return await api.auth.me();
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    retry: false,
    staleTime: 60_000,
  });

  const logout = useCallback(async () => {
    try { if (getAccessToken()) await api.auth.logout(); } catch { /* ignore */ }
    await clearTokens();
    cleanupTempFiles();
    setLocked(false);
    qc.setQueryData(["me"], null);
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
  }, [qc]);

  useEffect(() => {
    cleanupTempFiles();
    onSessionEnded(() => { void logout(); });
  }, [logout]);

  // Lock after time in background; sign out after inactivity.
  useEffect(() => {
    const sub = AppState.addEventListener("change", async (state) => {
      if (state === "background" || state === "inactive") {
        backgroundedAt.current = Date.now();
        return;
      }
      if (state === "active" && backgroundedAt.current) {
        const away = Date.now() - backgroundedAt.current;
        backgroundedAt.current = null;
        if (Date.now() - lastActive.current > IDLE_LOGOUT_MS) return void logout();
        if (away > BACKGROUND_LOCK_MS && meQuery.data) {
          if (await getBiometricEnabled()) setLocked(true);
        }
      }
    });
    const timer = setInterval(() => {
      if (meQuery.data && Date.now() - lastActive.current > IDLE_LOGOUT_MS) void logout();
    }, 60_000);
    return () => { sub.remove(); clearInterval(timer); };
  }, [logout, meQuery.data]);

  useEffect(() => {
    if (meQuery.data?.status === "active" && !locked) void registerForPush();
  }, [meQuery.data?.status, locked]);

  const finishLogin = useCallback(async (r: { access_token?: string; refresh_token?: string }) => {
    if (!r.access_token || !r.refresh_token) throw new Error("Login failed");
    await saveTokens(r.access_token, r.refresh_token);
    lastActive.current = Date.now();
    await qc.invalidateQueries({ queryKey: ["me"] });
  }, [qc]);

  const value = useMemo<AuthCtx>(() => ({
    me: meQuery.data ?? null,
    loading: meQuery.isLoading,
    locked,
    can: (perm) => canPerm(meQuery.data, perm),
    async login(email, password) {
      const r = await api.auth.login(email.trim(), password, "mobile");
      if (r.mfa_required && r.mfa_ticket) return { mfaTicket: r.mfa_ticket };
      await finishLogin(r);
      return {};
    },
    async verifyMfa(ticket, code) {
      await finishLogin(await api.auth.mfaLogin(ticket, code, "mobile"));
    },
    logout,
    async unlock() {
      const res = await LocalAuthentication.authenticateAsync({
        promptMessage: "Unlock SKJ BESS", cancelLabel: "Use password", disableDeviceFallback: false,
      });
      if (res.success) { setLocked(false); lastActive.current = Date.now(); }
      return res.success;
    },
    refresh: () => meQuery.refetch(),
    touch: () => { lastActive.current = Date.now(); },
  }), [meQuery, locked, logout, finishLogin]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}
