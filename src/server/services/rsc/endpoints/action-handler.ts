/**
 * Fail-closed Server Action request and extension authorization boundary.
 * @module rsc-endpoints/action-handler
 */

import { HttpStatus } from "#veryfront/http/responses";
import { serverLogger } from "#veryfront/utils";
import { parseActionBody } from "./action-parser.ts";
import type { ActionRequestParams } from "./types.ts";
import {
  isRequestBodyTooLargeError,
  readBodyWithLimit,
} from "#veryfront/security/input-validation/limits.ts";
import {
  DEFAULT_MAX_BODY_SIZE_BYTES,
  HTTP_PAYLOAD_TOO_LARGE,
} from "#veryfront/utils/constants/index.ts";
import { isWithinDirectory, joinPath, normalizePath } from "#veryfront/utils/path-utils.ts";
import { loadModuleFromSource } from "#veryfront/modules/react-loader/index.ts";
import {
  createDependencyPinningSource,
  type DependencyPinningSnapshot,
  type DependencyPinningSourceInput,
  resolveProjectReactVersion,
  resolveRequestedDependencyPinningSnapshot,
} from "#veryfront/transforms/esm/package-registry.ts";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { RSC_DEPENDENCY_PINNING_HEADER } from "#veryfront/rendering/rsc/constants.ts";
import {
  RSC_ACTION_AUTHORIZATION_TERMINATION_GRACE_MS,
  RSC_ACTION_AUTHORIZATION_TIMEOUT_MS,
  type RscActionAuthorizationArray,
  type RscActionAuthorizationContext,
  type RscActionAuthorizationHeaders,
  type RscActionAuthorizationProvider,
  RscActionAuthorizationProviderName,
  type RscActionAuthorizationRequest,
  snapshotRscActionAuthorizationProvider,
} from "#veryfront/extensions/auth/index.ts";
import {
  acquireContractLease,
  type ContractReference,
  trySnapshotGenerationOwnedContractForUse,
} from "#veryfront/extensions/contract-registry-internal.ts";
import {
  createIntrinsicPromise,
  createIntrinsicPromiseContinuation,
} from "#veryfront/extensions/promise-intrinsics-internal.ts";
import {
  isNativePromiseWithoutHooks,
  isProxyWithoutHooks,
} from "#veryfront/platform/compat/error-introspection.ts";
import {
  snapshotRscActionAuthorizationArgs,
  snapshotRscActionInvocationArgs,
} from "./action-authorization-snapshot.ts";
import { isInfrastructureOnlyRequestHeader } from "#veryfront/security/http/application-request.ts";

const logger = serverLogger.component("rsc");
const apply = Reflect.apply;
const createObject = Object.create;
const defineProperty = Object.defineProperty;
const freeze = Object.freeze;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const jsonStringify = JSON.stringify;
const numberIsSafeInteger = Number.isSafeInteger;
const NativeAbortController = AbortController;
const NativeAbortSignal = AbortSignal;
const NativeError = Error;
const NativeEventTarget = EventTarget;
const NativeHeaders = Headers;
const NativeRequest = Request;
const NativeResponse = Response;
const NativeTypeError = TypeError;
const NativeURL = URL;
const abortControllerAbort = NativeAbortController.prototype.abort;
const abortControllerSignalGetter = getOwnPropertyDescriptor(
  NativeAbortController.prototype,
  "signal",
)?.get;
const abortSignalAbortedGetter = getOwnPropertyDescriptor(
  NativeAbortSignal.prototype,
  "aborted",
)?.get;
const clearScheduledTimeout = clearTimeout;
const eventTargetAddEventListener = NativeEventTarget.prototype.addEventListener;
const eventTargetRemoveEventListener = NativeEventTarget.prototype.removeEventListener;
const headersForEach = NativeHeaders.prototype.forEach;
const headersGet = NativeHeaders.prototype.get;
const headersSet = NativeHeaders.prototype.set;
const scheduleTimeout = setTimeout;
const stringSplit = String.prototype.split;
const stringToLowerCase = String.prototype.toLowerCase;
const stringTrim = String.prototype.trim;
const ACTION_FILE_EXTENSIONS = freeze(["ts", "tsx", "js", "jsx"] as const);

if (
  typeof abortControllerSignalGetter !== "function" ||
  typeof abortSignalAbortedGetter !== "function"
) {
  throw new NativeTypeError("AbortController lifecycle getters are unavailable");
}

function captureRequestGetter(
  key: "headers" | "method" | "signal" | "url",
): () => unknown {
  const getter = getOwnPropertyDescriptor(NativeRequest.prototype, key)?.get;
  if (typeof getter !== "function") {
    throw new NativeTypeError(`Request.prototype.${key} getter is unavailable`);
  }
  return getter;
}

function captureResponseGetter(key: "headers"): () => unknown {
  const getter = getOwnPropertyDescriptor(NativeResponse.prototype, key)?.get;
  if (typeof getter !== "function") {
    throw new NativeTypeError(`Response.prototype.${key} getter is unavailable`);
  }
  return getter;
}

const requestHeadersGetter = captureRequestGetter("headers");
const requestMethodGetter = captureRequestGetter("method");
const requestSignalGetter = captureRequestGetter("signal");
const requestUrlGetter = captureRequestGetter("url");
const responseHeadersGetter = captureResponseGetter("headers");

function getResponseHeaders(response: Response): Headers {
  return apply(responseHeadersGetter, response, []) as Headers;
}

function defineImmutableData(
  target: object,
  key: PropertyKey,
  value: unknown,
): void {
  const descriptor = createObject(null) as PropertyDescriptor;
  descriptor.configurable = false;
  descriptor.enumerable = true;
  descriptor.value = value;
  descriptor.writable = false;
  apply(defineProperty, Object, [target, key, descriptor]);
}

function createResponseInit(status: number, headers: Headers): ResponseInit {
  const init = createObject(null) as ResponseInit;
  init.headers = headers;
  init.status = status;
  return init;
}

function createActionJsonErrorResponse(status: number, error: string): Response {
  const body = createObject(null) as { ok: false; error: string };
  defineImmutableData(body, "ok", false);
  defineImmutableData(body, "error", error);
  const headers = new NativeHeaders();
  apply(headersSet, headers, ["content-type", "application/json; charset=utf-8"]);
  return new NativeResponse(
    jsonStringify(body),
    createResponseInit(status, headers),
  );
}

interface ActionAuthorizationBinding {
  readonly provider: Readonly<RscActionAuthorizationProvider>;
  readonly contractReference?: Readonly<ContractReference<unknown>>;
}

type ActionAuthorizationSettlement =
  | { readonly fulfilled: true; readonly value: unknown }
  | { readonly fulfilled: false; readonly reason: unknown };

type ActionAuthorizationRace =
  | { readonly kind: "settled"; readonly settlement: ActionAuthorizationSettlement }
  | { readonly kind: "grace-expired" };

export interface ActionAuthorizationTiming {
  readonly timeoutMs: number;
  readonly terminationGraceMs: number;
}

const defaultActionAuthorizationTiming = freeze({
  timeoutMs: RSC_ACTION_AUTHORIZATION_TIMEOUT_MS,
  terminationGraceMs: RSC_ACTION_AUTHORIZATION_TERMINATION_GRACE_MS,
});

interface MutableActionAuthorizationContext {
  id: string;
  args: Readonly<RscActionAuthorizationArray>;
  projectId: string | undefined;
  projectSlug: string | undefined;
  contentSourceId: string | undefined;
  releaseId: string | undefined;
  branch: string | null | undefined;
  isLocalProject: boolean | undefined;
  mode: "development" | "production" | undefined;
}

interface ActionAuthorizationContextInput {
  readonly id: string;
  readonly args: readonly unknown[];
  readonly projectId?: string;
  readonly projectSlug?: string;
  readonly contentSourceId?: string;
  readonly releaseId?: string;
  readonly branch?: string | null;
  readonly isLocalProject?: boolean;
  readonly mode?: "development" | "production";
}

interface MutableActionAuthorizationRequest {
  url: string;
  method: string;
  headers: Readonly<RscActionAuthorizationHeaders>;
  signal: AbortSignal;
}

export type ActionModuleLoader = typeof loadModuleFromSource;

type ActionAuthorizationResolver = () => ActionAuthorizationBinding | undefined;

/** Handle an action request after extension-owned authorization. */
export async function handleActionRequest(
  params: ActionRequestParams,
): Promise<Response> {
  return withDependencyPinningVary(
    await handleActionRequestInner(
      params,
      resolveRegisteredActionAuthorization,
      loadModuleFromSource,
    ),
  );
}

/** @internal Provider seam for deterministic request-boundary tests. */
export async function handleActionRequestWithAuthorizationProvider(
  params: ActionRequestParams,
  provider: unknown,
  actionModuleLoader: ActionModuleLoader = loadModuleFromSource,
  authorizationTiming: Readonly<ActionAuthorizationTiming> = defaultActionAuthorizationTiming,
): Promise<Response> {
  return withDependencyPinningVary(
    await handleActionRequestInner(
      params,
      () =>
        provider === undefined
          ? undefined
          : { provider: snapshotRscActionAuthorizationProvider(provider) },
      actionModuleLoader,
      authorizationTiming,
    ),
  );
}

/** @internal Registered-provider seam for deterministic lifecycle timing tests. */
export async function handleActionRequestWithRegisteredAuthorizationForTesting(
  params: ActionRequestParams,
  authorizationTiming: Readonly<ActionAuthorizationTiming>,
  actionModuleLoader: ActionModuleLoader = loadModuleFromSource,
): Promise<Response> {
  return withDependencyPinningVary(
    await handleActionRequestInner(
      params,
      resolveRegisteredActionAuthorization,
      actionModuleLoader,
      authorizationTiming,
    ),
  );
}

async function handleActionRequestInner(
  {
    req,
    projectDir,
    projectId,
    projectSlug,
    contentSourceId,
    releaseId,
    branch,
    isLocalProject,
    dependencyPinningSource,
    adapter,
    config,
    mode,
  }: ActionRequestParams,
  resolveAuthorization: ActionAuthorizationResolver,
  actionModuleLoader: ActionModuleLoader = loadModuleFromSource,
  authorizationTiming: Readonly<ActionAuthorizationTiming> = defaultActionAuthorizationTiming,
): Promise<Response> {
  const dependencySource = dependencyPinningSource ??
    createDependencyPinningSource({
      projectDir,
      adapter,
      isLocalProject,
      projectId,
      projectSlug,
      contentSourceId,
      releaseId,
      branch,
      config,
    });
  const dependencySnapshot = await resolveActionDependencySnapshot(
    apply(
      headersGet,
      apply(requestHeadersGetter, req, []) as Headers,
      [RSC_DEPENDENCY_PINNING_HEADER],
    ) as string | null,
    dependencySource,
  );
  if (dependencySnapshot instanceof Response) return dependencySnapshot;

  let body: unknown;
  try {
    body = JSON.parse(await readBodyWithLimit(req, DEFAULT_MAX_BODY_SIZE_BYTES));
  } catch (error) {
    if (isRequestBodyTooLargeError(error)) {
      return createActionJsonErrorResponse(HTTP_PAYLOAD_TOO_LARGE, "Request body too large");
    }
    logger.warn("Failed to parse action request body", { error });
    return createActionJsonErrorResponse(HttpStatus.BAD_REQUEST, "Invalid JSON body");
  }

  const parseResult = await parseActionBody(body);
  if (parseResult instanceof Response) return parseResult;

  const { id, args } = parseResult;
  let actionArgs: unknown[];
  try {
    actionArgs = snapshotRscActionInvocationArgs(args);
  } catch (error) {
    logger.warn("Failed to snapshot Server Action arguments", { error });
    return createActionJsonErrorResponse(HttpStatus.BAD_REQUEST, "invalid args");
  }

  const authorization = resolveActionAuthorization(resolveAuthorization);
  if (authorization instanceof Response) return authorization;
  const authorizationResponse = await authorizeActionRequest(
    authorization,
    req,
    {
      id,
      args,
      projectId,
      projectSlug,
      contentSourceId,
      releaseId,
      branch,
      isLocalProject,
      mode,
    },
    authorizationTiming,
  );
  if (authorizationResponse) return authorizationResponse;

  const appRoot = normalizePath(joinPath(projectDir, config?.directories?.app ?? "app"));
  const actionsRoot = normalizePath(joinPath(appRoot, "actions"));
  if (!isWithinDirectory(projectDir, appRoot) || !isWithinDirectory(appRoot, actionsRoot)) {
    return createActionJsonErrorResponse(HttpStatus.BAD_REQUEST, "invalid action root");
  }

  const file = await findActionFile(actionsRoot, id, adapter);
  if (!file) {
    return createActionJsonErrorResponse(HttpStatus.NOT_FOUND, "action not found");
  }

  const source = await adapter.fs.readFile(file);
  const resolvedContentSourceId = contentSourceId ??
    releaseId ??
    (branch ? `branch:${branch}` : undefined) ??
    (mode === "development" ? "preview-main" : "production");
  const reactVersion = await resolveProjectReactVersion({
    projectDir,
    dependencyPinningSource: dependencySource,
    config,
    dependencyPinningCacheKey: dependencySnapshot.cacheKey,
    dependencyPinningDependencies: dependencySnapshot.dependencies,
  });
  const mod = await actionModuleLoader(source, file, projectDir, adapter, {
    projectId: projectId ?? projectDir,
    projectSlug,
    contentSourceId: resolvedContentSourceId,
    dev: mode === "development",
    mode: mode === "development" ? "preview" : "production",
    reactVersion,
    dependencyPinningCacheKey: dependencySnapshot.cacheKey,
    dependencyPinningDependencies: dependencySnapshot.dependencies,
    dependencyPinningSource: dependencySource,
    moduleServerOrigin: dependencySnapshot.cacheKey.startsWith("on:")
      ? new NativeURL(apply(requestUrlGetter, req, []) as string).origin
      : undefined,
  });
  const fn = mod.default ?? mod.action;

  if (typeof fn !== "function") {
    return createActionJsonErrorResponse(HttpStatus.BAD_REQUEST, "invalid action");
  }

  const result = await apply(
    fn as (...args: unknown[]) => Promise<unknown>,
    undefined,
    actionArgs,
  );
  const responseBody = createObject(null) as { ok: true; result: unknown };
  defineImmutableData(responseBody, "ok", true);
  defineImmutableData(responseBody, "result", result);
  const responseHeaders = new NativeHeaders();
  apply(headersSet, responseHeaders, ["content-type", "application/json"]);
  return new NativeResponse(
    jsonStringify(responseBody),
    createResponseInit(HttpStatus.OK, responseHeaders),
  );
}

async function resolveActionDependencySnapshot(
  requestedPinKey: string | null,
  dependencyPinningSource: DependencyPinningSourceInput,
): Promise<DependencyPinningSnapshot | Response> {
  if (requestedPinKey !== null && !requestedPinKey.startsWith("on:")) {
    return unknownDependencySnapshotResponse();
  }

  const snapshot = await resolveRequestedDependencyPinningSnapshot(
    dependencyPinningSource,
    requestedPinKey,
  );
  if (
    !snapshot ||
    (requestedPinKey === null && snapshot.cacheKey !== "off")
  ) {
    return unknownDependencySnapshotResponse();
  }
  return snapshot;
}

function withDependencyPinningVary(response: Response): Response {
  const headers = getResponseHeaders(response);
  appendVaryHeader(headers, RSC_DEPENDENCY_PINNING_HEADER);
  apply(headersSet, headers, ["cache-control", "no-store"]);
  return response;
}

function appendVaryHeader(headers: Headers, fieldName: string): void {
  const raw = (apply(headersGet, headers, ["vary"]) as string | null) ?? "";
  const values = apply(stringSplit, raw, [","]) as string[];
  const expected = apply(stringToLowerCase, fieldName, []) as string;
  let normalized = "";
  let found = false;
  for (let index = 0; index < values.length; index += 1) {
    const value = apply(stringTrim, values[index]!, []) as string;
    if (value.length === 0) continue;
    if (value === "*") return;
    if ((apply(stringToLowerCase, value, []) as string) === expected) found = true;
    normalized = normalized.length === 0 ? value : `${normalized}, ${value}`;
  }
  if (!found) normalized = normalized.length === 0 ? fieldName : `${normalized}, ${fieldName}`;
  apply(headersSet, headers, ["vary", normalized]);
}

function unknownDependencySnapshotResponse(): Response {
  const headers = new NativeHeaders();
  apply(headersSet, headers, ["cache-control", "no-store"]);
  return new NativeResponse(
    "Unknown dependency snapshot",
    createResponseInit(HttpStatus.CONFLICT, headers),
  );
}

function resolveRegisteredActionAuthorization(): ActionAuthorizationBinding | undefined {
  const registered = trySnapshotGenerationOwnedContractForUse<unknown>(
    RscActionAuthorizationProviderName,
  );
  if (registered === undefined) return undefined;
  return freeze({
    provider: snapshotRscActionAuthorizationProvider(registered.implementation),
    contractReference: registered.reference,
  });
}

function resolveActionAuthorization(
  resolver: ActionAuthorizationResolver,
): ActionAuthorizationBinding | Response {
  try {
    return resolver() ?? actionAuthorizationUnavailable();
  } catch (error) {
    logger.error("RSC action authorization provider is unavailable", { error });
    return actionAuthorizationUnavailable();
  }
}

function snapshotAuthorizationContext(
  context: ActionAuthorizationContextInput,
): Readonly<RscActionAuthorizationContext> {
  const snapshot = createObject(null) as MutableActionAuthorizationContext;
  defineImmutableData(snapshot, "id", context.id);
  defineImmutableData(
    snapshot,
    "args",
    snapshotRscActionAuthorizationArgs(context.args),
  );
  defineImmutableData(snapshot, "projectId", context.projectId);
  defineImmutableData(snapshot, "projectSlug", context.projectSlug);
  defineImmutableData(snapshot, "contentSourceId", context.contentSourceId);
  defineImmutableData(snapshot, "releaseId", context.releaseId);
  defineImmutableData(snapshot, "branch", context.branch);
  defineImmutableData(snapshot, "isLocalProject", context.isLocalProject);
  defineImmutableData(snapshot, "mode", context.mode);
  return freeze(snapshot);
}

function createAuthorizationRequest(
  request: Request,
  signal: AbortSignal,
): Readonly<RscActionAuthorizationRequest> {
  const headers = createObject(null) as Record<string, string>;
  const sourceHeaders = apply(requestHeadersGetter, request, []) as Headers;
  apply(headersForEach, sourceHeaders, [
    (value: string, name: string) => {
      if (!isInfrastructureOnlyRequestHeader(name)) {
        defineImmutableData(headers, name, value);
      }
    },
  ]);
  freeze(headers);

  const authorizationRequest = createObject(null) as MutableActionAuthorizationRequest;
  defineImmutableData(
    authorizationRequest,
    "url",
    apply(requestUrlGetter, request, []) as string,
  );
  defineImmutableData(
    authorizationRequest,
    "method",
    apply(requestMethodGetter, request, []) as string,
  );
  defineImmutableData(authorizationRequest, "headers", headers);
  defineImmutableData(authorizationRequest, "signal", signal);
  return freeze(authorizationRequest);
}

function fulfilledAuthorizationSettlement(value: unknown): ActionAuthorizationSettlement {
  const settlement = createObject(null) as {
    fulfilled: true;
    value: unknown;
  };
  defineImmutableData(settlement, "fulfilled", true);
  defineImmutableData(settlement, "value", value);
  return freeze(settlement);
}

function rejectedAuthorizationSettlement(reason: unknown): ActionAuthorizationSettlement {
  const settlement = createObject(null) as {
    fulfilled: false;
    reason: unknown;
  };
  defineImmutableData(settlement, "fulfilled", false);
  defineImmutableData(settlement, "reason", reason);
  return freeze(settlement);
}

function settledAuthorizationRace(
  settlement: ActionAuthorizationSettlement,
): ActionAuthorizationRace {
  const race = createObject(null) as {
    kind: "settled";
    settlement: ActionAuthorizationSettlement;
  };
  defineImmutableData(race, "kind", "settled");
  defineImmutableData(race, "settlement", settlement);
  return freeze(race);
}

const graceExpiredAuthorizationRace = (() => {
  const race = createObject(null) as { kind: "grace-expired" };
  defineImmutableData(race, "kind", "grace-expired");
  return freeze(race) as ActionAuthorizationRace;
})();

function observeAuthorizationPromise(
  candidate: Promise<unknown>,
): Promise<ActionAuthorizationSettlement> {
  return createIntrinsicPromiseContinuation<unknown, ActionAuthorizationSettlement>(
    candidate,
    fulfilledAuthorizationSettlement,
    rejectedAuthorizationSettlement,
  );
}

function raceAuthorizationAgainstGrace(
  settlement: Promise<ActionAuthorizationSettlement>,
  graceExpired: Promise<void>,
): Promise<ActionAuthorizationRace> {
  return createIntrinsicPromise<ActionAuthorizationRace>((resolve, reject) => {
    let raceFinished = false;
    const resolveOnce = (value: ActionAuthorizationRace): void => {
      if (raceFinished) return;
      raceFinished = true;
      resolve(value);
    };
    createIntrinsicPromiseContinuation(
      settlement,
      (value) => resolveOnce(settledAuthorizationRace(value)),
      reject,
    );
    createIntrinsicPromiseContinuation(
      graceExpired,
      () => resolveOnce(graceExpiredAuthorizationRace),
      reject,
    );
  });
}

function ignoreAuthorizationSettlement(_value: unknown): void {}

function releaseLeaseAfterAuthorizationSettlement(
  settlement: Promise<ActionAuthorizationSettlement>,
  release: () => void,
): void {
  const released = createIntrinsicPromiseContinuation(
    settlement,
    () => release(),
    () => release(),
  );
  createIntrinsicPromiseContinuation(
    released,
    ignoreAuthorizationSettlement,
    ignoreAuthorizationSettlement,
  );
}

function assertActionAuthorizationTiming(
  timing: Readonly<ActionAuthorizationTiming>,
): void {
  if (
    !numberIsSafeInteger(timing.timeoutMs) || timing.timeoutMs < 0 ||
    !numberIsSafeInteger(timing.terminationGraceMs) || timing.terminationGraceMs < 0
  ) {
    throw new NativeTypeError(
      "RSC action authorization timing must use non-negative safe integers",
    );
  }
}

function getAbortControllerSignal(controller: AbortController): AbortSignal {
  return apply(abortControllerSignalGetter!, controller, []) as AbortSignal;
}

function isSignalAborted(signal: AbortSignal): boolean {
  return apply(abortSignalAbortedGetter!, signal, []) as boolean;
}

function abortAuthorization(controller: AbortController, reason: unknown): void {
  apply(abortControllerAbort, controller, [reason]);
}

function addAbortListener(signal: AbortSignal, listener: () => void): void {
  apply(eventTargetAddEventListener, signal, ["abort", listener]);
}

function removeAbortListener(signal: AbortSignal, listener: () => void): void {
  apply(eventTargetRemoveEventListener, signal, ["abort", listener]);
}

async function authorizeActionRequest(
  binding: ActionAuthorizationBinding,
  request: Request,
  context: ActionAuthorizationContextInput,
  timing: Readonly<ActionAuthorizationTiming>,
): Promise<Response | null> {
  let lease: ReturnType<typeof acquireContractLease> | undefined;
  let releaseLease = true;
  let deadlineTimeoutId: ReturnType<typeof setTimeout> | undefined;
  let graceTimeoutId: ReturnType<typeof setTimeout> | undefined;
  let sourceAbortListener: (() => void) | undefined;
  let sourceSignal: AbortSignal | undefined;
  const authorizationController = new NativeAbortController();
  const authorizationSignal = getAbortControllerSignal(authorizationController);
  let terminationStarted = false;
  let terminationReason: unknown;
  let resolveGraceExpired!: () => void;
  const graceExpired = createIntrinsicPromise<void>((resolve) => {
    resolveGraceExpired = resolve;
  });
  const startGrace = (): void => {
    if (graceTimeoutId !== undefined) return;
    graceTimeoutId = scheduleTimeout(resolveGraceExpired, timing.terminationGraceMs);
  };
  const terminate = (reason: unknown): void => {
    if (terminationStarted) return;
    terminationStarted = true;
    terminationReason = reason;
    try {
      startGrace();
    } catch {
      resolveGraceExpired();
    }
    try {
      abortAuthorization(authorizationController, reason);
    } catch (error) {
      logger.error("RSC action authorization cancellation failed", { error });
    }
  };

  try {
    assertActionAuthorizationTiming(timing);
    if (binding.contractReference !== undefined) {
      lease = acquireContractLease(binding.contractReference);
      lease.setRetirementHandler(terminate);
    }

    sourceSignal = apply(requestSignalGetter, request, []) as AbortSignal;
    sourceAbortListener = () => terminate(new NativeError("RSC action request aborted"));
    if (isSignalAborted(sourceSignal)) {
      sourceAbortListener();
    } else {
      addAbortListener(sourceSignal, sourceAbortListener);
    }
    deadlineTimeoutId = scheduleTimeout(
      () => terminate(new NativeError("RSC action authorization timed out")),
      timing.timeoutMs,
    );
    if (terminationStarted) throw terminationReason;

    const candidate = binding.provider.authorize(
      createAuthorizationRequest(request, authorizationSignal),
      snapshotAuthorizationContext(context),
    );
    if (typeof candidate === "boolean") {
      if (terminationStarted) throw terminationReason;
      return candidate ? null : actionAuthorizationDenied();
    }
    if (!isNativePromiseWithoutHooks(candidate) || isProxyWithoutHooks(candidate)) {
      throw new NativeTypeError("RSC action authorization provider must return a boolean");
    }

    let observed: Promise<ActionAuthorizationSettlement>;
    try {
      observed = observeAuthorizationPromise(candidate);
    } catch (error) {
      terminate(error);
      if (lease !== undefined) {
        lease.quarantine();
        releaseLease = false;
      }
      throw error;
    }

    const race = await raceAuthorizationAgainstGrace(observed, graceExpired);
    if (race.kind === "grace-expired") {
      if (lease !== undefined) {
        lease.quarantine();
        releaseLease = false;
        releaseLeaseAfterAuthorizationSettlement(observed, lease.release);
      }
      throw terminationReason ?? new NativeError("RSC action authorization cancelled");
    }
    if (terminationStarted) throw terminationReason;
    if (!race.settlement.fulfilled) throw race.settlement.reason;
    if (typeof race.settlement.value !== "boolean") {
      throw new NativeTypeError("RSC action authorization provider must return a boolean");
    }
    return race.settlement.value ? null : actionAuthorizationDenied();
  } catch (error) {
    logger.error("RSC action authorization failed closed", { error });
    return actionAuthorizationUnavailable();
  } finally {
    if (deadlineTimeoutId !== undefined) clearScheduledTimeout(deadlineTimeoutId);
    if (graceTimeoutId !== undefined) clearScheduledTimeout(graceTimeoutId);
    if (sourceSignal !== undefined && sourceAbortListener !== undefined) {
      removeAbortListener(sourceSignal, sourceAbortListener);
    }
    if (releaseLease) lease?.release();
  }
}

function actionAuthorizationDenied(): Response {
  const response = createActionJsonErrorResponse(HttpStatus.FORBIDDEN, "unauthorized");
  apply(headersSet, getResponseHeaders(response), ["cache-control", "no-store"]);
  return response;
}

function actionAuthorizationUnavailable(): Response {
  const response = createActionJsonErrorResponse(
    HttpStatus.SERVICE_UNAVAILABLE,
    "action authorization unavailable",
  );
  apply(headersSet, getResponseHeaders(response), ["cache-control", "no-store"]);
  return response;
}

async function findActionFile(
  actionsRoot: string,
  id: string,
  adapter: ActionRequestParams["adapter"],
): Promise<string | null> {
  for (let index = 0; index < ACTION_FILE_EXTENSIONS.length; index += 1) {
    const extension = ACTION_FILE_EXTENSIONS[index]!;
    const candidate = normalizePath(joinPath(actionsRoot, `${id}.${extension}`));
    if (!isWithinDirectory(actionsRoot, candidate)) continue;

    try {
      const stat = await adapter.fs.stat(candidate);
      if (stat.isFile) return candidate;
    } catch (error) {
      if (isNotFoundError(error)) continue;
      throw error;
    }
  }

  return null;
}
