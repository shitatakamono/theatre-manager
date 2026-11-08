import {
  createRehearsalShareDeleteHandler,
  createRehearsalShareGetHandler,
  createRehearsalSharePatchHandler,
  createRehearsalSharePostHandler,
} from "@/lib/server/rehearsal-share-handler";
import {
  disableRehearsalShare,
  getRehearsalShareProjectRole,
  getRehearsalShareStatus,
  issueRehearsalShare,
  regenerateRehearsalShare,
  verifyRehearsalShareIdToken,
} from "@/lib/server/rehearsal-share";

export const runtime = "nodejs";

const dependencies = {
  verifyIdToken: verifyRehearsalShareIdToken,
  getProjectRole: getRehearsalShareProjectRole,
  getStatus: getRehearsalShareStatus,
  issue: issueRehearsalShare,
  regenerate: regenerateRehearsalShare,
  disable: disableRehearsalShare,
};

export const GET = createRehearsalShareGetHandler(dependencies);
export const POST = createRehearsalSharePostHandler(dependencies);
export const PATCH = createRehearsalSharePatchHandler(dependencies);
export const DELETE = createRehearsalShareDeleteHandler(dependencies);
