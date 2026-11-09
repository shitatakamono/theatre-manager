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
import { usePathname } from "next/navigation";
import { auth, googleAuthProvider } from "@/lib/firebase";
import type { UserProfile } from "@/lib/auth";
import { completeAuthenticatedUserBootstrap } from "@/lib/auth-bootstrap";
import { claimPendingProjectInvites, syncCurrentUserMemberProfiles } from "@/lib/firestore";
import { claimPendingUserLinkReservationsClient } from "@/lib/user-link-reservation-client";
import { isPublicAppPath } from "@/lib/auth-paths";
import styles from "./auth.module.css";

type LoginResult = "signed_in" | "redirect_started" | "cancelled" | "failed";

type AuthContextValue = {
  loading: boolean;
  profile: UserProfile | null;
  login: () => Promise<LoginResult>;
  logout: () => Promise<void>;
  membershipNotice: string;
  loginError: string;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [error, setError] = useState("");
  const [membershipNotice, setMembershipNotice] = useState("");

  useEffect(() => {
    let active = true;
    void getRedirectResult(auth).catch(() => setError("Googleログインを完了できませんでした"));
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!user) {
        if (active) {
          setProfile(null);
          setMembershipNotice("");
          setLoading(false);
        }
        return;
      }
      const nextProfile: UserProfile = {
        uid: user.uid,
        displayName: user.displayName ?? undefined,
        email: user.email ?? undefined,
        photoURL: user.photoURL ?? undefined,
      };
      void (async () => {
        const bootstrap = await completeAuthenticatedUserBootstrap({
          profile: nextProfile,
          claimInvites: claimPendingProjectInvites,
          claimReservations: () => claimPendingUserLinkReservationsClient(
            () => user.getIdToken()
          ),
          syncMemberProfiles: syncCurrentUserMemberProfiles,
        });
        if (!active) return;
        setProfile(nextProfile);
        const notices = [
          bootstrap.joinedProjects.length > 0
            ? `${bootstrap.joinedProjects.join("、")}に招待されている公演へ参加しました`
            : "",
          bootstrap.claimedReservationCount > 0
            ? "関係者情報との紐づけが完了しました"
            : "",
        ].filter(Boolean);
        setMembershipNotice(notices.join("。"));
        setLoading(false);
      })();
    });
    return () => { active = false; unsubscribe(); };
  }, []);

  async function login(): Promise<LoginResult> {
    setError("");
    try {
      await signInWithPopup(auth, googleAuthProvider);
      return "signed_in";
    } catch (loginError) {
      const code = loginError instanceof FirebaseError ? loginError.code : "";
      if ([
        "auth/popup-blocked",
        "auth/operation-not-supported-in-this-environment",
        "auth/web-storage-unsupported",
      ].includes(code)) {
        await signInWithRedirect(auth, googleAuthProvider);
        return "redirect_started";
      }
      if (code === "auth/popup-closed-by-user") return "cancelled";
      setError("Googleログインに失敗しました");
      return "failed";
    }
  }

  const value = useMemo<AuthContextValue>(() => ({
    loading,
    profile,
    login,
    logout: () => signOut(auth),
    membershipNotice,
    loginError: error,
  }), [error, loading, membershipNotice, profile]);

  const isPublicPage = isPublicAppPath(pathname);

  if (isPublicPage) {
    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
  }

  if (loading) return <div className={styles.loading}>認証状態を確認しています…</div>;
  if (!profile) return <main className={styles.login}><section><p>SEISAKU BOARD</p><h1>SeisakuBoard</h1><h2>公演制作をチームで管理</h2><button onClick={() => void login()}>Googleでログイン</button>{error && <span role="alert">{error}</span>}</section></main>;

  return <AuthContext.Provider value={value}><div className={styles.userBar}><span>{profile.displayName || profile.email || "ログイン中"}</span><button onClick={() => void signOut(auth)}>ログアウト</button></div>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
