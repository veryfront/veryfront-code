import { verifyControlPlaneJws } from "#veryfront/channels/control-plane.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import type { HandlerContext } from "#veryfront/types";
import { serverLogger } from "#veryfront/utils";
import { HTTP_INTERNAL_SERVER_ERROR } from "#veryfront/utils/constants/index.ts";

const CONTROL_PLANE_JWS_HEADER = "x-veryfront-control-plane-jws";
const MAX_CONTROL_PLANE_SIGNATURE_AGE_SECONDS = 60;
const logger = serverLogger.component("internal-agents-auth");

export class ControlPlaneRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ControlPlaneRequestError";
  }
}

export function getControlPlaneVerificationPublicKey(ctx: HandlerContext): string | undefined {
  // Project env overlays intentionally hide host secrets from request-scoped reads.
  // Control-plane verification is framework-owned config, so it must fall back to
  // the host environment when the runtime adapter env is overlay-aware.
  return ctx.adapter.env.get("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY") ??
    getHostEnv("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY");
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
  const publicKeyPem = getControlPlaneVerificationPublicKey(ctx);
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
  } catch (error) {
    const isAuthError = error instanceof Error && (
      error.message.includes("Control-plane") ||
      error.message.includes("Unsupported")
    );

    if (isAuthError) {
      logger.warn("Invalid control-plane signature", {
        error,
        projectSlug,
        expectedSubject: options.expectedSubject,
        expectedSurface: options.expectedSurface,
      });
      throw new ControlPlaneRequestError(401, "Invalid control-plane signature");
    }

    logger.error("Unexpected error during control-plane verification", {
      error,
      projectSlug,
    });
    throw new ControlPlaneRequestError(
      HTTP_INTERNAL_SERVER_ERROR,
      "Internal error during request verification",
    );
  }
}
