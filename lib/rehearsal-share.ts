import { createHash, randomBytes } from "node:crypto";

export const REHEARSAL_SHARE_TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type PublicRehearsalItem = {
  startAt: string;
  endAt: string | null;
  type: "acting" | "japanese_dance" | "stage_combat" | "meeting" | "other";
  customType: string;
  venue: string;
};

export type PublicRehearsalSchedule = {
  projectTitle: string;
  updatedAt: string | null;
  rehearsals: PublicRehearsalItem[];
};

export function generateRehearsalShareToken(): string {
  return randomBytes(REHEARSAL_SHARE_TOKEN_BYTES).toString("base64url");
}

export function isValidRehearsalShareToken(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}

export function hashRehearsalShareToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("base64url");
}

export function buildRehearsalSharePath(token: string): string {
  if (!isValidRehearsalShareToken(token)) throw new Error("Invalid rehearsal share token");
  return `/s/rehearsals/${encodeURIComponent(token)}`;
}

export function getPublicRehearsalTypeLabel(item: Pick<PublicRehearsalItem, "type" | "customType">): string {
  if (item.type === "other") return item.customType || "その他";
  return {
    acting: "芝居",
    japanese_dance: "日本舞踊",
    stage_combat: "殺陣",
    meeting: "打ち合わせ",
  }[item.type];
}

export function formatPublicRehearsalDate(value: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).format(new Date(value));
}
export function formatPublicRehearsalTime(value: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}
