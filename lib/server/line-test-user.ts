import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "./firebase-admin.ts";

const LINE_TEST_STATE_COLLECTION = "system";
const LINE_TEST_STATE_DOCUMENT = "lineTest";

export type LatestLineFollow = {
  lineUserId: string;
  eventType: "follow";
  receivedAt: unknown;
};

export async function saveLatestLineFollowUser(lineUserId: string): Promise<void> {
  await adminDb.collection(LINE_TEST_STATE_COLLECTION).doc(LINE_TEST_STATE_DOCUMENT).set({
    lineUserId,
    eventType: "follow",
    receivedAt: Timestamp.now(),
  });
}

export async function getLatestLineFollowUser(): Promise<LatestLineFollow | null> {
  const snapshot = await adminDb.collection(LINE_TEST_STATE_COLLECTION)
    .doc(LINE_TEST_STATE_DOCUMENT).get();
  if (!snapshot.exists) return null;
  const data = snapshot.data();
  if (data?.eventType !== "follow" || typeof data.lineUserId !== "string") return null;
  return {
    lineUserId: data.lineUserId,
    eventType: "follow",
    receivedAt: data.receivedAt ?? null,
  };
}
