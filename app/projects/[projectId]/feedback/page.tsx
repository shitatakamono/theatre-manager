"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useMemo, useState } from "react";
import {
  createProjectFeedback,
  getProjectFeedback,
  updateProjectFeedbackReview,
} from "@/lib/firestore";
import {
  FEEDBACK_STATUSES,
  FEEDBACK_STATUS_LABELS,
  FEEDBACK_TYPES,
  FEEDBACK_TYPE_DETAILS,
  getFeedbackPageLabel,
  normalizeFeedbackBody,
  normalizeFeedbackSourcePath,
  type Feedback,
  type FeedbackStatus,
  type FeedbackType,
} from "@/lib/feedback";
import { useProjectAccess } from "../ProjectAccess";
import styles from "./feedback.module.css";

type FeedbackPageProps = {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ from?: string | string[] }>;
};

function formatCreatedAt(value: unknown): string {
  if (!value || typeof value !== "object" || !("toDate" in value)) return "日時未確定";
  const toDate = (value as { toDate?: unknown }).toDate;
  if (typeof toDate !== "function") return "日時未確定";
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(toDate.call(value) as Date);
}

function ReviewEditor({
  projectId,
  feedback,
  onUpdated,
}: {
  projectId: string;
  feedback: Feedback;
  onUpdated: (review: { status: FeedbackStatus; adminNote: string }) => void;
}) {
  const [status, setStatus] = useState(feedback.status);
  const [adminNote, setAdminNote] = useState(feedback.adminNote);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function save() {
    if (saving) return;
    setSaving(true);
    setMessage("");
    try {
      await updateProjectFeedbackReview(projectId, feedback.id, { status, adminNote });
      onUpdated({ status, adminNote });
      setMessage("更新しました");
    } catch {
      setMessage("更新できませんでした。入力内容を保持しています。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.reviewEditor}>
      <label>
        <span>ステータス</span>
        <select value={status} onChange={(event) => setStatus(event.target.value as FeedbackStatus)}>
          {FEEDBACK_STATUSES.map((value) => <option key={value} value={value}>{FEEDBACK_STATUS_LABELS[value]}</option>)}
        </select>
      </label>
      <label className={styles.noteField}>
        <span>管理者メモ</span>
        <textarea maxLength={5000} rows={2} value={adminNote} onChange={(event) => setAdminNote(event.target.value)} />
      </label>
      <button type="button" disabled={saving} onClick={() => void save()}>{saving ? "更新中…" : "更新"}</button>
      {message ? <small role="status">{message}</small> : null}
    </div>
  );
}

export default function FeedbackPage({ params, searchParams }: FeedbackPageProps) {
  const { projectId } = use(params);
  const query = use(searchParams);
  const { role, actor, canManageMembers } = useProjectAccess();
  const requestedPath = Array.isArray(query.from) ? query.from[0] : query.from;
  const currentPath = useMemo(
    () => normalizeFeedbackSourcePath(projectId, requestedPath),
    [projectId, requestedPath]
  );
  const pageLabel = getFeedbackPageLabel(currentPath);
  const [type, setType] = useState<FeedbackType>("bug");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [submitMessage, setSubmitMessage] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [feedbackItems, setFeedbackItems] = useState<Feedback[]>();
  const [loadError, setLoadError] = useState("");

  const loadFeedback = useCallback(async () => {
    try {
      const items = await getProjectFeedback(projectId);
      setFeedbackItems(items);
      setLoadError("");
    } catch {
      setFeedbackItems([]);
      setLoadError("フィードバック一覧を読み込めませんでした");
    }
  }, [projectId]);

  useEffect(() => {
    let active = true;
    void getProjectFeedback(projectId)
      .then((items) => {
        if (!active) return;
        setFeedbackItems(items);
        setLoadError("");
      })
      .catch(() => {
        if (!active) return;
        setFeedbackItems([]);
        setLoadError("フィードバック一覧を読み込めませんでした");
      });
    return () => { active = false; };
  }, [projectId]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending) return;
    if (!normalizeFeedbackBody(body)) {
      setSubmitError("内容を入力してください");
      return;
    }
    if (!role) {
      setSubmitError("メンバー権限を確認できませんでした");
      return;
    }

    setSending(true);
    setSubmitError("");
    setSubmitMessage("");
    try {
      await createProjectFeedback(projectId, {
        type,
        body,
        reporterUid: actor.uid,
        reporterName: actor.displayName,
        reporterRole: role,
        currentPath,
        pageLabel,
      });
      setBody("");
      setSubmitMessage("フィードバックを送信しました");
      await loadFeedback();
    } catch {
      setSubmitError("送信できませんでした。入力内容は保持されています。");
    } finally {
      setSending(false);
    }
  }

  function updateLocalFeedback(feedbackId: string, review: { status: FeedbackStatus; adminNote: string }) {
    setFeedbackItems((items) => items?.map((item) => item.id === feedbackId ? { ...item, ...review } : item));
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <Link href={`/projects/${projectId}`}>← 公演トップ</Link>
          <p>TEAM FEEDBACK</p>
          <h1>フィードバック</h1>
        </div>
        <span>最新100件</span>
      </header>

      <section className={styles.composer} aria-labelledby="feedback-form-title">
        <div className={styles.composerHeading}>
          <div><h2 id="feedback-form-title">気づいたことを報告</h2><p>報告元：{pageLabel}</p></div>
          <code>{currentPath}</code>
        </div>
        <form onSubmit={(event) => void submit(event)}>
          <fieldset className={styles.types}>
            <legend>種別</legend>
            {FEEDBACK_TYPES.map((value) => (
              <label key={value} className={type === value ? styles.selectedType : undefined}>
                <input type="radio" name="feedback-type" value={value} checked={type === value} onChange={() => setType(value)} />
                <strong>{FEEDBACK_TYPE_DETAILS[value].label}</strong>
                <span>{FEEDBACK_TYPE_DETAILS[value].description}</span>
              </label>
            ))}
          </fieldset>
          <label className={styles.bodyField}>
            <span>内容 <b>必須</b></span>
            <textarea required maxLength={5000} rows={5} placeholder="起きたことや、こうなると使いやすいと感じた点を入力してください" value={body} onChange={(event) => setBody(event.target.value)} />
          </label>
          <div className={styles.submitRow}>
            <div>{submitError ? <p className={styles.error} role="alert">{submitError}</p> : null}{submitMessage ? <p className={styles.success} role="status">{submitMessage}</p> : null}</div>
            <button type="submit" disabled={sending}>{sending ? "送信中…" : "フィードバックを送信"}</button>
          </div>
        </form>
      </section>

      <section className={styles.feedbackList} aria-labelledby="feedback-list-title">
        <div className={styles.listHeading}><h2 id="feedback-list-title">これまでのフィードバック</h2><span>{feedbackItems?.length ?? 0}件</span></div>
        {feedbackItems === undefined ? <p className={styles.state}>読み込み中…</p> : null}
        {loadError ? <p className={`${styles.state} ${styles.error}`} role="alert">{loadError}</p> : null}
        {feedbackItems?.length === 0 && !loadError ? <p className={styles.state}>フィードバックはまだありません。</p> : null}
        {feedbackItems?.length ? (
          <ol className={styles.list}>
            {feedbackItems.map((feedback) => (
              <li key={feedback.id} className={styles.item}>
                <div className={styles.meta}>
                  <span className={`${styles.typeBadge} ${styles[feedback.type]}`}>{FEEDBACK_TYPE_DETAILS[feedback.type].label}</span>
                  <span className={styles.statusBadge}>{FEEDBACK_STATUS_LABELS[feedback.status]}</span>
                  <time>{formatCreatedAt(feedback.createdAt)}</time>
                </div>
                <p className={styles.body}>{feedback.body}</p>
                <dl className={styles.details}>
                  <div><dt>報告者</dt><dd>{feedback.reporterName}</dd></div>
                  <div><dt>対象画面</dt><dd>{feedback.pageLabel}</dd></div>
                </dl>
                {canManageMembers ? (
                  <ReviewEditor projectId={projectId} feedback={feedback} onUpdated={(review) => updateLocalFeedback(feedback.id, review)} />
                ) : feedback.adminNote ? (
                  <div className={styles.adminNote}><strong>管理者メモ</strong><p>{feedback.adminNote}</p></div>
                ) : null}
              </li>
            ))}
          </ol>
        ) : null}
      </section>
    </main>
  );
}
