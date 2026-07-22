import { verifyDispatchJws } from "#veryfront/channels/invoke.ts";
import { getControlPlaneVerificationPublicKey } from "#veryfront/internal-agents/control-plane-auth.ts";
import {
  INTERNAL_AGENT_CONTROL_PLANE_MAX_BODY_BYTES,
  InternalAgentRequestBodyTooLargeError,
  readInternalAgentRequestBody,
} from "#veryfront/internal-agents/request-body.ts";
import type { ResponseBuilder } from "#veryfront/security/index.ts";
import type { HandlerContext } from "#veryfront/types";
import { HTTP_INTERNAL_SERVER_ERROR } from "#veryfront/utils/constants/index.ts";

const DISPATCH_JWS_HEADER = "x-veryfront-dispatch-jws";
const MAX_DISPATCH_SIGNATURE_AGE_SECONDS = 60;

type ParseSchema<T> = {
  parse(value: unknown): T;
};

type LogWarn = (message: string, extra?: Record<string, unknown>) => void;

export type SignedChannelDispatchRequest<T> =
  | {
    ok: true;
    claims: Awaited<ReturnType<typeof verifyDispatchJws>>;
    payload: T;
    rawBody: string;
  }
  | {
    ok: false;
    response: Response;
  };

export interface ReadSignedChannelDispatchRequestOptions<T> {
  builder: ResponseBuilder;
  endpointName: string;
  invalidRequestError: string;
  logLabel?: string;
  logWarn: LogWarn;
  schema: ParseSchema<T>;
  validateClaims?: (
    claims: Awaited<ReturnType<typeof verifyDispatchJws>>,
    payload: T,
  ) => boolean;
}

export async function readSignedChannelDispatchRequest<T>(
  req: Request,
  ctx: HandlerContext,
  options: ReadSignedChannelDispatchRequestOptions<T>,
): Promise<SignedChannelDispatchRequest<T>> {
  const logLabel = options.logLabel ?? options.endpointName;
  const publicKeyPem = getControlPlaneVerificationPublicKey(ctx);
  if (!publicKeyPem) {
    options.logWarn(
      `Missing CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY for ${options.endpointName} endpoint`,
    );
    return {
      ok: false,
      response: options.builder.json(
        { error: "Channel dispatch verification is not configured" },
        HTTP_INTERNAL_SERVER_ERROR,
      ),
    };
  }

  const projectSlug = ctx.projectSlug;
  if (!projectSlug) {
    options.logWarn(`${logLabel} request arrived without resolved project slug`);
    return {
      ok: false,
      response: options.builder.json({ error: "Project context is unavailable" }, 400),
    };
  }

  const dispatchJws = req.headers.get(DISPATCH_JWS_HEADER);
  if (!dispatchJws) {
    return {
      ok: false,
      response: options.builder.json({ error: "Missing dispatch signature" }, 401),
    };
  }

  // Read through the capped reader BEFORE signature verification so an
  // unauthenticated caller cannot stream an unbounded body into memory.
  let rawBody: string;
  try {
    rawBody = await readInternalAgentRequestBody(
      req,
      INTERNAL_AGENT_CONTROL_PLANE_MAX_BODY_BYTES,
    );
  } catch (error) {
    if (error instanceof InternalAgentRequestBodyTooLargeError) {
      return {
        ok: false,
        response: options.builder.json({ error: "Request body too large" }, 413),
      };
    }
    throw error;
  }

  let claims: Awaited<ReturnType<typeof verifyDispatchJws>>;
  try {
    claims = await verifyDispatchJws(dispatchJws, rawBody, {
      audience: projectSlug,
      expectedProjectId: ctx.projectId,
      publicKeyPem,
      maxAgeSeconds: MAX_DISPATCH_SIGNATURE_AGE_SECONDS,
    });
  } catch (error) {
    options.logWarn(`${logLabel} signature verification failed`, {
      error: error instanceof Error ? error.message : String(error),
      projectSlug,
      projectId: ctx.projectId,
    });
    return {
      ok: false,
      response: options.builder.json({ error: "Invalid dispatch signature" }, 401),
    };
  }

  let payload: T;
  try {
    payload = options.schema.parse(JSON.parse(rawBody));
  } catch (error) {
    options.logWarn(`${logLabel} request validation failed`, {
      error: error instanceof Error ? error.message : String(error),
      projectSlug,
      projectId: ctx.projectId,
    });
    return {
      ok: false,
      response: options.builder.json({ error: options.invalidRequestError }, 400),
    };
  }

  try {
    if (options.validateClaims && !options.validateClaims(claims, payload)) {
      options.logWarn(`${logLabel} claims are not bound to the signed request body`, {
        projectSlug,
        projectId: ctx.projectId,
      });
      return {
        ok: false,
        response: options.builder.json({ error: "Invalid dispatch signature" }, 401),
      };
    }
  } catch (error) {
    options.logWarn(`${logLabel} claim binding validation failed`, {
      error: error instanceof Error ? error.message : String(error),
      projectSlug,
      projectId: ctx.projectId,
    });
    return {
      ok: false,
      response: options.builder.json({ error: "Invalid dispatch signature" }, 401),
    };
  }

  return {
    ok: true,
    claims,
    payload,
    rawBody,
  };
}
