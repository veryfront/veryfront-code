import type { Handler, HandlerContext, RouteRegistryConfig } from "./types.ts";
import { serverLogger } from "#veryfront/utils";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { errorToRFC9457Response, getErrorMessage } from "#veryfront/errors";
import {
  isWebSocketUpgradeResponse,
  type WebSocketUpgradeResponse,
} from "#veryfront/platform/adapters/base.ts";

const logger = serverLogger.component("route-registry");

type SpanAttributes = Record<string, string | number | boolean>;

interface RegisteredHandler {
  readonly handler: Handler;
  readonly name: string;
  readonly priority: number;
}

type RuntimeHandlerResponse = Response | WebSocketUpgradeResponse;

interface RegisteredHandlerResult {
  readonly response?: RuntimeHandlerResponse;
  readonly continueChain?: boolean;
}

// These captured intrinsics contain response-owned and subclass state shadows.
// Integrity of the shared realm's primordials is an isolation-layer invariant;
// a mutated Response.prototype would affect every response, including errors.
const responsePrototype = Response.prototype;
const responseStatusGetter = Object.getOwnPropertyDescriptor(responsePrototype, "status")?.get;
const responseTypeGetter = Object.getOwnPropertyDescriptor(responsePrototype, "type")?.get;
const responseStatusTextGetter = Object.getOwnPropertyDescriptor(
  responsePrototype,
  "statusText",
)?.get;
const responseHeadersGetter = Object.getOwnPropertyDescriptor(responsePrototype, "headers")?.get;
const responseBodyGetter = Object.getOwnPropertyDescriptor(responsePrototype, "body")?.get;
const responseBodyUsedGetter = Object.getOwnPropertyDescriptor(
  responsePrototype,
  "bodyUsed",
)?.get;

interface NativeResponseState {
  readonly type: string;
  readonly status: number;
  readonly statusText: string;
  readonly headers: Headers;
  readonly body: Response["body"];
  readonly bodyUsed: boolean;
}

interface CrossContextResponseSnapshot {
  readonly type: string;
  readonly status: number;
  readonly statusText: string;
  readonly headers: Headers;
  readonly body: BodyInit | null;
  readonly bodyUsed: boolean;
}

interface ResponsePrototypeAccessors {
  readonly type: () => unknown;
  readonly status: () => unknown;
  readonly statusText: () => unknown;
  readonly headers: () => unknown;
  readonly body: () => unknown;
  readonly bodyUsed: () => unknown;
}

const objectToString = Object.prototype.toString;
// A Proxy can synthesize an unbounded sequence of distinct prototypes.
const MAX_FOREIGN_RESPONSE_PROTOTYPE_DEPTH = 16;
const RESPONSE_STATE_PROPERTIES = [
  "type",
  "url",
  "redirected",
  "status",
  "ok",
  "statusText",
  "headers",
  "body",
  "bodyUsed",
] as const;

function getNativeResponseState(value: object): NativeResponseState | null {
  if (
    !responseTypeGetter ||
    !responseStatusGetter ||
    !responseStatusTextGetter ||
    !responseHeadersGetter ||
    !responseBodyGetter ||
    !responseBodyUsedGetter
  ) {
    return null;
  }

  try {
    const type = Reflect.apply(responseTypeGetter, value, []);
    const status = Reflect.apply(responseStatusGetter, value, []);
    const statusText = Reflect.apply(responseStatusTextGetter, value, []);
    const headers = Reflect.apply(responseHeadersGetter, value, []);
    const body = Reflect.apply(responseBodyGetter, value, []) as Response["body"];
    const bodyUsed = Reflect.apply(responseBodyUsedGetter, value, []);
    if (
      typeof type !== "string" ||
      typeof status !== "number" ||
      typeof statusText !== "string" ||
      !(headers instanceof Headers) ||
      typeof bodyUsed !== "boolean"
    ) {
      return null;
    }
    return { type, status, statusText, headers, body, bodyUsed };
  } catch {
    return null;
  }
}

function hasResponseStateShadow(value: object): boolean {
  const visited = new Set<object>();
  let current: object | null = value;

  try {
    for (
      let depth = 0;
      current !== null && depth < MAX_FOREIGN_RESPONSE_PROTOTYPE_DEPTH;
      depth++
    ) {
      if (current === responsePrototype) return false;
      if (visited.has(current)) return true;
      visited.add(current);
      const layer = current;
      if (
        RESPONSE_STATE_PROPERTIES.some((property) =>
          Reflect.getOwnPropertyDescriptor(layer, property) !== undefined
        )
      ) {
        return true;
      }
      current = Reflect.getPrototypeOf(current);
    }
  } catch {
    return true;
  }

  // A branded value whose visible chain does not reach the captured canonical
  // prototype cannot safely escape with its observable state intact.
  return true;
}

function assertResponseBodyIsReadable(bodyUsed: boolean, body: unknown): void {
  if (bodyUsed) {
    throw new TypeError("Handler response body must not already be consumed");
  }
  if (body === null || typeof body !== "object") return;

  let locked: unknown;
  try {
    locked = Reflect.get(body, "locked");
  } catch (cause) {
    throw new TypeError("Handler response body state must be readable", { cause });
  }
  if (locked === true) {
    throw new TypeError("Handler response body must not already be locked");
  }
}

function getForeignPrototypeChain(value: object): object[] | null {
  let prototype = Reflect.getPrototypeOf(value);
  const prototypes: object[] = [];
  const visited = new Set<object>();

  while (prototype !== null) {
    if (
      prototype === responsePrototype ||
      visited.has(prototype) ||
      visited.size >= MAX_FOREIGN_RESPONSE_PROTOTYPE_DEPTH
    ) {
      return null;
    }
    visited.add(prototype);
    prototypes.push(prototype);
    prototype = Reflect.getPrototypeOf(prototype);
  }

  return prototypes;
}

function findPrototypeGetter(
  prototypes: readonly object[],
  property: keyof ResponsePrototypeAccessors,
): (() => unknown) | null {
  for (const prototype of prototypes) {
    const getter = Reflect.getOwnPropertyDescriptor(prototype, property)?.get;
    if (getter) return getter;
  }
  return null;
}

/**
 * Locate a bounded, Response-like state surface from another implementation.
 *
 * This is defensive shape and behavior validation, not proof of provenance:
 * JavaScript cannot establish that an arbitrary constructor is an authentic
 * platform built-in. The checks reject trivial structural lookalikes, and the
 * snapshot is always normalized into the current runtime's Response type.
 */
function getForeignResponseAccessors(value: object): ResponsePrototypeAccessors | null {
  const prototypes = getForeignPrototypeChain(value);
  if (
    !prototypes?.[0] ||
    Reflect.apply(objectToString, value, []) !== "[object Response]"
  ) {
    return null;
  }

  const type = findPrototypeGetter(prototypes, "type");
  const status = findPrototypeGetter(prototypes, "status");
  const statusText = findPrototypeGetter(prototypes, "statusText");
  const headers = findPrototypeGetter(prototypes, "headers");
  const body = findPrototypeGetter(prototypes, "body");
  const bodyUsed = findPrototypeGetter(prototypes, "bodyUsed");
  if (!type || !status || !statusText || !headers || !body || !bodyUsed) return null;

  const accessors = { type, status, statusText, headers, body, bodyUsed };
  const statelessReceiver = Object.create(prototypes[0]);

  for (const getter of Object.values(accessors)) {
    try {
      Reflect.apply(getter, statelessReceiver, []);
      return null;
    } catch {
      // Require each state accessor to reject a receiver that lacks the
      // implementation's expected Response-like state.
    }
  }

  return accessors;
}

function snapshotCrossContextResponse(value: object): CrossContextResponseSnapshot | null {
  let accessors: ResponsePrototypeAccessors | null;
  try {
    accessors = getForeignResponseAccessors(value);
  } catch {
    return null;
  }
  if (!accessors) return null;

  let type: unknown;
  let status: unknown;
  let statusText: unknown;
  let headers: unknown;
  let body: unknown;
  let bodyUsed: unknown;
  try {
    type = Reflect.apply(accessors.type, value, []);
    status = Reflect.apply(accessors.status, value, []);
    statusText = Reflect.apply(accessors.statusText, value, []);
    headers = Reflect.apply(accessors.headers, value, []);
    body = Reflect.apply(accessors.body, value, []);
    bodyUsed = Reflect.apply(accessors.bodyUsed, value, []);
  } catch {
    return null;
  }

  if (
    typeof type !== "string" ||
    typeof status !== "number" ||
    typeof statusText !== "string" ||
    typeof headers !== "object" ||
    headers === null ||
    (body !== null && typeof body !== "object") ||
    typeof bodyUsed !== "boolean"
  ) {
    return null;
  }

  let normalizedHeaders: Headers;
  try {
    normalizedHeaders = new Headers(headers as HeadersInit);
  } catch {
    return null;
  }

  return {
    type,
    status,
    statusText,
    headers: normalizedHeaders,
    body: body as BodyInit | null,
    bodyUsed,
  };
}

function normalizeCrossContextResponse(
  response: CrossContextResponseSnapshot,
): Response {
  if (response.status === 0) {
    assertCanonicalErrorResponse(response);

    // Response's constructor cannot express status 0. Preserve the only
    // faithfully normalizable status-0 state through the current runtime.
    return Response.error();
  }

  if (
    response.type !== "basic" &&
    response.type !== "cors" &&
    response.type !== "default"
  ) {
    throw new TypeError("Handler response type cannot be normalized safely");
  }

  assertResponseBodyIsReadable(response.bodyUsed, response.body);

  try {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch (cause) {
    throw new TypeError("Cross-context handler response could not be normalized", { cause });
  }
}

function assertCanonicalErrorResponse(
  response: CrossContextResponseSnapshot,
): void {
  const firstHeader = response.headers.keys().next();
  if (
    response.type !== "error" ||
    response.statusText !== "" ||
    firstHeader.done !== true ||
    response.body !== null ||
    response.bodyUsed
  ) {
    throw new TypeError("Status-0 handler response must be a canonical error response");
  }
}

function normalizeHandlerResponse(value: unknown): RuntimeHandlerResponse {
  if (isWebSocketUpgradeResponse(value)) return value;
  if (typeof value !== "object" || value === null) {
    throw new TypeError("Handler response must be a Response or WebSocket upgrade response");
  }

  const nativeState = getNativeResponseState(value);
  if (nativeState) {
    const hasStateShadow = hasResponseStateShadow(value);
    if (nativeState.status === 0) {
      assertCanonicalErrorResponse(nativeState);
      return hasStateShadow ? Response.error() : value as Response;
    }
    if (hasStateShadow) {
      return normalizeCrossContextResponse(nativeState);
    }
    assertResponseBodyIsReadable(nativeState.bodyUsed, nativeState.body);
    return value as Response;
  }

  const crossContext = snapshotCrossContextResponse(value);
  if (!crossContext) {
    throw new TypeError("Handler response must be a Response or WebSocket upgrade response");
  }
  return normalizeCrossContextResponse(crossContext);
}

function snapshotHandlerResult(value: unknown): RegisteredHandlerResult {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("Handler result must be a non-null object");
  }

  const response = Reflect.get(value, "response");
  if (response !== undefined) {
    return { response: normalizeHandlerResponse(response) };
  }

  const continueChain = Reflect.get(value, "continue");
  if (continueChain !== undefined && typeof continueChain !== "boolean") {
    throw new TypeError("Handler continue flag must be a boolean");
  }

  return {
    continueChain: continueChain as boolean | undefined,
  };
}

export function buildRouteRegistrySpanAttributes(
  req: Request,
  url: URL,
  ctx: HandlerContext,
): SpanAttributes {
  const attributes: SpanAttributes = {
    "http.method": req.method,
    "http.path": url.pathname,
  };

  const projectSlug = ctx.projectSlug ?? ctx.enriched?.projectSlug;
  if (projectSlug) {
    attributes["veryfront.project_slug"] = projectSlug;
    attributes["project.slug"] = projectSlug;
    attributes["veryfront.environment"] = ctx.resolvedEnvironment ?? ctx.requestContext?.mode ??
      "unknown";
  }

  const projectId = ctx.projectId;
  if (projectId) {
    attributes["veryfront.project_id"] = projectId;
    attributes["project.id"] = projectId;
  }

  if ((projectSlug || projectId) && ctx.environmentName) {
    attributes["veryfront.environment_name"] = ctx.environmentName;
  }

  return attributes;
}

export class RouteRegistry {
  private handlers: RegisteredHandler[] = [];
  private config: RouteRegistryConfig;
  private mutationInProgress = false;

  constructor(config: RouteRegistryConfig = {}) {
    this.config = {
      debug: false,
      enableMetrics: true,
      ...config,
    };
  }

  register(handler: Handler): this {
    return this.withMutationGuard(() => {
      const plan = this.prepareRegistrations([this.validateHandler(handler)]);
      const registration = plan.added[0];
      if (!registration) {
        throw new TypeError("Registration plan did not include the incoming handler");
      }
      this.handlers = plan.handlers;

      if (this.config.debug) {
        serverLogger.debug(
          `[RouteRegistry] Registered handler: ${registration.name} (priority: ${registration.priority})`,
        );
      }
    });
  }

  registerAll(handlers: readonly Handler[]): this {
    return this.withMutationGuard(() => {
      const handlerCount = handlers.length;
      if (!Number.isSafeInteger(handlerCount) || handlerCount < 0) {
        throw new TypeError("Handler batch length must be a non-negative safe integer");
      }
      if (handlerCount === 0) return;

      const registrations: RegisteredHandler[] = [];
      for (let index = 0; index < handlerCount; index++) {
        registrations.push(this.validateHandler(handlers[index]));
      }
      const plan = this.prepareRegistrations(registrations);
      this.handlers = plan.handlers;

      if (this.config.debug) {
        for (const registration of plan.added) {
          serverLogger.debug(
            `[RouteRegistry] Registered handler: ${registration.name} (priority: ${registration.priority})`,
          );
        }
      }
    });
  }

  execute(req: Request, ctx: HandlerContext): Promise<Response | null> {
    const url = new URL(req.url);

    return withSpan(
      "routing.registry.execute",
      async () => {
        const startTime = Date.now();

        if (this.config.debug) {
          logger.debug(`Processing ${req.method} ${url.pathname}`);
        }

        for (const registration of this.handlers) {
          const { handler } = registration;
          let name = registration.name;
          try {
            const metadata = Reflect.get(handler, "metadata");
            if (typeof metadata !== "object" || metadata === null) {
              throw new TypeError("Handler metadata must be a non-null object");
            }
            const currentName = Reflect.get(metadata, "name");
            if (typeof currentName === "string" && currentName.trim().length > 0) {
              name = currentName;
            }
            const enabled = Reflect.get(metadata, "enabled");
            if (enabled !== undefined && typeof enabled !== "function") {
              throw new TypeError("Handler enabled predicate must be a function");
            }

            if (enabled && !Reflect.apply(enabled, metadata, [ctx])) {
              if (this.config.debug) {
                serverLogger.debug(
                  `[RouteRegistry] Skipping disabled handler: ${name}`,
                );
              }
              continue;
            }

            const handlerStart = Date.now();
            // Note: Individual handler spans removed to reduce trace noise.
            // Most handlers are very fast (< 1ms) and just check if they should handle.
            // The outer routing.registry.execute span captures total routing time.
            const handle = Reflect.get(handler, "handle");
            if (typeof handle !== "function") {
              throw new TypeError("Handler handle must be a function");
            }
            const result = snapshotHandlerResult(
              await Reflect.apply(handle, handler, [req, ctx]),
            );
            const handlerTime = Date.now() - handlerStart;

            if (this.config.debug && this.config.enableMetrics) {
              serverLogger.debug(
                `[RouteRegistry] Handler ${name} took ${handlerTime}ms`,
              );
            }

            if (result.response !== undefined) {
              if (this.config.debug) {
                serverLogger.debug(
                  `[RouteRegistry] Response from ${name} (total: ${Date.now() - startTime}ms)`,
                );
              }
              // HandlerResult remains HTTP-only publicly. The minimal WebSocket
              // upgrade signal is intercepted by runtime dispatch before any
              // normal Response APIs are used.
              return result.response as Response;
            }

            if (!result.continueChain) {
              if (this.config.debug) {
                serverLogger.debug(
                  `[RouteRegistry] Chain stopped by ${name} without response`,
                );
              }
              break;
            }
          } catch (error) {
            // Always log handler errors - they should never be silently swallowed
            serverLogger.error(
              `[RouteRegistry] Handler ${name} threw an error`,
              {
                handler: name,
                path: url.pathname,
                method: req.method,
                error: getErrorMessage(error),
              },
              error,
            );
            // Convert handler error to RFC 9457 response and return immediately
            return errorToRFC9457Response(error, ctx, req);
          }
        }

        if (this.config.debug) {
          serverLogger.debug(
            `[RouteRegistry] No handler matched (total: ${Date.now() - startTime}ms)`,
          );
        }

        return null;
      },
      buildRouteRegistrySpanAttributes(req, url, ctx),
    );
  }

  getHandlers(): ReadonlyArray<Handler> {
    return Object.freeze(this.handlers.map(({ handler }) => handler));
  }

  clear(): this {
    return this.withMutationGuard(() => {
      this.handlers = [];
    });
  }

  remove(name: string): this {
    return this.withMutationGuard(() => {
      this.handlers = this.handlers.filter(
        (registration) => this.getLiveHandlerName(registration) !== name,
      );
    });
  }

  has(name: string): boolean {
    return this.handlers.some(
      (registration) => this.getLiveHandlerName(registration) === name,
    );
  }

  getStats(): {
    totalHandlers: number;
    handlersByPriority: Record<string, number>;
    handlerNames: string[];
  } {
    const handlers = this.handlers;
    const handlersByPriority: Record<string, number> = {};
    const handlerNames = handlers.map((registration) => this.getLiveHandlerName(registration));

    for (const { priority } of handlers) {
      // Metrics must describe the same coherent priority snapshot that
      // determines execute() order. Live changes are refreshed atomically by
      // the next successful register/registerAll call.
      const priorityKey = String(priority);
      handlersByPriority[priorityKey] = (handlersByPriority[priorityKey] ?? 0) + 1;
    }

    return {
      totalHandlers: handlers.length,
      handlersByPriority,
      handlerNames,
    };
  }

  private validateHandler(handler: unknown): RegisteredHandler {
    if (
      (typeof handler !== "object" && typeof handler !== "function") ||
      handler === null
    ) {
      throw new TypeError("Handler must be a non-null object");
    }

    const metadata = Reflect.get(handler, "metadata");

    if (typeof metadata !== "object" || metadata === null) {
      throw new TypeError("Handler metadata must be a non-null object");
    }

    const name = Reflect.get(metadata, "name");
    const priority = Reflect.get(metadata, "priority");
    const enabled = Reflect.get(metadata, "enabled");
    const handle = Reflect.get(handler, "handle");

    if (typeof name !== "string" || name.trim().length === 0) {
      throw new TypeError("Handler name must be a non-empty string");
    }
    if (typeof priority !== "number" || !Number.isFinite(priority)) {
      throw new TypeError("Handler priority must be a finite number");
    }
    if (typeof handle !== "function") {
      throw new TypeError("Handler handle must be a function");
    }
    if (enabled !== undefined && typeof enabled !== "function") {
      throw new TypeError("Handler enabled predicate must be a function");
    }

    return {
      handler: handler as Handler,
      name,
      priority,
    };
  }

  private prepareRegistrations(
    addedHandlers: readonly RegisteredHandler[],
  ): {
    readonly handlers: RegisteredHandler[];
    readonly added: RegisteredHandler[];
  } {
    const existingCount = this.handlers.length;
    const candidates = [
      ...this.handlers,
      ...addedHandlers,
    ];

    // Two complete, bounded passes detect priority getters that mutate another
    // candidate after it was read. The registry is assigned only after every
    // existing and incoming priority validates to the same coherent snapshot.
    const firstSnapshot = candidates.map((registration) =>
      this.refreshRegistrationPriority(registration)
    );
    const stableSnapshot = candidates.map((registration) =>
      this.refreshRegistrationPriority(registration)
    );

    for (const [index, firstRegistration] of firstSnapshot.entries()) {
      const stableRegistration = stableSnapshot[index];
      if (
        !stableRegistration ||
        !Object.is(firstRegistration.priority, stableRegistration.priority)
      ) {
        throw new TypeError("Handler priority must remain stable during registration");
      }
    }

    const added = stableSnapshot.slice(existingCount);
    const handlers = [...stableSnapshot].sort(
      (left, right) => left.priority - right.priority,
    );
    return { handlers, added };
  }

  private refreshRegistrationPriority(
    registration: RegisteredHandler,
  ): RegisteredHandler {
    const metadata = Reflect.get(registration.handler, "metadata");
    if (typeof metadata !== "object" || metadata === null) {
      throw new TypeError("Handler metadata must be a non-null object");
    }
    const priority = Reflect.get(metadata, "priority");
    if (typeof priority !== "number" || !Number.isFinite(priority)) {
      throw new TypeError("Handler priority must be a finite number");
    }
    return { ...registration, priority };
  }

  private withMutationGuard(operation: () => void): this {
    if (this.mutationInProgress) {
      throw new TypeError("RouteRegistry mutation must not be reentrant");
    }
    this.mutationInProgress = true;
    try {
      operation();
      return this;
    } finally {
      this.mutationInProgress = false;
    }
  }

  private getLiveHandlerName(registration: RegisteredHandler): string {
    try {
      const metadata = Reflect.get(registration.handler, "metadata");
      if (typeof metadata !== "object" || metadata === null) return registration.name;
      const name = Reflect.get(metadata, "name");
      return typeof name === "string" && name.trim().length > 0 ? name : registration.name;
    } catch {
      return registration.name;
    }
  }
}
