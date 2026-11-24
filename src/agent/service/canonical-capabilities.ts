import {
  CONTROL_PLANE_JWS_HEADER,
  CONTROL_PLANE_RUNTIME_CAPABILITIES_PATH,
  getControlPlaneProjectMetadataRequestSchema,
  verifyControlPlaneJws,
} from "#veryfront/channels/control-plane.ts";
import {
  isRequestBodyTooLargeError,
  readBodyBytesWithLimit,
} from "#veryfront/security/input-validation/limits.ts";
import type { BrokerRuntimeAgentIngressOptions } from "./broker-ingress.ts";

/** Version two additionally requires single-use API dispatch admission before executor allocation.
 * Report the composed protocol only to the exact operator-signed source namespace. */
export function createCanonicalCapabilitiesHandler(
  input:
    & Pick<
      BrokerRuntimeAgentIngressOptions<unknown>,
      "publicKeyPem" | "audience" | "projectId" | "expectedSurface"
    >
    & { signal: AbortSignal },
) {
  const { publicKeyPem, audience, projectId, expectedSurface, signal } = input;
  const schema = getControlPlaneProjectMetadataRequestSchema();
  return {
    async handle(request: Request): Promise<Response> {
      const unavailable = () => Response.json({ errorCode: "BROKER_UNAVAILABLE" }, { status: 503 });
      if (signal.aborted) return unavailable();
      const url = new URL(request.url);
      if (
        request.method !== "POST" || url.pathname !== CONTROL_PLANE_RUNTIME_CAPABILITIES_PATH ||
        url.search
      ) return Response.json({ errorCode: "BROKER_INGRESS_TARGET_MISMATCH" }, { status: 400 });
      const timeout = new AbortController();
      const timer = setTimeout(() => timeout.abort(), 3000);
      const operationSignal = AbortSignal.any([signal, request.signal, timeout.signal]);
      try {
        let raw: string;
        let payload: ReturnType<typeof schema.parse>;
        try {
          raw = new TextDecoder("utf-8", { fatal: true }).decode(
            await readBodyBytesWithLimit(request, 4096, { signal: operationSignal }),
          );
          payload = schema.parse(JSON.parse(raw));
        } catch (error) {
          if (operationSignal.aborted) return unavailable();
          return Response.json({ errorCode: "BROKER_INGRESS_INVALID_BODY" }, {
            status: isRequestBodyTooLargeError(error) ? 413 : 400,
          });
        }
        const signature = request.headers.get(CONTROL_PLANE_JWS_HEADER);
        if (!signature || payload.projectId !== projectId || payload.surface !== expectedSurface) {
          return Response.json({ errorCode: "BROKER_INGRESS_AUTH_INVALID" }, { status: 401 });
        }
        try {
          await verifyControlPlaneJws(signature, raw, {
            audience,
            expectedProjectId: projectId,
            expectedSubject: payload.requestId,
            expectedSurface,
            publicKeyPem,
            maxAgeSeconds: 60,
            requestMethod: "POST",
            requestPath: url.pathname,
          });
        } catch {
          return Response.json({ errorCode: "BROKER_INGRESS_AUTH_INVALID" }, { status: 401 });
        }
        if (operationSignal.aborted) return unavailable();
        return Response.json({
          project_id: projectId,
          capabilities: { account_agent_publications: { version: 2 } },
        }, { headers: { "cache-control": "no-store" } });
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
