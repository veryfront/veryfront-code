import { privateJsonParse } from "#veryfront/security/private-json.ts";
import {
  privateByteLength,
  privateByteSubarray,
  PrivateUint8Array,
  setPrivateBytes,
} from "#veryfront/security/private-bytes.ts";
import { createPrivateTextDecoder } from "#veryfront/security/private-text.ts";
import { cancelPrivateStream, getPrivateStreamReader } from "#veryfront/security/private-stream.ts";
import { primordialPromiseCatch } from "#veryfront/platform/compat/primordials/promise.ts";
import { createNativeRequestInit } from "#veryfront/platform/compat/http/native-request-init.ts";
import { readResponseValue, ResponseBodyGet, ResponseStatusGet } from "./native-response.ts";

const apply = Reflect.apply;
const ownDescriptor = Object.getOwnPropertyDescriptor;
const keys = Object.keys;
const safeInteger = Number.isSafeInteger;
const min = Math.min;
const indexOf = String.prototype.indexOf;
const slice = String.prototype.slice;
const decode = atob;
const now = Date.now;
const setTimer = globalThis.setTimeout;
const clearTimer = globalThis.clearTimeout;
const NativeAbortController = AbortController;
const abort = AbortController.prototype.abort;
const signalGetter = ownDescriptor(AbortController.prototype, "signal")!.get!;
const MAX_RESPONSE_BYTES = 256;

/** Expiry bounds observation only. The API authenticates the unchanged issuer capability. */
export function readRunStopObserverExpiry(token: string): number | undefined {
  try {
    if (token.length > 16_384) return undefined;
    const first: number = apply(indexOf, token, ["."]);
    const second: number = apply(indexOf, token, [".", first + 1]);
    if (first < 1 || second <= first + 1 || apply(indexOf, token, [".", second + 1]) !== -1) {
      return undefined;
    }
    const encoded: string = apply(slice, token, [first + 1, second]);
    let base64 = "";
    for (let i = 0; i < encoded.length; i++) {
      const ch: string = apply(slice, encoded, [i, i + 1]);
      base64 += ch === "-" ? "+" : ch === "_" ? "/" : ch;
    }
    const claims: unknown = privateJsonParse(decode(base64));
    if (claims === null || typeof claims !== "object") return undefined;
    const exp: unknown = ownDescriptor(claims, "exp")?.value;
    if (typeof exp !== "number" || !safeInteger(exp * 1_000)) return undefined;
    return exp * 1_000;
  } catch {
    return undefined;
  }
}

/** Observe one retained attempt capability; never publish stop-settlement evidence. */
export function observeProjectRunCancellation(input: {
  fetch: typeof fetch;
  url: string;
  token: string;
  expiresAt: number;
  onStopRequested: () => void;
  pollIntervalMs?: number;
  requestTimeoutMs?: number;
}): () => void {
  // Retain every authority-bearing value before any project code can run.
  const { fetch: transport, url, token, expiresAt, onStopRequested } = input;
  const intervalMs = input.pollIntervalMs ?? 1_000;
  const timeoutMs = input.requestTimeoutMs ?? 1_000;
  let active = safeInteger(expiresAt) && expiresAt > now();
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let requestController: AbortController | undefined;
  let requestTimer: ReturnType<typeof setTimeout> | undefined;
  let cancelRead: (() => void) | undefined;
  const dispose = () => {
    active = false;
    clearTimer(pollTimer);
    clearTimer(requestTimer);
    if (requestController) apply(abort, requestController, []);
    cancelRead?.();
  };
  const live = () => active && now() < expiresAt;
  const ignore = (promise: Promise<unknown>) => {
    void primordialPromiseCatch(promise, () => {});
  };
  const poll = async () => {
    if (!live()) {
      dispose();
      return;
    }
    const controller = new NativeAbortController();
    const signal: AbortSignal = apply(signalGetter, controller, []);
    requestController = controller;
    let expired = false;
    const timeout = requestTimer = setTimer(() => {
      expired = true;
      apply(abort, controller, []);
      cancelRead?.();
    }, min(timeoutMs, expiresAt - now()));
    try {
      const response = await transport(
        url,
        createNativeRequestInit(undefined, {
          method: "GET",
          redirect: "error",
          headers: { Authorization: `Bearer ${token}` },
          signal,
        }),
      );
      const body = readResponseValue<ReadableStream<Uint8Array> | null>(response, ResponseBodyGet);
      const status = readResponseValue<number>(response, ResponseStatusGet);
      if (!live() || expired || status !== 200 || !body) {
        if (body) ignore(cancelPrivateStream(body));
        if (status === 404) dispose();
        return;
      }
      const reader = getPrivateStreamReader(body);
      cancelRead = () => ignore(reader.cancel());
      const bytes = new PrivateUint8Array(MAX_RESPONSE_BYTES);
      let length = 0;
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          const size = privateByteLength(chunk.value);
          if (length + size > MAX_RESPONSE_BYTES) return;
          setPrivateBytes(bytes, chunk.value, length);
          length += size;
        }
        const result: unknown = privateJsonParse(
          createPrivateTextDecoder("utf-8", { fatal: true })
            .decode(privateByteSubarray(bytes, 0, length)),
        );
        if (result === null || typeof result !== "object" || keys(result).length !== 1) return;
        if (ownDescriptor(result, "stopRequested")?.value === true && live() && !expired) {
          // End observation before invoking local cancellation. No run-id tombstone or ACK.
          dispose();
          onStopRequested();
        }
      } finally {
        cancelRead = undefined;
        ignore(reader.cancel());
        reader.releaseLock();
      }
    } catch {
      /* Refusal, malformed data and unavailable transport never request a stop. */
    } finally {
      clearTimer(timeout);
      requestController = undefined;
      // A transport ignoring abort retains this sole slot until it settles; never overlap it.
      if (live()) {
        pollTimer = setTimer(() => {
          ignore(poll());
        }, intervalMs);
      } else dispose();
    }
  };
  if (active) ignore(poll());
  return dispose;
}
