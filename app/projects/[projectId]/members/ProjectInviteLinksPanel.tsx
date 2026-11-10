"use client";

import { useEffect, useState } from "react";
import { createProjectInviteLink, listProjectInviteLinks, revokeProjectInviteLink } from "@/lib/project-invite-link-client";
import type { ProjectInviteLinkSummary } from "@/lib/project-invite-links";
import styles from "./members.module.css";

const STATUS_LABELS = { pending: "未使用", claimed: "使用済み", revoked: "無効", expired: "期限切れ" } as const;
function dateTime(value: string | null): string {
  return value ? new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "—";
}

export function ProjectInviteLinksPanel({ projectId }: { projectId: string }) {
  const [invites, setInvites] = useState<ProjectInviteLinkSummary[]>([]);
  const [createdUrl, setCreatedUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { let active = true; void listProjectInviteLinks(projectId).then((items) => { if (active) setInvites(items); }).catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "招待リンクを読み込めませんでした"); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [projectId]);

  async function create() {
    if (busy) return;
    setBusy(true); setError(""); setMessage(""); setCreatedUrl("");
    try { const result = await createProjectInviteLink(projectId); setInvites((current) => [result.invite, ...current]); setCreatedUrl(result.url); setMessage("招待リンクを作成しました"); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "招待リンクを作成できませんでした"); }
    finally { setBusy(false); }
  }
  async function copy() { if (!createdUrl) return; try { await navigator.clipboard.writeText(createdUrl); setMessage("招待URLをコピーしました"); } catch { setError("URLをコピーできませんでした"); } }
  async function revoke(invite: ProjectInviteLinkSummary) {
    if (busy || invite.status !== "pending" || !window.confirm("この招待リンクを無効にしますか？")) return;
    setBusy(true); setError(""); setMessage("");
    try { await revokeProjectInviteLink(projectId, invite.id); setInvites((current) => current.map((item) => item.id === invite.id ? { ...item, status: "revoked" } : item)); setMessage("招待リンクを無効にしました"); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "招待リンクを無効にできませんでした"); }
    finally { setBusy(false); }
  }

  return <section className={styles.inviteLinkSection}>
    <div className={styles.sectionHeading}><h2>LINE等で送る招待リンク</h2><span>閲覧者（Viewer）として参加する、7日間有効なURLです。</span></div>
    <button className={styles.primaryInviteLinkButton} type="button" disabled={busy} onClick={() => void create()}>{busy ? "処理中…" : "招待リンクを作成"}</button>
    {createdUrl && <div className={styles.createdInviteLink} role="status"><strong>招待リンクを作成しました</strong><button type="button" onClick={() => void copy()}>URLをコピー</button><small>このURLは再表示できません。必要な相手へ安全に共有してください。</small></div>}
    {message && <p className={styles.inviteLinkMessage} role="status">{message}</p>}{error && <p className={styles.inviteLinkError} role="alert">{error}</p>}
    <h3 className={styles.inviteLinkListTitle}>発行済みリンク</h3>
    {loading ? <p className={styles.state}>読み込み中…</p> : invites.length === 0 ? <p className={styles.state}>発行済みの招待リンクはありません。</p> : <div className={styles.inviteLinkTableWrap}><table className={styles.inviteLinkTable}><thead><tr><th>状態</th><th>対象</th><th>作成日時</th><th>有効期限</th><th>使用日時</th><th>操作</th></tr></thead><tbody>{invites.map((invite) => <tr key={invite.id}><td data-label="状態"><span data-status={invite.status}>{STATUS_LABELS[invite.status]}</span></td><td data-label="対象">{invite.personId ? invite.personName || "関係者指定" : "一般招待"}</td><td data-label="作成日時">{dateTime(invite.createdAt)}</td><td data-label="有効期限">{dateTime(invite.expiresAt)}</td><td data-label="使用日時">{dateTime(invite.claimedAt)}</td><td data-label="操作">{invite.status === "pending" ? <button type="button" disabled={busy} onClick={() => void revoke(invite)}>無効化</button> : "—"}</td></tr>)}</tbody></table></div>}
  </section>;
}
