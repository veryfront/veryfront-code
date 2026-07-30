import { useEffect, useRef } from "react";

/** Maximum JSON body admitted from a local Dev UI endpoint. */
export const MAX_DEV_UI_JSON_RESPONSE_BYTES = 2 * 1024 * 1024;

const MAX_ERROR_DETAIL_CHARACTERS = 2_000;

export type JsonObject = Record<string, unknown>;

export interface JsonRequestOptions<T> {
  readonly responseLabel: string;
  readonly admit: (value: unknown) => T;
  readonly init?: RequestInit;
  readonly fetchImpl?: typeof globalThis.fetch;
  readonly maxResponseBytes?: number;
}

/** A request token whose callbacks are valid only while it owns the latest generation. */
export interface OwnedRequest {
  readonly signal: AbortSignal;
  isCurrent(): boolean;
  finish(): boolean;
}

/**
 * Own one replaceable request generation.
 *
 * Superseded requests are aborted, but correctness does not depend on fetch
 * honoring the signal: their tokens can no longer publish or finalize state.
 */
export class LatestRequestOwner {
  #current?: AbortController;

  get busy(): boolean {
    return this.#current !== undefined;
  }

  begin(): OwnedRequest {
    this.cancel();
    return this.#begin();
  }

  beginIfIdle(): OwnedRequest | null {
    return this.#current === undefined ? this.#begin() : null;
  }

  cancel(): void {
    const current = this.#current;
    this.#current = undefined;
    current?.abort();
  }

  #begin(): OwnedRequest {
    const controller = new AbortController();
    this.#current = controller;

    return Object.freeze({
      signal: controller.signal,
      isCurrent: (): boolean => this.#current === controller && !controller.signal.aborted,
      finish: (): boolean => {
        if (this.#current !== controller || controller.signal.aborted) return false;
        this.#current = undefined;
        controller.abort();
        return true;
      },
    });
  }
}

export interface OwnedRequestObservers<T> {
  readonly start?: () => void;
  readonly success: (value: T) => void;
  readonly error: (error: unknown) => void;
  readonly finish?: () => void;
}

/** Execute a request whose state callbacks belong exclusively to its generation. */
export async function runOwnedRequest<T>(
  owner: LatestRequestOwner,
  operation: (signal: AbortSignal) => Promise<T>,
  observers: OwnedRequestObservers<T>,
  mode: "replace" | "skip-while-busy" = "replace",
): Promise<void> {
  const request = mode === "replace" ? owner.begin() : owner.beginIfIdle();
  if (request === null) return;

  try {
    observers.start?.();
    const value = await operation(request.signal);
    if (request.isCurrent()) observers.success(value);
  } catch (error) {
    if (request.isCurrent() && !isAbortError(error)) observers.error(error);
  } finally {
    if (request.finish()) observers.finish?.();
  }
}

/** Keep one request owner for a component lifetime and revoke it on unmount. */
export function useLatestRequestOwner(): LatestRequestOwner {
  const ownerRef = useRef<LatestRequestOwner | null>(null);
  ownerRef.current ??= new LatestRequestOwner();
  const owner = ownerRef.current;

  useEffect(() => () => owner.cancel(), [owner]);
  return owner;
}

/** Fetch, size-bound, parse, and explicitly admit one JSON response. */
export async function requestJson<T>(
  input: string | URL | Request,
  options: JsonRequestOptions<T>,
): Promise<T> {
  const responseLabel = options.responseLabel.trim();
  if (responseLabel.length === 0) throw new TypeError("JSON response label must not be empty");

  const maxResponseBytes = options.maxResponseBytes ?? MAX_DEV_UI_JSON_RESPONSE_BYTES;
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes <= 0) {
    throw new TypeError("JSON response byte limit must be a positive safe integer");
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const response = await fetchImpl(input, options.init);
  const body = await readBoundedUtf8Body(response, responseLabel, maxResponseBytes);

  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch (cause) {
    throw new TypeError(
      `${responseLabel} returned malformed JSON (HTTP ${response.status})`,
      { cause },
    );
  }

  if (!response.ok) {
    const detail = readErrorDetail(value);
    throw new Error(
      `${responseLabel} failed (HTTP ${response.status})${detail === null ? "" : `: ${detail}`}`,
    );
  }

  try {
    return options.admit(value);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new TypeError(`${responseLabel} returned an invalid response: ${detail}`, { cause });
  }
}

async function readBoundedUtf8Body(
  response: Response,
  responseLabel: string,
  maxResponseBytes: number,
): Promise<string> {
  if (response.body === null) return "";

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxResponseBytes) {
        try {
          await reader.cancel(`${responseLabel} response exceeded its byte limit`);
        } catch {
          // The explicit size failure remains authoritative if stream cancellation also fails.
        }
        throw new RangeError(`${responseLabel} response exceeds ${maxResponseBytes} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (cause) {
    throw new TypeError(`${responseLabel} returned invalid UTF-8`, { cause });
  }
}

export function expectJsonObject(value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as JsonObject;
}

export function expectJsonArray(
  value: unknown,
  label: string,
  maxItems: number,
): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  if (!Number.isSafeInteger(maxItems) || maxItems < 0) {
    throw new TypeError("JSON array item limit must be a non-negative safe integer");
  }
  if (value.length > maxItems) throw new RangeError(`${label} exceeds ${maxItems} items`);
  return value;
}

export function expectJsonString(
  value: unknown,
  label: string,
  maxCharacters: number,
  allowEmpty = true,
): string {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string`);
  if ((!allowEmpty && value.length === 0) || value.length > maxCharacters) {
    const range = allowEmpty ? `at most ${maxCharacters}` : `between 1 and ${maxCharacters}`;
    throw new RangeError(`${label} must contain ${range} characters`);
  }
  return value;
}

export function expectJsonBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new TypeError(`${label} must be a boolean`);
  return value;
}

export function expectFiniteJsonNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number`);
  }
  return value;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function readErrorDetail(value: unknown): string | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as JsonObject;
  const message = [record.error, record.detail, record.message].find((candidate) =>
    typeof candidate === "string" && candidate.trim().length > 0
  );
  if (typeof message !== "string") return null;

  const hint = typeof record.hint === "string" && record.hint.trim().length > 0
    ? record.hint.trim()
    : null;
  const combined = hint === null ? message.trim() : `${message.trim()}\n\n${hint}`;
  return combined.length <= MAX_ERROR_DETAIL_CHARACTERS
    ? combined
    : `${combined.slice(0, MAX_ERROR_DETAIL_CHARACTERS - 1)}…`;
}
