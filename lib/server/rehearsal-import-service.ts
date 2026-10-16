import "server-only";
import OpenAI from "openai";
import type { ProjectRole } from "../auth";
import {
  REHEARSAL_IMPORT_JSON_SCHEMA,
  RehearsalImportProviderError,
  RehearsalImportTimeoutError,
} from "../rehearsal-import";
import { adminAuth, adminDb } from "./firebase-admin";

const ANALYSIS_TIMEOUT_MS = 30_000;

const EXTRACTION_INSTRUCTIONS = `あなたは茅ヶ崎市公共施設予約システムの「予約申込一覧」専用の読み取り処理です。
画像内の表を上から順に読み、各データ行について状況、申請番号、利用日時、利用施設を抽出してください。
予約と取消を推測しないでください。表示が明確に読めない状況はunknownにしてください。
見えていない文字や値を補完しないでください。日時が読めなければ対応するdate/startTime/endTimeはnull、施設が読めなければvenueはnullにしてください。
dateはYYYY-MM-DD、時刻はHH:mmで返してください。西暦と和暦が併記されている場合は4桁西暦を優先してください。
statusText、rawDateTime、rawTextには画像から読めた原文を保持してください。sourceRowは表のデータ行を1から数えた番号です。`;

export async function verifyRehearsalImportIdToken(idToken: string): Promise<{ uid: string }> {
  const decoded = await adminAuth.verifyIdToken(idToken);
  return { uid: decoded.uid };
}

export async function getRehearsalImportProjectRole(
  projectId: string,
  uid: string
): Promise<ProjectRole | null> {
  const [projectSnapshot, memberSnapshot] = await Promise.all([
    adminDb.doc(`projects/${projectId}`).get(),
    adminDb.doc(`projects/${projectId}/members/${uid}`).get(),
  ]);
  const memberUids = projectSnapshot.data()?.memberUids;
  const role = memberSnapshot.data()?.role;
  if (!projectSnapshot.exists
    || !Array.isArray(memberUids)
    || !memberUids.includes(uid)
    || (role !== "owner" && role !== "editor" && role !== "viewer")) {
    return null;
  }
  return role;
}

export async function analyzeChigasakiReservationImage(input: {
  bytes: Uint8Array;
  mimeType: string;
}): Promise<unknown> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new RehearsalImportProviderError();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ANALYSIS_TIMEOUT_MS);
  try {
    const client = new OpenAI({ apiKey });
    const response = await client.responses.create({
      model: process.env.OPENAI_REHEARSAL_IMPORT_MODEL?.trim() || "gpt-6-luna",
      store: false,
      instructions: EXTRACTION_INSTRUCTIONS,
      input: [{
        role: "user",
        content: [
          { type: "input_text", text: "この予約申込一覧の全データ行を構造化してください。" },
          {
            type: "input_image",
            detail: "high",
            image_url: `data:${input.mimeType};base64,${Buffer.from(input.bytes).toString("base64")}`,
          },
        ],
      }],
      text: {
        format: {
          type: "json_schema",
          name: "chigasaki_rehearsal_reservations",
          strict: true,
          schema: REHEARSAL_IMPORT_JSON_SCHEMA,
        },
      },
    }, { signal: controller.signal });
    if (!response.output_text) throw new RehearsalImportProviderError();
    try {
      return JSON.parse(response.output_text) as unknown;
    } catch {
      throw new RehearsalImportProviderError();
    }
  } catch (error) {
    if (controller.signal.aborted) throw new RehearsalImportTimeoutError();
    if (error instanceof RehearsalImportProviderError) throw error;
    throw new RehearsalImportProviderError();
  } finally {
    clearTimeout(timeout);
  }
}
