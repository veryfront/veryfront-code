import {
  assertEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import {
  type ApplicationErrorContext,
  captureApplicationError,
  flushApplicationErrors,
  initializeApplicationErrorReporter,
  setApplicationErrorReporter,
} from "./application-errors.ts";
import type { ApplicationErrorContext as SharedApplicationErrorContext } from "./application-error-contract.ts";
import {
  ASSET_OPTIMIZATION_ERROR,
  BUILD_FAILED,
  BUNDLE_ERROR,
  COMPILATION_ERROR,
  CONFIG_PARSE_ERROR,
  createError,
  IMPORT_RESOLUTION_ERROR,
  INITIALIZATION_ERROR,
  MARKDOWN_COMPILE_ERROR,
  MDX_COMPILE_ERROR,
  RENDER_ERROR,
  SOURCEMAP_ERROR,
  SSG_GENERATION_ERROR,
  toError,
  TYPESCRIPT_ERROR,
} from "#veryfront/errors";

it("application error reporter is optional", async () => {
  setApplicationErrorReporter(undefined);

  assertEquals(
    captureApplicationError(new Error("not reported"), { boundary: "test" }),
    undefined,
  );
  assertEquals(await flushApplicationErrors(), true);
});

it("application error reporter receives unexpected failures and correlation context", async () => {
  const captures: Array<{
    error: unknown;
    boundary: string;
    processRole?: string;
    traceId?: string;
  }> = [];
  let flushTimeout: number | undefined;
  setApplicationErrorReporter({
    capture(error, context) {
      captures.push({
        error,
        boundary: context.boundary,
        processRole: context.processRole,
        traceId: context.traceId,
      });
      return "event-id";
    },
    flush(timeoutMs) {
      flushTimeout = timeoutMs;
      return Promise.resolve(true);
    },
  });

  const error = new Error("render failed");
  assertEquals(
    captureApplicationError(error, {
      boundary: "renderer.request",
      processRole: "renderer",
      traceId: "trace-1",
    }),
    "event-id",
  );
  assertEquals(captures, [{
    error,
    boundary: "renderer.request",
    processRole: "renderer",
    traceId: "trace-1",
  }]);
  assertEquals(await flushApplicationErrors(1_500), true);
  assertEquals(flushTimeout, 1_500);
});

it("application error context exports process role from the shared contract", () => {
  const context: ApplicationErrorContext = {
    boundary: "renderer.request",
    processRole: "api",
  };
  const sharedContext: SharedApplicationErrorContext = context;

  assertEquals(sharedContext.processRole, "api");
});

it("application error reporter ignores expected cancellation", () => {
  let captured = false;
  setApplicationErrorReporter({
    capture() {
      captured = true;
      return "event-id";
    },
    flush: () => Promise.resolve(true),
  });

  const eventId = captureApplicationError(
    new DOMException("request cancelled", "AbortError"),
    { boundary: "renderer.request" },
  );

  assertEquals(eventId, undefined);
  assertEquals(captured, false);
});

it("application error reporter ignores client-class veryfront errors", () => {
  const captures: unknown[] = [];
  setApplicationErrorReporter({
    capture(error) {
      captures.push(error);
      return "event-id";
    },
    flush: () => Promise.resolve(true),
  });

  const clientError = CONFIG_PARSE_ERROR.create({
    detail: "Hosted configuration rejected (forbidden-capability: unsupported-call)",
  });
  assertEquals(
    captureApplicationError(clientError, { boundary: "renderer.request" }),
    undefined,
  );
  assertEquals(captures, []);

  const serverError = INITIALIZATION_ERROR.create({
    detail: "renderer failed to initialize",
  });
  assertEquals(
    captureApplicationError(serverError, { boundary: "renderer.request" }),
    "event-id",
  );
  const plainError = new Error("render failed");
  assertEquals(
    captureApplicationError(plainError, { boundary: "renderer.request" }),
    "event-id",
  );
  assertEquals(captures, [serverError, plainError]);
});

it("application error reporter downgrades tenant build errors to tagged warnings", () => {
  const captures: Array<{ error: unknown; context: SharedApplicationErrorContext }> = [];
  setApplicationErrorReporter({
    capture(error, context) {
      captures.push({ error, context });
      return "event-id";
    },
    flush: () => Promise.resolve(true),
  });

  const compileError = TYPESCRIPT_ERROR.create({
    detail: "TypeScript compilation failed in /pages/index.tsx",
  });
  const legacyBuildError = toError(
    createError({ type: "build", message: "Module transform cache write failed" }),
  );
  const pipelineError = RENDER_ERROR.create({
    detail: "Critical page module(s) failed to load:\n/pages/index.mdx: bad syntax",
    context: { buildFailure: true, tenantBuildFailure: true },
  });
  const frameworkPipelineError = RENDER_ERROR.create({
    detail: "Critical page module(s) failed to load while persisting its cache entry",
    context: { buildFailure: true, tenantBuildFailure: false },
  });
  const mdxRegistryError = MDX_COMPILE_ERROR.create({
    detail: "MDX compilation failed in /pages/index.mdx",
  });
  const markdownRegistryError = MARKDOWN_COMPILE_ERROR.create({
    detail: "Markdown frontmatter failed in /pages/index.md",
  });
  const sourceCompilationError = COMPILATION_ERROR.create({
    detail: "TypeScript syntax failed in /pages/index.tsx",
    context: { tenantBuildFailure: true },
  });
  const frameworkImportError = IMPORT_RESOLUTION_ERROR.create({
    detail: "Could not resolve framework import: #veryfront/missing",
  });
  const frameworkError = INITIALIZATION_ERROR.create({
    detail: "renderer failed to initialize",
  });
  const assetOptimizationError = ASSET_OPTIMIZATION_ERROR.create({
    detail: "framework image optimization failed",
  });
  const sourcemapError = SOURCEMAP_ERROR.create({
    detail: "framework source map generation failed",
  });
  const frameworkCacheWriteError = BUILD_FAILED.create({
    detail: "Failed to write MDX module cache file: <REDACTED>",
  });
  const frameworkBundleError = BUNDLE_ERROR.create({
    detail: "Failed to regenerate framework bundle cache entry: <REDACTED>",
  });
  const ssgInfrastructureError = SSG_GENERATION_ERROR.create({
    detail: "Failed to write generated page output",
    cause: Object.assign(new Error("No space left on device"), { code: "ENOSPC" }),
    context: { route: "/" },
  });

  assertEquals(
    captureApplicationError(compileError, { boundary: "ssr.render" }),
    "event-id",
  );
  assertEquals(
    captureApplicationError(pipelineError, { boundary: "ssr.render" }),
    "event-id",
  );
  assertEquals(
    captureApplicationError(mdxRegistryError, { boundary: "ssr.render" }),
    "event-id",
  );
  assertEquals(
    captureApplicationError(markdownRegistryError, { boundary: "ssr.render" }),
    "event-id",
  );
  assertEquals(
    captureApplicationError(sourceCompilationError, { boundary: "ssr.render" }),
    "event-id",
  );
  assertEquals(
    captureApplicationError(frameworkImportError, { boundary: "ssr.render" }),
    "event-id",
  );
  assertEquals(
    captureApplicationError(frameworkError, { boundary: "ssr.render" }),
    "event-id",
  );
  assertEquals(
    captureApplicationError(assetOptimizationError, { boundary: "ssr.render" }),
    "event-id",
  );
  assertEquals(
    captureApplicationError(sourcemapError, { boundary: "ssr.render" }),
    "event-id",
  );
  assertEquals(
    captureApplicationError(frameworkCacheWriteError, { boundary: "ssr.render" }),
    "event-id",
  );
  assertEquals(
    captureApplicationError(frameworkBundleError, { boundary: "ssr.render" }),
    "event-id",
  );
  assertEquals(
    captureApplicationError(frameworkPipelineError, { boundary: "ssr.render" }),
    "event-id",
  );
  assertEquals(
    captureApplicationError(legacyBuildError, { boundary: "ssr.render" }),
    "event-id",
  );
  assertEquals(
    captureApplicationError(ssgInfrastructureError, { boundary: "ssr.render" }),
    "event-id",
  );

  const genericCompilationError = COMPILATION_ERROR.create({
    detail: "esbuild service exited unexpectedly",
  });
  assertEquals(
    captureApplicationError(genericCompilationError, { boundary: "ssr.render" }),
    "event-id",
  );

  assertEquals(captures.length, 15);
  // Tenant build/content failures stay visible for escalation analysis, but
  // are tagged and downgraded so they stop surfacing as error-level issues.
  assertEquals(captures[0]?.context.errorClass, "tenant-build");
  assertEquals(captures[0]?.context.level, "warning");
  assertEquals(captures[1]?.context.errorClass, "tenant-build");
  assertEquals(captures[1]?.context.level, "warning");
  assertEquals(captures[2]?.context.errorClass, "tenant-build");
  assertEquals(captures[2]?.context.level, "warning");
  assertEquals(captures[3]?.context.errorClass, "tenant-build");
  assertEquals(captures[3]?.context.level, "warning");
  assertEquals(captures[4]?.context.errorClass, "tenant-build");
  assertEquals(captures[4]?.context.level, "warning");
  // Generic import-resolution and other framework failures keep their default
  // error-level capture. Source-aware resolver seams add tenant context when
  // project code is actually responsible.
  assertEquals(captures[5]?.context.errorClass, undefined);
  assertEquals(captures[5]?.context.level, undefined);
  assertEquals(captures[6]?.context.errorClass, undefined);
  assertEquals(captures[6]?.context.level, undefined);
  assertEquals(captures[7]?.context.errorClass, undefined);
  assertEquals(captures[7]?.context.level, undefined);
  assertEquals(captures[8]?.context.errorClass, undefined);
  assertEquals(captures[8]?.context.level, undefined);
  assertEquals(captures[9]?.context.errorClass, undefined);
  assertEquals(captures[9]?.context.level, undefined);
  assertEquals(captures[10]?.context.errorClass, undefined);
  assertEquals(captures[10]?.context.level, undefined);
  assertEquals(captures[11]?.context.errorClass, undefined);
  assertEquals(captures[11]?.context.level, undefined);
  assertEquals(captures[12]?.context.errorClass, undefined);
  assertEquals(captures[12]?.context.level, undefined);
  assertEquals(captures[13]?.context.errorClass, undefined);
  assertEquals(captures[13]?.context.level, undefined);
  assertEquals(captures[14]?.context.errorClass, undefined);
  assertEquals(captures[14]?.context.level, undefined);
});

it("application error reporter ignores inherited tenant build tags", () => {
  const tenantBuildFailureTag = Symbol.for("veryfront.module-loader.tenant-build-failure");
  const previousDescriptor = Object.getOwnPropertyDescriptor(
    Error.prototype,
    tenantBuildFailureTag,
  );
  Object.defineProperty(Error.prototype, tenantBuildFailureTag, {
    configurable: true,
    value: true,
  });

  try {
    const captures: Array<{ error: unknown; context: SharedApplicationErrorContext }> = [];
    setApplicationErrorReporter({
      capture(error, context) {
        captures.push({ error, context });
        return "event-id";
      },
      flush: () => Promise.resolve(true),
    });

    assertEquals(
      captureApplicationError(new Error("framework failed"), { boundary: "ssr.render" }),
      "event-id",
    );
    assertEquals(captures[0]?.context.errorClass, undefined);
    assertEquals(captures[0]?.context.level, undefined);

    const accessorTagError = new Error("framework failed");
    let getterRead = false;
    Object.defineProperty(accessorTagError, tenantBuildFailureTag, {
      configurable: true,
      get() {
        getterRead = true;
        return true;
      },
    });

    assertEquals(
      captureApplicationError(accessorTagError, { boundary: "ssr.render" }),
      "event-id",
    );
    assertEquals(getterRead, false);
    assertEquals(captures[1]?.context.errorClass, undefined);
    assertEquals(captures[1]?.context.level, undefined);
  } finally {
    if (previousDescriptor) {
      Object.defineProperty(Error.prototype, tenantBuildFailureTag, previousDescriptor);
    } else {
      delete (Error.prototype as { [tenantBuildFailureTag]?: unknown })[tenantBuildFailureTag];
    }
  }
});

it("application error reporter ignores poisoned Reflect descriptor lookups for tenant tags", () => {
  const previousDescriptor = Object.getOwnPropertyDescriptor(
    Reflect,
    "getOwnPropertyDescriptor",
  );
  if (!previousDescriptor || typeof previousDescriptor.value !== "function") {
    throw new Error("Expected Reflect.getOwnPropertyDescriptor descriptor");
  }
  Object.defineProperty(Reflect, "getOwnPropertyDescriptor", {
    ...previousDescriptor,
    value: () => ({
      configurable: true,
      enumerable: false,
      value: true,
      writable: false,
    }),
  });

  try {
    const captures: Array<{ error: unknown; context: SharedApplicationErrorContext }> = [];
    setApplicationErrorReporter({
      capture(error, context) {
        captures.push({ error, context });
        return "event-id";
      },
      flush: () => Promise.resolve(true),
    });

    assertEquals(
      captureApplicationError(new Error("framework failed"), { boundary: "ssr.render" }),
      "event-id",
    );
    assertEquals(captures[0]?.context.errorClass, undefined);
    assertEquals(captures[0]?.context.level, undefined);
  } finally {
    Object.defineProperty(Reflect, "getOwnPropertyDescriptor", previousDescriptor);
  }
});

it("application error capture failures never replace application control flow", () => {
  const hostile = new Proxy({}, {
    getPrototypeOf() {
      throw new Error("prototype unavailable");
    },
  });
  setApplicationErrorReporter({
    capture() {
      throw new Error("reporter unavailable");
    },
    flush: () => Promise.resolve(true),
  });

  assertEquals(
    captureApplicationError(hostile, { boundary: "renderer.request" }),
    undefined,
  );
});

it("application error flush is strictly bounded and fail-open", async () => {
  setApplicationErrorReporter({
    capture: () => undefined,
    flush: () => new Promise<boolean>(() => {}),
  });

  assertEquals(await flushApplicationErrors(5), false);

  setApplicationErrorReporter({
    capture: () => undefined,
    flush: () => Promise.reject(new Error("transport unavailable")),
  });
  assertEquals(await flushApplicationErrors(5), false);
  assertEquals(await flushApplicationErrors(-1), false);
});

it("application error initialization is explicitly disabled without a selected initializer", async () => {
  const lifecycle = await initializeApplicationErrorReporter({
    serviceName: "test-service",
  });

  assertEquals(lifecycle.enabled, false);
  assertEquals(await lifecycle.flush(), true);
  await lifecycle.dispose();
});

it("selected application error initializer failures propagate unchanged", async () => {
  const initializationError = new Error("reporter initialization failed");
  const thrown = await assertRejects(() =>
    initializeApplicationErrorReporter({
      initializer: {
        initialize: () => Promise.reject(initializationError),
      },
      serviceName: "test-service",
    })
  );

  assertStrictEquals(thrown, initializationError);
});

it("application error initialization rejects invalid service identities and direct replacement races", async () => {
  await assertRejects(
    () =>
      initializeApplicationErrorReporter({
        serviceName: " invalid ",
      }),
    TypeError,
    "canonical string",
  );

  let resolveInitialization: ((value: undefined) => void) | undefined;
  let markInitializationStarted: (() => void) | undefined;
  const initializationStarted = new Promise<void>((resolve) => {
    markInitializationStarted = resolve;
  });
  const pending = initializeApplicationErrorReporter({
    initializer: {
      initialize: () =>
        new Promise<undefined>((resolve) => {
          resolveInitialization = resolve;
          markInitializationStarted?.();
        }),
    },
    serviceName: "test-service",
  });
  assertThrows(
    () => setApplicationErrorReporter(undefined),
    Error,
    "in-flight application-error initialization",
  );
  await initializationStarted;
  resolveInitialization?.(undefined);
  await pending;
});

it("application error lifecycle publishes, flushes, and disposes one owned reporter", async () => {
  const captures: unknown[] = [];
  const flushTimeouts: Array<number | undefined> = [];
  let disposeCalls = 0;
  const lifecycle = await initializeApplicationErrorReporter({
    initializer: {
      initialize: ({ serviceName }) => {
        assertEquals(serviceName, "test-service");
        return {
          reporter: {
            capture(error) {
              captures.push(error);
              return "event-id";
            },
            flush(timeoutMs) {
              flushTimeouts.push(timeoutMs);
              return Promise.resolve(true);
            },
          },
          dispose() {
            disposeCalls++;
          },
        };
      },
    },
    serviceName: "test-service",
  });

  const error = new Error("reported");
  assertEquals(lifecycle.capture(error, { boundary: "test" }), "event-id");
  assertEquals(await lifecycle.flush(50), true);
  await lifecycle.dispose();
  await lifecycle.dispose();

  assertEquals(captures, [error]);
  assertEquals(flushTimeouts, [50]);
  assertEquals(disposeCalls, 1);
  assertEquals(lifecycle.capture(new Error("stale"), { boundary: "test" }), undefined);
});

it("direct reporter replacement hands over ownership from an active lifecycle", async () => {
  let disposeCalls = 0;
  const lifecycleCaptures: unknown[] = [];
  const lifecycle = await initializeApplicationErrorReporter({
    initializer: {
      initialize: () => ({
        reporter: {
          capture(error) {
            lifecycleCaptures.push(error);
            return "lifecycle-event";
          },
          flush: () => Promise.resolve(true),
        },
        dispose() {
          disposeCalls++;
        },
      }),
    },
    serviceName: "test-service",
  });

  // Mirrors the sentry publish path (sentry.ts, node-sentry.ts) installing its
  // reporter while a lifecycle owns the process reporter.
  const directCaptures: unknown[] = [];
  setApplicationErrorReporter({
    capture(error) {
      directCaptures.push(error);
      return "direct-event";
    },
    flush: () => Promise.resolve(true),
  });

  const error = new Error("reported after handover");
  assertEquals(captureApplicationError(error, { boundary: "test" }), "direct-event");
  assertEquals(directCaptures, [error]);
  assertEquals(lifecycleCaptures, []);
  assertEquals(lifecycle.capture(new Error("detached"), { boundary: "test" }), undefined);
  assertEquals(await lifecycle.flush(50), true);

  // The detached lifecycle still disposes its own session and must not clear
  // the reporter it no longer owns.
  await lifecycle.dispose();
  assertEquals(disposeCalls, 1);
  assertEquals(captureApplicationError(error, { boundary: "test" }), "direct-event");
  assertEquals(directCaptures.length, 2);
});

it("sentry teardown clears the reporter while a lifecycle is still active", async () => {
  let disposeCalls = 0;
  const lifecycle = await initializeApplicationErrorReporter({
    initializer: {
      initialize: () => ({
        reporter: {
          capture: () => "lifecycle-event",
          flush: () => Promise.resolve(true),
        },
        dispose() {
          disposeCalls++;
        },
      }),
    },
    serviceName: "test-service",
  });

  // Mirrors resetSentryForTests() and the node agent service lifecycle reset().
  setApplicationErrorReporter(undefined);

  assertEquals(captureApplicationError(new Error("cleared"), { boundary: "test" }), undefined);
  assertEquals(await flushApplicationErrors(50), true);
  assertEquals(disposeCalls, 0);

  // A later initialization still disposes the detached session automatically.
  const next = await initializeApplicationErrorReporter({ serviceName: "test-service" });
  assertEquals(disposeCalls, 1);
  assertEquals(next.enabled, false);
  await lifecycle.dispose();
  assertEquals(disposeCalls, 1);
});

it("superseded application error initialization disposes stale state before starting its replacement", async () => {
  let resolveFirst:
    | ((value: {
      reporter: { capture(): string; flush(): Promise<boolean> };
      dispose(): void;
    }) => void)
    | undefined;
  let markFirstStarted: (() => void) | undefined;
  const firstStarted = new Promise<void>((resolve) => {
    markFirstStarted = resolve;
  });
  let finishStaleDisposal: (() => void) | undefined;
  const staleDisposalFinished = new Promise<void>((resolve) => {
    finishStaleDisposal = resolve;
  });
  let markStaleDisposalStarted: (() => void) | undefined;
  const staleDisposalStarted = new Promise<void>((resolve) => {
    markStaleDisposalStarted = resolve;
  });
  let staleDisposeCalls = 0;
  let secondInitializeCalls = 0;
  const first = initializeApplicationErrorReporter({
    initializer: {
      initialize: () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
          markFirstStarted?.();
        }),
    },
    serviceName: "first",
  });
  await firstStarted;

  const secondPending = initializeApplicationErrorReporter({
    initializer: {
      initialize: () => {
        secondInitializeCalls++;
        return {
          reporter: {
            capture: () => "second",
            flush: () => Promise.resolve(true),
          },
          dispose: () => {},
        };
      },
    },
    serviceName: "second",
  });
  resolveFirst?.({
    reporter: {
      capture: () => "first",
      flush: () => Promise.resolve(true),
    },
    async dispose() {
      staleDisposeCalls++;
      markStaleDisposalStarted?.();
      await staleDisposalFinished;
    },
  });

  await staleDisposalStarted;
  assertEquals(secondInitializeCalls, 0);
  finishStaleDisposal?.();
  const firstLifecycle = await first;
  const second = await secondPending;
  assertEquals(firstLifecycle.enabled, false);
  assertEquals(staleDisposeCalls, 1);
  assertEquals(secondInitializeCalls, 1);
  assertEquals(second.capture(new Error("current"), { boundary: "test" }), "second");
  await second.dispose();
});
