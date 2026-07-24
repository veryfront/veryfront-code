/**
 * Fetches project environment variables from the Veryfront API.
 *
 * @module server/project-env/fetcher
 */

import { encodeBase64, getBaseLogger } from "#veryfront/utils";
import { NETWORK_ERROR, VeryfrontError } from "#veryfront/errors";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import {
  createProjectEnvSnapshot,
  PROJECT_ENV_SNAPSHOT_LIMITS,
  type ProjectEnvSnapshot,
} from "./snapshot.ts";

const baseLogger = getBaseLogger("PROJECT-ENV");

const logger = baseLogger.component("project-env");

/** Max env vars per request. API enforces a hard cap of 100. */
const ENV_VARS_FETCH_LIMIT = 100;
const MASKED_ENV_VALUE = "********";
const JSON_WORST_CASE_ESCAPE_EXPANSION = 6;
const JSON_ENTRY_FRAMING_BYTES = 64;
const JSON_DOCUMENT_FRAMING_BYTES = 64;
/** Worst-case JSON escaping plus bounded entry/document framing. */
export const MAX_PROJECT_ENV_RESPONSE_BYTES =
  PROJECT_ENV_SNAPSHOT_LIMITS.maxUtf8Bytes * JSON_WORST_CASE_ESCAPE_EXPANSION +
  ENV_VARS_FETCH_LIMIT * JSON_ENTRY_FRAMING_BYTES +
  JSON_DOCUMENT_FRAMING_BYTES;
const IntrinsicArray = Array;
const IntrinsicUint8Array = Uint8Array;
const ArrayIsArray = Array.isArray;
const ArrayPrototypePush = Array.prototype.push;
const JSONParse = JSON.parse;
const ObjectCreate = Object.create;
const ObjectDefineProperty = Object.defineProperty;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ObjectPrototype = Object.prototype;
const ReflectApply = Reflect.apply;
const ReflectOwnKeys = Reflect.ownKeys;
const FunctionPrototypeHasInstance = Function.prototype[Symbol.hasInstance];
const TextDecoderPrototypeDecode = TextDecoder.prototype.decode;
const Uint8ArrayPrototypeSet = Uint8Array.prototype.set;
const fatalUtf8Decoder = new TextDecoder("utf-8", { fatal: true });
const defaultProjectEnvFetch = globalThis.fetch;
const typedArrayPrototype = ObjectGetPrototypeOf(Uint8Array.prototype);
const maybeTypedArrayByteLengthGetter = typedArrayPrototype
  ? ObjectGetOwnPropertyDescriptor(typedArrayPrototype, "byteLength")?.get
  : undefined;

if (!maybeTypedArrayByteLengthGetter) {
  throw new TypeError("Typed-array byte-length intrinsic is unavailable");
}
const typedArrayByteLengthGetter = maybeTypedArrayByteLengthGetter as () => number;

export interface FetchProjectEnvOptions {
  readonly signal?: AbortSignal;
  readonly fetch?: typeof globalThis.fetch;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || ArrayIsArray(value)) return false;
  const prototype = ObjectGetPrototypeOf(value);
  return prototype === ObjectPrototype || prototype === null;
}

function isIntrinsicUint8Array(value: unknown): value is Uint8Array {
  return ReflectApply(
    FunctionPrototypeHasInstance,
    IntrinsicUint8Array,
    [value],
  ) as boolean;
}

function typedArrayByteLength(value: Uint8Array): number {
  return ReflectApply(typedArrayByteLengthGetter, value, []) as number;
}

function defineDataProperty(
  target: object,
  key: PropertyKey,
  value: unknown,
): void {
  const descriptor = ObjectCreate(null) as PropertyDescriptor;
  descriptor.value = value;
  descriptor.enumerable = true;
  descriptor.configurable = false;
  descriptor.writable = false;
  ObjectDefineProperty(target, key, descriptor);
}

function getInternalAuthorization(): string | undefined {
  const username = getHostEnv("VERYFRONT_API_INTERNAL_USER");
  const password = getHostEnv("VERYFRONT_API_INTERNAL_PASS");
  if (!username || !password) return undefined;
  return `Basic ${encodeBase64(`${username}:${password}`)}`;
}

async function fetchEnvironmentVariables(
  url: string,
  authorization: string,
  projectSlug: string,
  environmentId: string,
  options: FetchProjectEnvOptions,
): Promise<Response> {
  try {
    return await (options.fetch ?? defaultProjectEnvFetch)(url, {
      headers: {
        Authorization: authorization,
        Accept: "application/json",
      },
      signal: options.signal,
    });
  } catch (error) {
    logger.error("Env var fetch network error", {
      projectSlug,
      environmentId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw NETWORK_ERROR.create({
      detail: "Failed to fetch project environment variables",
      cause: error,
    });
  }
}

async function cancelResponseBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

async function requireSuccessfulResponse(
  response: Response,
  projectSlug: string,
  environmentId: string,
): Promise<Response> {
  if (response.ok) return response;

  await cancelResponseBody(response);
  logger.warn("Failed to fetch env vars", {
    projectSlug,
    environmentId,
    status: response.status,
  });
  throw NETWORK_ERROR.create({ detail: `Failed to fetch env vars: ${response.status}` });
}

async function readBoundedResponseText(response: Response): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && /^\d+$/.test(declaredLength)) {
    const parsedLength = Number(declaredLength);
    if (
      !Number.isSafeInteger(parsedLength) ||
      parsedLength > MAX_PROJECT_ENV_RESPONSE_BYTES
    ) {
      await cancelResponseBody(response);
      throw NETWORK_ERROR.create({ detail: "Project environment response is too large" });
    }
  }

  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = new IntrinsicArray<Uint8Array>();
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!isIntrinsicUint8Array(value)) {
        throw NETWORK_ERROR.create({ detail: "Project environment response body is invalid" });
      }
      totalBytes += typedArrayByteLength(value);
      if (totalBytes > MAX_PROJECT_ENV_RESPONSE_BYTES) {
        throw NETWORK_ERROR.create({ detail: "Project environment response is too large" });
      }
      ReflectApply(ArrayPrototypePush, chunks, [value]);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }

  const bytes = new IntrinsicUint8Array(totalBytes);
  let offset = 0;
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index]!;
    ReflectApply(Uint8ArrayPrototypeSet, bytes, [chunk, offset]);
    offset += typedArrayByteLength(chunk);
  }
  try {
    return ReflectApply(
      TextDecoderPrototypeDecode,
      fatalUtf8Decoder,
      [bytes],
    ) as string;
  } catch {
    throw NETWORK_ERROR.create({
      detail: "Project environment response is not valid UTF-8",
    });
  }
}

function parseEnvironmentVariableResponse(text: string): ProjectEnvSnapshot {
  let body: unknown;
  try {
    body = JSONParse(text);
  } catch {
    throw NETWORK_ERROR.create({ detail: "Project environment response is not valid JSON" });
  }
  if (!isPlainRecord(body)) {
    throw NETWORK_ERROR.create({ detail: "Project environment response must be an object" });
  }

  const data = body.data;
  if (data === undefined) return createProjectEnvSnapshot({});
  if (!ArrayIsArray(data)) {
    throw NETWORK_ERROR.create({ detail: "Project environment response data must be an array" });
  }
  if (
    data.length > ENV_VARS_FETCH_LIMIT ||
    data.length > PROJECT_ENV_SNAPSHOT_LIMITS.maxEntries
  ) {
    throw NETWORK_ERROR.create({ detail: "Project environment response has too many entries" });
  }

  const result = ObjectCreate(null) as Record<string, string>;
  for (let index = 0; index < data.length; index += 1) {
    const entry = data[index];
    if (
      !isPlainRecord(entry) ||
      typeof entry.key !== "string" ||
      typeof entry.value !== "string"
    ) {
      throw NETWORK_ERROR.create({
        detail: "Project environment response contains an invalid entry",
      });
    }
    if (ObjectGetOwnPropertyDescriptor(result, entry.key) !== undefined) {
      throw NETWORK_ERROR.create({
        detail: "Project environment response contains duplicate keys",
      });
    }
    if (entry.value === MASKED_ENV_VALUE) {
      throw NETWORK_ERROR.create({
        detail: "Refusing masked environment variable response",
      });
    }
    defineDataProperty(result, entry.key, entry.value);
  }
  return createProjectEnvSnapshot(result);
}

/**
 * Fetch environment variables for a project from the Veryfront API.
 *
 * Hosted runtimes first use the project bearer token to prove that the
 * environment belongs to the requested project. When internal credentials are
 * configured, the privileged endpoint is queried only after that association
 * check succeeds. Older API deployments without the internal endpoint reuse
 * the already-authorized management response.
 * Response: { data: [{ key: string, value: string }] }
 */
export async function fetchProjectEnvVars(
  apiBaseUrl: string,
  projectSlug: string,
  environmentId: string,
  token: string,
  options: FetchProjectEnvOptions = {},
): Promise<ProjectEnvSnapshot> {
  const managementUrl = `${apiBaseUrl}/projects/${
    encodeURIComponent(projectSlug)
  }/environment-variables?environment_id=${
    encodeURIComponent(environmentId)
  }&limit=${ENV_VARS_FETCH_LIMIT}`;
  const internalUrl = `${apiBaseUrl}/internal/project-environment-variables?environment_id=${
    encodeURIComponent(environmentId)
  }&project_slug=${encodeURIComponent(projectSlug)}`;

  const internalAuthorization = getInternalAuthorization();
  const managementResponse = await requireSuccessfulResponse(
    await fetchEnvironmentVariables(
      managementUrl,
      `Bearer ${token}`,
      projectSlug,
      environmentId,
      options,
    ),
    projectSlug,
    environmentId,
  );

  let response = managementResponse;
  if (internalAuthorization) {
    let internalResponse: Response;
    try {
      internalResponse = await fetchEnvironmentVariables(
        internalUrl,
        internalAuthorization,
        projectSlug,
        environmentId,
        options,
      );
    } catch (error) {
      await cancelResponseBody(managementResponse);
      throw error;
    }

    if (internalResponse.status === 404) {
      await cancelResponseBody(internalResponse);
    } else {
      await cancelResponseBody(managementResponse);
      response = await requireSuccessfulResponse(
        internalResponse,
        projectSlug,
        environmentId,
      );
    }
  }

  try {
    const result = parseEnvironmentVariableResponse(
      await readBoundedResponseText(response),
    );

    logger.debug("Fetched env vars", {
      projectSlug,
      environmentId,
      count: ReflectOwnKeys(result).length,
    });

    return result;
  } catch (error) {
    logger.error("Env var fetch parse error", {
      projectSlug,
      environmentId,
      error: error instanceof Error ? error.message : String(error),
    });
    if (error instanceof VeryfrontError && error.slug === NETWORK_ERROR.slug) {
      throw error;
    }
    throw NETWORK_ERROR.create({
      detail: "Project environment response failed validation",
      cause: error,
    });
  }
}
