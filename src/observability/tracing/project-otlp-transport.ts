import { createOriginBoundOutboundFetch } from "#veryfront/security/http/outbound-fetch.ts";
import { defineOwnDataProperty } from "#veryfront/security/own-data-property.ts";

export const PROJECT_OTLP_MAX_REQUEST_BYTES = 1024 * 1024;
const MAX_TIMEOUT_MS = 10_000;
const MAX_CONCURRENT_SENDS = 2;

export type ProjectOtlpSendResult =
  | { status: "success" }
  | { status: "failure"; error: Error };

/** Structural subset of the OpenTelemetry SDK's IExporterTransport contract. */
export interface ProjectOtlpTransport {
  send(data: Uint8Array, timeoutMillis: number): Promise<ProjectOtlpSendResult>;
  shutdown(): void;
}

interface ProjectOtlpTransportOptions {
  /** Already validated by the authenticated project-settings resolver. */
  endpoint: string;
  headers: Readonly<Record<string, string>>;
  /** The SDK owner supplies its context-based instrumentation suppression. */
  withSuppressedTracing<T>(operation: () => Promise<T>): Promise<T>;
}

const NativeAbortController = AbortController;
const freeze = Object.freeze;
const entries = Object.entries;
const apply = Reflect.apply;
const lowerCase = String.prototype.toLowerCase;
const schedule = setTimeout;
const cancelTimer = clearTimeout;

function failed(): ProjectOtlpSendResult {
  // Collector URLs, response text and transport errors can contain credentials.
  return { status: "failure", error: new Error("Project trace export failed") };
}

/** Host-owned, origin-bound JSON OTLP transport with bounded request lifetime. */
export function createProjectOtlpTransport(
  options: ProjectOtlpTransportOptions,
): ProjectOtlpTransport {
  const endpoint = options.endpoint;
  const fetch = createOriginBoundOutboundFetch(endpoint);
  const headerSnapshot: Record<string, string> = {};
  const pairs = entries(options.headers);
  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i]!;
    const name = apply(lowerCase, pair[0], []) as string;
    if (name === "content-type") continue;
    defineOwnDataProperty(headerSnapshot, name, pair[1], { enumerable: true, configurable: true });
  }
  defineOwnDataProperty(headerSnapshot, "content-type", "application/json", { enumerable: true });
  const headers = freeze(headerSnapshot);
  const suppress = options.withSuppressedTracing;
  const active = new Set<() => void>();
  let closed = false;

  return freeze({
    send(data: Uint8Array, timeoutMillis: number): Promise<ProjectOtlpSendResult> {
      if (
        closed || active.size >= MAX_CONCURRENT_SENDS ||
        data.byteLength > PROJECT_OTLP_MAX_REQUEST_BYTES ||
        !Number.isFinite(timeoutMillis) || timeoutMillis <= 0
      ) return Promise.resolve(failed());

      const body = new Uint8Array(data);
      const controller = new NativeAbortController();
      return new Promise((resolve) => {
        let settled = false;
        const finish = (result: ProjectOtlpSendResult) => {
          if (settled) return;
          settled = true;
          cancelTimer(timer);
          active.delete(cancel);
          resolve(result);
        };
        const cancel = () => {
          controller.abort();
          finish(failed());
        };
        active.add(cancel);
        const timer = schedule(cancel, Math.min(timeoutMillis, MAX_TIMEOUT_MS));

        // A separate completion path enforces the deadline even if a transport ignores abort.
        Promise.resolve().then(() =>
          suppress(async () => {
            if (controller.signal.aborted) return failed();
            const response = await fetch(endpoint, {
              method: "POST",
              headers,
              body,
              signal: controller.signal,
              redirect: "error",
            });
            // Delivery is best effort. Never retain/log an untrusted collector response body.
            // OTLP partial-success responses are not retried, consistent with the SDK contract.
            response.body?.cancel().catch(() => {});
            return response.ok ? { status: "success" as const } : failed();
          })
        ).then(finish, () => finish(failed()));
      });
    },
    shutdown(): void {
      closed = true;
      for (const cancel of active) cancel();
    },
  });
}
