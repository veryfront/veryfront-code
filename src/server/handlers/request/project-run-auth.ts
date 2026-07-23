import {
  type VerifiedControlPlaneRequestClaims,
  verifyControlPlaneRequest,
} from "#veryfront/internal-agents/control-plane-auth.ts";
import {
  INTERNAL_AGENT_CONTROL_PLANE_MAX_BODY_BYTES,
  readInternalAgentRequestBody,
} from "#veryfront/internal-agents/request-body.ts";
import type { HandlerContext } from "../types.ts";
import { parseProjectRunExecuteRequest } from "./project-run-http-policy.ts";
import type { ProjectRunExecuteRequest } from "./project-run-types.ts";

export class ProjectRunIdentityConflictError extends Error {
  constructor() {
    super("Project run identity conflicts with verified control-plane claims");
    this.name = "ProjectRunIdentityConflictError";
  }
}

export interface VerifiedProjectRunRequest {
  request: ProjectRunExecuteRequest;
  claims: VerifiedControlPlaneRequestClaims;
}

export async function readVerifiedProjectRunRequest(
  req: Request,
  ctx: HandlerContext,
  runId: string,
): Promise<VerifiedProjectRunRequest> {
  const rawBody = await readInternalAgentRequestBody(
    req,
    INTERNAL_AGENT_CONTROL_PLANE_MAX_BODY_BYTES,
  );
  const claims = await verifyControlPlaneRequest(req, ctx, rawBody, {
    expectedSubject: runId,
    expectedSurface: "studio",
  });
  const request = parseProjectRunExecuteRequest(JSON.parse(rawBody), runId);
  if (
    request.projectId !== claims.project_id ||
    (ctx.projectId !== undefined && request.projectId !== ctx.projectId)
  ) {
    throw new ProjectRunIdentityConflictError();
  }
  return { request, claims };
}
