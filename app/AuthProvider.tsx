"use client";

import { FirebaseError } from "firebase/app";
import {
  getRedirectResult,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from "firebase/auth";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { auth, googleAuthProvider } from "@/lib/firebase";
import type { UserProfile } from "@/lib/auth";
import styles from "./auth.module.css";

type AuthContextValue = {
  loading: boolean;
  profile: UserProfile | null;
  login: () => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void getRedirectResult(auth).catch(() => setError("Googleログインを完了できませんでした"));
    return onAuthStateChanged(auth, (user) => {
      setProfile(user ? {
        uid: user.uid,
        displayName: user.displayName ?? undefined,
        email: user.email ?? undefined,
        photoURL: user.photoURL ?? undefined,
      } : null);
      setLoading(false);
    });
  }, []);

  async function login() {
    setError("");
    try {
      await signInWithPopup(auth, googleAuthProvider);
    } catch (loginError) {
      const code = loginError instanceof FirebaseError ? loginError.code : "";
      if (["auth/popup-blocked", "auth/operation-not-supported-in-this-environment", "auth/web-storage-unsupported"].includes(code)) {
        await signInWithRedirect(auth, googleAuthProvider);
        return;
      }
      if (code !== "auth/popup-closed-by-user") setError("Googleログインに失敗しました");
    }
  }

  const value = useMemo<AuthContextValue>(() => ({ loading, profile, login, logout: () => signOut(auth) }), [loading, profile]);

  if (loading) return <div className={styles.loading}>認証状態を確認しています…</div>;
  if (!profile) return <main className={styles.login}><section><p>SEISAKU BOARD</p><h1>SeisakuBoard</h1><h2>公演制作をチームで管理</h2><button onClick={() => void login()}>Googleでログイン</button>{error && <span role="alert">{error}</span>}</section></main>;

  return <AuthContext.Provider value={value}><div className={styles.userBar}><span>{profile.displayName || profile.email || "ログイン中"}</span><button onClick={() => void signOut(auth)}>ログアウト</button></div>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
