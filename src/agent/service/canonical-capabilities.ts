import {
  getRuntimeConfigurationReferenceSchema,
  type RuntimeConfigurationReference,
  snapshotRuntimeConfigurationReference,
} from "../runtime/runtime-configuration-reference.ts";
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
    & {
      signal: AbortSignal;
      projectExecutionConfigurationVersion?: 1;
      confirmProjectExecutionConfiguration?: (
        reference: RuntimeConfigurationReference,
      ) => RuntimeConfigurationReference;
    },
) {
  const { publicKeyPem, audience, projectId, expectedSurface, signal } = input;
  const confirmConfiguration = input.confirmProjectExecutionConfiguration;
  const configured = input.projectExecutionConfigurationVersion;
  if (
    (configured !== undefined && configured !== 1) || (configured === 1 && !confirmConfiguration)
  ) throw new TypeError("Invalid agent execution configuration capability");
  const schema = getControlPlaneProjectMetadataRequestSchema().extend({
    runtimeConfiguration: getRuntimeConfigurationReferenceSchema().optional(),
  });
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
        let installedReference: RuntimeConfigurationReference | undefined;
        if (payload.runtimeConfiguration) {
          try {
            if (
              configured !== 1 || !confirmConfiguration ||
              payload.runtimeConfiguration.projectId !== projectId
            ) {
              return unavailable();
            }
            installedReference = snapshotRuntimeConfigurationReference(
              confirmConfiguration(payload.runtimeConfiguration),
            );
            for (
              const key of Object.keys(
                installedReference,
              ) as (keyof RuntimeConfigurationReference)[]
            ) {
              if (installedReference[key] !== payload.runtimeConfiguration[key]) {
                return unavailable();
              }
            }
          } catch {
            return unavailable();
          }
        }
        return Response.json({
          project_id: projectId,
          capabilities: {
            account_agent_publications: { version: 2 },
            ...(configured === 1
              ? {
                agent_execution_configuration: {
                  version: 1,
                  ...(installedReference ? { reference: installedReference } : {}),
                },
              }
              : {}),
          },
        }, { headers: { "cache-control": "no-store" } });
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
