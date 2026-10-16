import { createRehearsalImportPostHandler } from "@/lib/server/rehearsal-import-handler";
import {
  analyzeChigasakiReservationImage,
  getRehearsalImportProjectRole,
  verifyRehearsalImportIdToken,
} from "@/lib/server/rehearsal-import-service";

export const runtime = "nodejs";

export const POST = createRehearsalImportPostHandler({
  verifyIdToken: verifyRehearsalImportIdToken,
  getProjectRole: getRehearsalImportProjectRole,
  analyzeImage: analyzeChigasakiReservationImage,
});
