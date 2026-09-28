import {
  chainPrivatePromise,
  createPrivateDeferred,
  observePrivatePromise,
  resolvePrivatePromise,
} from "#veryfront/security/private-promise.ts";
import { cancelPrivateStream } from "#veryfront/security/private-stream.ts";
import { privateByteLength, PrivateUint8Array } from "#veryfront/security/private-bytes.ts";
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
const NativeError = Error;
const isFiniteNumber = Number.isFinite;
const minimum = Math.min;
const getResponseBody = Object.getOwnPropertyDescriptor(Response.prototype, "body")!.get!;
const getResponseOk = Object.getOwnPropertyDescriptor(Response.prototype, "ok")!.get!;
const abortController = AbortController.prototype.abort;
const getSignal = Object.getOwnPropertyDescriptor(AbortController.prototype, "signal")!.get!;
const getAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")!.get!;
const NativeSet = Set;
const setSize = Object.getOwnPropertyDescriptor(Set.prototype, "size")!.get!;
const setAdd = Set.prototype.add;
const setDelete = Set.prototype.delete;
const setForEach = Set.prototype.forEach;
const freeze = Object.freeze;
const entries = Object.entries;
const apply = Reflect.apply;
const lowerCase = String.prototype.toLowerCase;
const schedule = setTimeout;
const cancelTimer = clearTimeout;

function failed(): ProjectOtlpSendResult {
  // Collector URLs, response text and transport errors can contain credentials.
  return { status: "failure", error: new NativeError("Project trace export failed") };
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
  const active = new NativeSet<() => void>();
  let closed = false;

  return freeze({
    send(data: Uint8Array, timeoutMillis: number): Promise<ProjectOtlpSendResult> {
      const completion = createPrivateDeferred<ProjectOtlpSendResult>();
      if (
        closed || apply(setSize, active, []) >= MAX_CONCURRENT_SENDS ||
        privateByteLength(data) > PROJECT_OTLP_MAX_REQUEST_BYTES ||
        !isFiniteNumber(timeoutMillis) || timeoutMillis <= 0
      ) {
        completion.resolve(failed());
        return completion.promise;
      }

      const body = new PrivateUint8Array(data);
      const controller = new NativeAbortController();
      const signal = apply(getSignal, controller, []) as AbortSignal;
      let settled = false;
      const finish = (result: ProjectOtlpSendResult) => {
        if (settled) return;
        settled = true;
        cancelTimer(timer);
        apply(setDelete, active, [cancel]);
        completion.resolve(result);
      };
      const cancel = () => {
        apply(abortController, controller, []);
        finish(failed());
      };
      apply(setAdd, active, [cancel]);
      const timer = schedule(cancel, minimum(timeoutMillis, MAX_TIMEOUT_MS));

      // Protected reactions prevent mutable Promise hooks from replaying a send.
      // A separate deadline still settles transports that ignore abort.
      void chainPrivatePromise(
        chainPrivatePromise(resolvePrivatePromise(), () =>
          suppress(async () => {
            if (apply(getAborted, signal, [])) return failed();
            const response = await observePrivatePromise(fetch(endpoint, {
              method: "POST",
              headers,
              body,
              signal,
              redirect: "error",
            }));
            // Collector response content is discarded, including partial-success bodies.
            const responseBody = apply(getResponseBody, response, []) as
              | ReadableStream<Uint8Array>
              | null;
            if (responseBody) {
              void chainPrivatePromise(cancelPrivateStream(responseBody), () => {}, () => {});
            }
            return apply(getResponseOk, response, []) ? { status: "success" as const } : failed();
          })),
        finish,
        () => finish(failed()),
      );
      return completion.promise;
    },
    shutdown(): void {
      closed = true;
      apply(setForEach, active, [(cancel: () => void) => cancel()]);
    },
  });
}
