import { defineSchema, lazySchema } from "#veryfront/schemas";
import type { HandlerContext } from "#veryfront/types";
import {
  getHostApiOriginExcludingEnvFile,
  getHostEnv,
} from "#veryfront/platform/compat/process.ts";
import { resolveVeryfrontInferenceApiBaseUrlFromHostEnv } from "#veryfront/platform/cloud/resolver.ts";
import { createHostInternalOriginBoundOutboundFetch } from "#veryfront/security/http/outbound-fetch.ts";
import { readResponseTextPrefix } from "#veryfront/utils/response-body.ts";
import { cancelPrivateStream, getPrivateStreamReader } from "#veryfront/security/private-stream.ts";
import {
  decryptApplicationInferenceToken,
  type EncryptedInferenceToken,
  generateApplicationInferenceEncryptionKeyPair,
  MAX_ENCRYPTED_INFERENCE_TOKEN_FIELD_BYTES,
} from "./application-inference-crypto.ts";

const parseJson = JSON.parse;
const stringifyJson = JSON.stringify;
const randomUUID = crypto.randomUUID.bind(crypto);
const NativeURL = URL;
const createObject = Object.create;
const defineProperty = Object.defineProperty;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const keys = Object.keys;
const timeout = AbortSignal.timeout.bind(AbortSignal);
const encodeBasic = globalThis.btoa.bind(globalThis);
const apply = Reflect.apply;
const bodyGetter = getOwnPropertyDescriptor(Response.prototype, "body")!.get!;
const okGetter = getOwnPropertyDescriptor(Response.prototype, "ok")!.get!;

const hostApplicationInferenceEncryptionKeyPair = generateApplicationInferenceEncryptionKeyPair();

function responseBody(response: Response): ReadableStream<Uint8Array> | null {
  return apply(bodyGetter, response, []);
}

async function discard(response: Response): Promise<void> {
  const body = responseBody(response);
  if (body) await cancelPrivateStream(body);
}

function encodePayload(fields: Record<string, string>): string {
  const payload = createObject(null);
  for (const key of keys(fields)) {
    defineProperty(payload, key, { value: fields[key], enumerable: true });
  }
  return stringifyJson(payload);
}

const admissionSchema = lazySchema(defineSchema((v) =>
  v.object({
    runId: v.string().uuid(),
    expiresAt: v.string().datetime(),
    encryptedInferenceToken: v.object({
      ephemeralPublicKey: v.string().min(1).max(MAX_ENCRYPTED_INFERENCE_TOKEN_FIELD_BYTES),
      iv: v.string().min(1).max(MAX_ENCRYPTED_INFERENCE_TOKEN_FIELD_BYTES),
      tag: v.string().min(1).max(MAX_ENCRYPTED_INFERENCE_TOKEN_FIELD_BYTES),
      ciphertext: v.string().min(1).max(MAX_ENCRYPTED_INFERENCE_TOKEN_FIELD_BYTES),
    }).strict(),
  }).strict()
));

export type ApplicationInferenceStatus = "completed" | "failed" | "cancelled";
export type ApplicationInferenceAdmission = {
  readonly runId: string;
  readonly inferenceToken: string;
  readonly expiresAt: string;
  finalize(status: ApplicationInferenceStatus): Promise<void>;
};
export type ApplicationInferenceAdmitter = (
  agentId: string,
) => Promise<ApplicationInferenceAdmission>;

interface HostApplicationInferenceAdmissionOptions {
  readonly getHostEnv?: (key: string) => string | undefined;
  readonly createOriginBoundFetch?: (origin: string) => typeof fetch;
}

const EMPTY_HOST_APPLICATION_INFERENCE_ADMISSION_OPTIONS = Object.freeze(
  createObject(null),
) as HostApplicationInferenceAdmissionOptions;

function readOwnFunctionOption<Key extends keyof HostApplicationInferenceAdmissionOptions>(
  options: HostApplicationInferenceAdmissionOptions,
  key: Key,
): HostApplicationInferenceAdmissionOptions[Key] | undefined {
  const descriptor = getOwnPropertyDescriptor(options, key);
  if (!descriptor) return undefined;
  if (!("value" in descriptor)) {
    throw new TypeError(`Application inference admission option ${key} must be a data property`);
  }
  if (descriptor.value === undefined) return undefined;
  if (typeof descriptor.value !== "function") {
    throw new TypeError(`Application inference admission option ${key} must be a function`);
  }
  return descriptor.value as HostApplicationInferenceAdmissionOptions[Key];
}

/** Captures host authority before authored route modules execute. */
export function createHostApplicationInferenceAdmission(
  request: Request,
  context: HandlerContext,
  options: HostApplicationInferenceAdmissionOptions =
    EMPTY_HOST_APPLICATION_INFERENCE_ADMISSION_OPTIONS,
): ApplicationInferenceAdmitter | undefined {
  if (
    context.isLocalProject === true || !context.projectId || !context.projectSlug ||
    !context.releaseId || !context.environmentName ||
    (context.resolvedEnvironment ?? context.requestContext?.mode) !== "production"
  ) return undefined;

  const readHostEnv = readOwnFunctionOption(options, "getHostEnv") ?? getHostEnv;
  const username = readHostEnv("VERYFRONT_API_INTERNAL_USER");
  const password = readHostEnv("VERYFRONT_API_INTERNAL_PASS");
  if (!username || !password) {
    return () => Promise.reject(new Error("Application inference admission is unavailable"));
  }
  const credentials = `${username}:${password}`;
  const authorization = `Basic ${encodeBasic(credentials)}`;
  const origin = getHostApiOriginExcludingEnvFile("VERYFRONT_API_INTERNAL_URL") ??
    resolveVeryfrontInferenceApiBaseUrlFromHostEnv();
  const transport = (
    readOwnFunctionOption(options, "createOriginBoundFetch") ??
      createHostInternalOriginBoundOutboundFetch
  )(origin);
  const source = {
    projectId: context.projectId,
    projectSlug: context.projectSlug,
    environmentName: context.environmentName,
    releaseId: context.releaseId,
    routePath: new NativeURL(request.url).pathname,
    requestId: randomUUID(),
  };
  const signal = request.signal;
  const headers = Object.freeze({ authorization, "content-type": "application/json" });
  return async (agentId) => {
    const keyPair = hostApplicationInferenceEncryptionKeyPair;
    const response = await transport(`${origin}/internal/application-agui-inference/admissions`, {
      method: "POST",
      headers,
      body: encodePayload({ ...source, agentId, inferencePublicKey: keyPair.publicKey }),
      redirect: "error",
      signal,
    });
    if (!apply(okGetter, response, [])) {
      await discard(response);
      throw new Error("Application inference admission failed");
    }
    const stream = responseBody(response);
    const body = await readResponseTextPrefix(
      { body: stream ? { getReader: () => getPrivateStreamReader(stream) } : null },
      40_000,
      signal,
      { fatalUtf8: true },
    );
    if (body.truncated) {
      throw new Error("Application inference admission response exceeded its limit");
    }
    const admitted = admissionSchema.parse(parseJson(body.text));
    const inferenceToken = decryptApplicationInferenceToken({
      privateKey: keyPair.privateKey,
      runId: admitted.runId,
      expiresAt: admitted.expiresAt,
      encryptedInferenceToken: admitted.encryptedInferenceToken as EncryptedInferenceToken,
    });
    const admission: ApplicationInferenceAdmission = {
      runId: admitted.runId,
      inferenceToken,
      expiresAt: admitted.expiresAt,
      async finalize(status) {
        const finalized = await transport(
          `${origin}/internal/application-agui-inference/runs/${admitted.runId}/finalize`,
          {
            method: "POST",
            headers,
            body: encodePayload({ status, inferenceToken }),
            redirect: "error",
            signal: timeout(5_000),
          },
        );
        await discard(finalized);
        if (!apply(okGetter, finalized, [])) {
          throw new Error("Application inference finalization failed");
        }
      },
    };
    // Native async resolution must not consult a tenant-installed inherited then getter.
    defineProperty(admission, "then", { value: undefined });
    return admission;
  };
}
