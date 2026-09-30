import {
  createErrorResponseFromDefinition,
  PROJECT_EXECUTION_UNAVAILABLE,
} from "#veryfront/errors";
import {
  isChannelDispatchRoute,
  isControlPlaneSurfaceRoute,
} from "#veryfront/channels/control-plane.ts";
import { isWebSocketUpgrade } from "#veryfront/platform/compat/http/websocket.ts";
import { inheritRequestPeerProvenance } from "#veryfront/platform/adapters/runtime/shared/request-peer.ts";
import { isHMRWebSocketUpgrade, isMonitoringPath } from "../runtime-handler/request-utils.ts";
import {
  type InstalledProjectHttpBinding,
  snapshotInstalledProjectHttpBinding,
} from "../runtime-handler/installed-project.ts";
import { getEffectiveRequestOrigin } from "../utils/request-host.ts";
import type { createHostedHttpBroker, HostedHttpInput } from "./hosted-http-broker.ts";
import type { ExecutorHttpApplicationConfiguration } from "./application-configuration.ts";

/** Trusted edge selection. The resolver must authorize these values against the source API. */
export interface HostedHttpRequestAuthority extends InstalledProjectHttpBinding {
  /** Source-read credential. It remains on the host and is never added to the application environment. */
  readonly sourceToken: string;
}

/**
 * Host-owned ingress composition, absent by default and never read from project configuration.
 * Proxy mode must have host project execution disabled. Complete project, immutable release,
 * and named environment identities are required; preview branches and failed resolution return
 * a non-cacheable project-execution-unavailable response without host execution fallback.
 * Control-plane routes and native HMR retain their existing handlers. Other WebSocket upgrades
 * are unavailable. The installed application handles its own authentication, CORS and middleware.
 * Source publication, resolver authorization and executor deployment remain caller prerequisites.
 */
export interface HostedHttpIngressOptions {
  /** Existing executor pool. The caller owns its shutdown and settlement. */
  broker: Pick<ReturnType<typeof createHostedHttpBroker>, "fetch">;
  /** Authorize the exact identity and resolve its immutable image and application configuration without evaluating project code. */
  resolve(authority: HostedHttpRequestAuthority, signal: AbortSignal): Promise<
    HostedHttpInput & { configuration: ExecutorHttpApplicationConfiguration }
  >;
}

interface IngressSelection extends Partial<InstalledProjectHttpBinding> {
  sourceToken: string;
  mode: "preview" | "production" | undefined;
  proxyTrusted: boolean | undefined;
}

/** Keep framework-owned signed dispatch and native HMR on their existing handlers. */
export function isHostedHttpApplicationRequest(request: Request): boolean {
  const pathname = new URL(request.url).pathname;
  return !isMonitoringPath(pathname) &&
    !isControlPlaneSurfaceRoute(request.method, pathname) &&
    !isChannelDispatchRoute(request.method, pathname) &&
    !(request.method === "GET" && isHMRWebSocketUpgrade(request, pathname));
}

function unavailable(request: Request): Response {
  const response = createErrorResponseFromDefinition(PROJECT_EXECUTION_UNAVAILABLE, {
    detail: "An authorized isolated application release is unavailable",
    instance: new URL(request.url).pathname,
  });
  response.headers.set("cache-control", "no-store");
  return response;
}

/** Snapshot host callbacks once; a refused resolution never falls back to project execution on the host. */
export function createHostedHttpIngress(options: HostedHttpIngressOptions) {
  if (typeof options.resolve !== "function" || typeof options.broker?.fetch !== "function") {
    throw new TypeError("Hosted HTTP ingress requires an authorized resolver and broker");
  }
  const resolve = options.resolve.bind(options);
  const fetch = options.broker.fetch.bind(options.broker);
  return async (request: Request, selection: IngressSelection): Promise<Response> => {
    request.signal.throwIfAborted();
    if (
      selection.proxyTrusted !== true || selection.mode !== "production" ||
      !selection.sourceToken || selection.sourceToken.length > 8192 || isWebSocketUpgrade(request)
    ) return unavailable(request);
    const origin = getEffectiveRequestOrigin(request, undefined, true);
    if (!origin) return unavailable(request);
    try {
      const identity = snapshotInstalledProjectHttpBinding({
        projectId: selection.projectId,
        projectSlug: selection.projectSlug,
        releaseId: selection.releaseId,
        environmentId: selection.environmentId,
        environmentName: selection.environmentName,
      });
      const input = await resolve(
        Object.freeze({ ...identity, sourceToken: selection.sourceToken }),
        request.signal,
      );
      request.signal.throwIfAborted();
      for (
        const key of [
          "projectId",
          "projectSlug",
          "releaseId",
          "environmentId",
          "environmentName",
        ] as const
      ) {
        if (input.configuration?.[key] !== identity[key]) return unavailable(request);
      }
      if (
        input.installation.owner.scopeKind !== "project" ||
        input.installation.owner.projectId !== identity.projectId ||
        input.installation.source.releaseId !== identity.releaseId ||
        input.installation.environmentId !== identity.environmentId
      ) return unavailable(request);
      const url = new URL(request.url);
      const publicOrigin = new URL(origin);
      url.protocol = publicOrigin.protocol;
      url.host = publicOrigin.host;
      url.port = publicOrigin.port;
      const headers = new Headers(request.headers);
      headers.set("host", url.host);
      const applicationRequest = inheritRequestPeerProvenance(
        request,
        new Request(url, {
          method: request.method,
          headers,
          body: request.body,
          signal: request.signal,
          ...(request.body ? { duplex: "half" as const } : {}),
        }),
      );
      return await fetch(applicationRequest, input);
    } catch {
      request.signal.throwIfAborted();
      return unavailable(request);
    }
  };
}
