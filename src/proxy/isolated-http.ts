import {
  createHostedHttpIngress,
  createHostedHttpUnavailableResponse,
  isHostedHttpApplicationRequest,
  isUnsupportedHostedHttpSurface,
} from "#veryfront/server/isolated-http/hosted-http-ingress.ts";
import type { HostedHttpComposition } from "#veryfront/server/isolated-http/hosted-http-composition.ts";
import { snapshotInstalledProjectHttpBinding } from "#veryfront/server/runtime-handler/installed-project.ts";
import { inheritRequestPeerProvenance } from "#veryfront/platform/adapters/runtime/shared/request-peer.ts";
import { waitForSharedPromise } from "#veryfront/utils/singleflight.ts";
import type { ProxyContext } from "./handler.ts";
import { createSplitForwardRequestInit } from "./split-forward-request.ts";
import { DedicatedServerLookupUnavailable } from "./server-resolver.ts";
import { isHostedHttpIsolationEnabled } from "#veryfront/server/isolated-http/hosted-http-flag.ts";

export type ProxyHttpRoute =
  | { kind: "framework" }
  | { kind: "assigned"; origin: string }
  | { kind: "response"; response: Response };

/** Default-off host configuration; never load the Node-only module for ordinary proxies. */
export async function startProxyHttpIsolation(
  options: { requireDedicatedRouting: boolean; localProjects: Record<string, string> },
  dependencies: {
    isEnabled?: () => boolean;
    loadHost?: () => Promise<HostedHttpComposition>;
  } = {},
) {
  if (!(dependencies.isEnabled ?? isHostedHttpIsolationEnabled)()) return undefined;
  if (!options.requireDedicatedRouting || Object.keys(options.localProjects).length > 0) {
    throw new TypeError(
      "Proxy HTTP isolation requires strict dedicated routing without local projects",
    );
  }
  const host = await (dependencies.loadHost ?? (async () => {
    const module = await import("#veryfront/server/isolated-http/hosted-http-composition.ts");
    const config = module.readHostedHttpCompositionConfig();
    if (!config) throw new TypeError("Proxy HTTP isolation configuration changed during startup");
    return await module.createHostedHttpComposition(config);
  }))();
  try {
    return createProxyHttpIsolation(host);
  } catch (error) {
    try {
      await host.shutdown();
    } catch (retirement) {
      throw new AggregateError(
        [error, retirement],
        "Proxy HTTP isolation startup retirement failed",
      );
    }
    throw error;
  }
}

/** Reuse the HTTP execution boundary inside the trusted application Proxy. */
export function createProxyHttpIsolation(host: HostedHttpComposition) {
  const ingress = createHostedHttpIngress(host.ingress);
  const lifetime = new AbortController();
  const pending = new Set<Promise<ProxyHttpRoute>>();
  let stopped: Promise<void> | undefined;

  async function route(
    request: Request,
    context: ProxyContext,
    lookupAssignedOrigin: () => Promise<string | null>,
  ): Promise<ProxyHttpRoute> {
    request.signal.throwIfAborted();
    if (!isHostedHttpApplicationRequest(request)) return { kind: "framework" };
    const refused = (): ProxyHttpRoute => ({
      kind: "response",
      response: createHostedHttpUnavailableResponse(request),
    });
    const hostMode = context.parsedDomain.environment === "preview" ? "preview" : "production";
    if (
      lifetime.signal.aborted || context.error || context.isLocalProject ||
      context.environment !== "production" || hostMode !== "production" ||
      isUnsupportedHostedHttpSurface(request)
    ) return refused();
    let binding;
    try {
      binding = snapshotInstalledProjectHttpBinding({
        projectId: context.projectId,
        projectSlug: context.projectSlug,
        releaseId: context.releaseId,
        environmentId: context.environmentId,
        environmentName: context.environmentName,
      });
    } catch {
      return refused();
    }
    const sourceToken = context.token;
    if (!sourceToken || sourceToken.length > 8192) return refused();
    const signal = AbortSignal.any([request.signal, lifetime.signal]);
    // Capture canonical forwarding policy before asynchronous assignment lookup.
    const init = createSplitForwardRequestInit(request, context, request.body, signal);
    const assigned = await waitForSharedPromise(
      Promise.resolve().then(() => {
        signal.throwIfAborted();
        return lookupAssignedOrigin();
      }),
      signal,
    );
    signal.throwIfAborted();
    if (assigned !== null) {
      try {
        const origin = new URL(assigned);
        if (!["http:", "https:"].includes(origin.protocol) || origin.origin !== assigned) {
          throw new TypeError("Invalid assigned origin");
        }
      } catch {
        throw new DedicatedServerLookupUnavailable();
      }
      // The caller pins this exact origin for retries; no shared fallback.
      return { kind: "assigned", origin: assigned };
    }
    const forwarded = inheritRequestPeerProvenance(request, new Request(request.url, init));
    return {
      kind: "response",
      response: await ingress(forwarded, {
        ...binding,
        sourceToken,
        mode: "production",
        hostMode,
        proxyTrusted: true,
      }),
    };
  }

  return {
    route(
      request: Request,
      context: ProxyContext,
      lookupAssignedOrigin: () => Promise<string | null>,
    ) {
      const operation = route(request, context, lookupAssignedOrigin);
      pending.add(operation);
      void operation.then(() => pending.delete(operation), () => pending.delete(operation));
      return operation;
    },
    shutdown(): Promise<void> {
      if (!stopped) {
        lifetime.abort(new DOMException("Proxy HTTP isolation retired", "AbortError"));
        stopped = (async () => {
          const results = await Promise.allSettled([
            Promise.resolve().then(() => host.shutdown()),
            ...pending,
          ]);
          const failures = results.filter((result) => result.status === "rejected");
          // Dispatch cancellation is expected after closing admission; host retirement is not.
          if (results[0].status === "rejected") throw results[0].reason;
          if (failures.some((result) => result.reason?.name !== "AbortError")) {
            throw new AggregateError(
              failures.map((result) => result.reason),
              "Proxy HTTP settlement failed",
            );
          }
        })();
      }
      return stopped;
    },
  };
}
