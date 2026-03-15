import { verifyControlPlaneJws } from "#veryfront/channels/control-plane.ts";
import type { HandlerContext } from "#veryfront/types";
import { HTTP_INTERNAL_SERVER_ERROR } from "#veryfront/utils/constants/index.ts";

const CONTROL_PLANE_JWS_HEADER = "x-veryfront-control-plane-jws";
const MAX_CONTROL_PLANE_SIGNATURE_AGE_SECONDS = 60;

export class ControlPlaneRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ControlPlaneRequestError";
  }
}

export async function verifyControlPlaneRequest(
  req: Request,
  ctx: HandlerContext,
  rawBody: string,
  options: {
    expectedSubject?: string;
    expectedSurface?: "studio" | "channels" | "a2a" | "mcp";
  } = {},
) {
  const publicKeyPem = ctx.adapter.env.get("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY");
  if (!publicKeyPem) {
    throw new ControlPlaneRequestError(
      HTTP_INTERNAL_SERVER_ERROR,
      "Control-plane verification is not configured",
    );
  }

  const projectSlug = ctx.projectSlug;
  if (!projectSlug) {
    throw new ControlPlaneRequestError(400, "Project context is unavailable");
  }

  const controlPlaneJws = req.headers.get(CONTROL_PLANE_JWS_HEADER);
  if (!controlPlaneJws) {
    throw new ControlPlaneRequestError(401, "Missing control-plane signature");
  }

  try {
    return await verifyControlPlaneJws(controlPlaneJws, rawBody, {
      audience: projectSlug,
      expectedProjectId: ctx.projectId,
      expectedSubject: options.expectedSubject,
      expectedSurface: options.expectedSurface,
      publicKeyPem,
      maxAgeSeconds: MAX_CONTROL_PLANE_SIGNATURE_AGE_SECONDS,
    });
  } catch {
    throw new ControlPlaneRequestError(401, "Invalid control-plane signature");
  }
}
