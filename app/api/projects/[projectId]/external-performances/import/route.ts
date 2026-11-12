import { adminAuth } from "@/lib/server/firebase-admin";
import { createExternalPerformanceImportHandler } from "@/lib/server/external-performance-import-handler";
import { importExternalPerformanceRows } from "@/lib/server/external-performance-import";

export const runtime = "nodejs";

export const POST = createExternalPerformanceImportHandler({
  verifyIdToken: (token) => adminAuth.verifyIdToken(token),
  importRows: importExternalPerformanceRows,
});
