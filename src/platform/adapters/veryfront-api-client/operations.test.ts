import "#veryfront/schemas/_test-setup.ts";

import {
  assertEquals,
  assertExists,
  assertInstanceOf,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  __registerLogRecordEmitter,
  __resetLoggerConfigForTests,
  __resetLogRecordEmitterForTests,
  type LogEntry,
} from "#veryfront/utils/logger/index.ts";
import { VeryfrontAPIOperations } from "./operations.ts";
import { RELEASE_ASSET_MAX_SIZE_BYTES, VeryfrontError } from "./types.ts";
import {
  _resetShimForTests,
  type AttributeValue,
  setGlobalTracerProvider,
  type Span,
  type SpanContext,
} from "#veryfront/observability/tracing/api-shim.ts";

function createOps(
  token: string | (() => string) = "token",
  projectId?: string,
): VeryfrontAPIOperations {
  return new VeryfrontAPIOperations(
    "https://api.example.com",
    token,
    { maxRetries: 3, initialDelay: 100, maxDelay: 1000 },
    projectId,
  );
}

function assertMethodExists<T extends object>(obj: T, key: keyof T): void {
  const value = obj[key];
  assertExists(value);
  assertEquals(typeof value, "function");
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digestInput = new Uint8Array(bytes.byteLength);
  digestInput.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", digestInput);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

describe("VeryfrontAPIOperations", () => {
  const originalFetch = globalThis.fetch;

  function stubJsonFetch(handler: (url: string, init?: RequestInit) => unknown): void {
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const body = handler(String(input), init);
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }) as typeof fetch;
  }

  afterEach(() => {
    globalThis.fetch = originalFetch;
    __resetLogRecordEmitterForTests();
    _resetShimForTests();
  });

  describe("class", () => {
    it("should export VeryfrontAPIOperations class", () => {
      assertExists(VeryfrontAPIOperations);
      assertEquals(typeof VeryfrontAPIOperations, "function");
    });

    it("should be instantiable with string token", () => {
      assertExists(createOps("test-token"));
    });

    it("should be instantiable with token provider function", () => {
      assertExists(createOps(() => "dynamic-token"));
    });
  });

  describe("getToken", () => {
    it("should return token from string", () => {
      assertEquals(createOps("static-token").getToken(), "static-token");
    });

    it("should return token from provider function", () => {
      assertEquals(createOps(() => "provider-token").getToken(), "provider-token");
    });

    it("wraps token-provider failures without exposing provider error text", async () => {
      const secret = "PRIVATE_TOKEN_PROVIDER_CANARY";
      const operations = createOps(() => {
        throw new Proxy(new Error(`token provider failed: ${secret}`), {
          getPrototypeOf() {
            throw new Error(secret);
          },
        });
      });

      let error: unknown;
      try {
        await operations.listProjects();
      } catch (caught) {
        error = caught;
      }

      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.status, 401);
      assertEquals(JSON.stringify(error).includes(secret), false);
    });

    it("rejects an invalid token-provider result at the provider boundary", () => {
      const operations = createOps(() => "");

      let error: unknown;
      try {
        operations.getToken();
      } catch (caught) {
        error = caught;
      }

      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.status, 401);
    });
  });

  describe("request construction", () => {
    it("applies and snapshots a per-call high-level request policy", async () => {
      let fetchCallCount = 0;
      globalThis.fetch = (() => {
        fetchCallCount++;
        return Promise.resolve(Response.json({
          id: "550e8400-e29b-41d4-a716-446655440000",
          name: "Project",
          slug: "project",
        }));
      }) as typeof fetch;
      let maxResponseBytesReads = 0;
      const policy = Object.defineProperty({}, "maxResponseBytes", {
        get() {
          maxResponseBytesReads++;
          return 4;
        },
      });

      const error = await assertRejects(() => createOps().getProject("project", policy as never));

      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.status, 502);
      assertEquals(fetchCallCount, 1);
      assertEquals(maxResponseBytesReads, 1);
    });

    it("rejects unreadable list options with a sanitized typed error before fetch", async () => {
      const secret = "PRIVATE_LIST_GETTER_CANARY";
      let fetchCallCount = 0;
      globalThis.fetch = (() => {
        fetchCallCount++;
        return Promise.resolve(Response.json({ data: [] }));
      }) as typeof fetch;
      const options = Object.defineProperty({}, "limit", {
        get() {
          throw new Error(secret);
        },
      });

      const error = await assertRejects(() =>
        createOps().listBranchFiles("project", "main", options as never)
      );

      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.status, 400);
      assertEquals(fetchCallCount, 0);
      assertEquals(JSON.stringify(error).includes(secret), false);
    });

    it("wraps revoked request policy proxies before fetch", async () => {
      let fetchCallCount = 0;
      globalThis.fetch = (() => {
        fetchCallCount++;
        return Promise.resolve(Response.json({ data: [] }));
      }) as typeof fetch;
      const { proxy, revoke } = Proxy.revocable({}, {});
      revoke();

      const error = await assertRejects(() =>
        createOps().listBranchFiles("project", "main", {}, proxy as never)
      );

      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.status, 400);
      assertEquals(fetchCallCount, 0);
    });

    it("joins a trailing-slash base URL without creating a double slash", async () => {
      let requestedUrl = "";
      stubJsonFetch((url) => {
        requestedUrl = url;
        return {
          id: "550e8400-e29b-41d4-a716-446655440000",
          name: "Project",
          slug: "project",
        };
      });
      const operations = new VeryfrontAPIOperations(
        "https://api.example.com/v1/",
        "token",
        { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
      );

      await operations.getProject("project");

      assertEquals(requestedUrl, "https://api.example.com/v1/projects/project");
    });

    it("rejects API base URLs with embedded credentials before fetch", async () => {
      const secret = "PRIVATE_BASE_PASSWORD_CANARY";
      let fetchCallCount = 0;
      globalThis.fetch = (() => {
        fetchCallCount++;
        return Promise.resolve(Response.json({ data: [] }));
      }) as typeof fetch;
      const operations = new VeryfrontAPIOperations(
        `https://user:${secret}@api.example.com`,
        "token",
        { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
      );

      let error: unknown;
      try {
        await operations.listProjects();
      } catch (caught) {
        error = caught;
      }

      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.status, 400);
      assertEquals(fetchCallCount, 0);
      assertEquals(JSON.stringify(error).includes(secret), false);
    });

    it("rejects an API base URL containing a query before fetch", async () => {
      let fetchCallCount = 0;
      globalThis.fetch = (() => {
        fetchCallCount++;
        return Promise.resolve(Response.json({ data: [] }));
      }) as typeof fetch;
      const operations = new VeryfrontAPIOperations(
        "https://api.example.com/v1?tenant=private",
        "token",
        { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
      );

      let error: unknown;
      try {
        await operations.listProjects();
      } catch (caught) {
        error = caught;
      }

      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.status, 400);
      assertEquals(fetchCallCount, 0);
    });

    it("does not attach endpoint query values to tracing spans", async () => {
      const secret = "PRIVATE_PATTERN_CANARY";
      const capturedAttributes: Array<Record<string, AttributeValue>> = [];
      const spanContext: SpanContext = {
        traceId: "00000000000000000000000000000000",
        spanId: "0000000000000000",
        traceFlags: 0,
      };
      const span: Span = {
        setAttribute() {
          return span;
        },
        setAttributes() {
          return span;
        },
        setStatus() {
          return span;
        },
        recordException() {},
        addEvent() {
          return span;
        },
        end() {},
        spanContext: () => spanContext,
        updateName() {},
      };
      setGlobalTracerProvider({
        getTracer: () => ({
          startSpan(_name, options) {
            capturedAttributes.push(options?.attributes ?? {});
            return span;
          },
          startActiveSpan: (_name: string, ...args: unknown[]) => {
            const callback = args.find((arg) => typeof arg === "function") as
              | ((span: Span) => unknown)
              | undefined;
            return callback?.(span);
          },
        }),
      });
      stubJsonFetch(() => ({
        data: [],
        page_info: { self: null, first: null, next: null, prev: null },
      }));

      await createOps().listBranchFiles("project", "main", { pattern: secret });

      assertEquals(JSON.stringify(capturedAttributes).includes(secret), false);
    });

    it("keeps customer identifiers out of operation logs, spans, and errors", async () => {
      const hostCanary = "private-api-host-canary.example";
      const basePathCanary = "PRIVATE_API_BASE_PATH_CANARY";
      const projectCanary = "PRIVATE_PROJECT_CANARY";
      const branchCanary = "PRIVATE_BRANCH_CANARY";
      const domainCanary = "private-domain-canary.example";
      const releaseCanary = "PRIVATE_RELEASE_CANARY";
      const fileCanary = "PRIVATE_FILE_CANARY";
      const hashCanary = "PRIVATE_HASH_CANARY";
      const entries: LogEntry[] = [];
      const capturedAttributes: Array<Record<string, AttributeValue>> = [];
      const errors: Array<{ detail: unknown; context: unknown }> = [];
      const previousLogLevel = Deno.env.get("LOG_LEVEL");
      const originalDebug = console.debug;
      const spanContext: SpanContext = {
        traceId: "00000000000000000000000000000000",
        spanId: "0000000000000000",
        traceFlags: 0,
      };
      const span: Span = {
        setAttribute() {
          return span;
        },
        setAttributes() {
          return span;
        },
        setStatus() {
          return span;
        },
        recordException() {},
        addEvent() {
          return span;
        },
        end() {},
        spanContext: () => spanContext,
        updateName() {},
      };
      setGlobalTracerProvider({
        getTracer: () => ({
          startSpan(_name, options) {
            capturedAttributes.push(options?.attributes ?? {});
            return span;
          },
          startActiveSpan: (_name: string, ...args: unknown[]) => {
            const callback = args.find((arg) => typeof arg === "function") as
              | ((span: Span) => unknown)
              | undefined;
            return callback?.(span);
          },
        }),
      });
      Deno.env.set("LOG_LEVEL", "DEBUG");
      __resetLoggerConfigForTests();
      console.debug = () => {};
      __registerLogRecordEmitter((entry) => entries.push(entry));
      globalThis.fetch =
        (() => Promise.resolve(new Response(null, { status: 404 }))) as typeof fetch;
      const operations = new VeryfrontAPIOperations(
        `https://${hostCanary}/${basePathCanary}`,
        "token",
        { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
      );

      try {
        for (
          const operation of [
            () => operations.getReleaseFile(projectCanary, releaseCanary, fileCanary),
            () =>
              operations.resolveStyleArtifact(projectCanary, {
                branch: branchCanary,
                releaseId: releaseCanary,
                styleProfileHash: hashCanary,
              }),
          ]
        ) {
          try {
            await operation();
          } catch (error) {
            assertInstanceOf(error, VeryfrontError);
            errors.push({ detail: error.detail, context: error.context });
          }
        }
        assertEquals(await operations.lookupProjectByDomain(domainCanary), null);
      } finally {
        console.debug = originalDebug;
        if (previousLogLevel === undefined) Deno.env.delete("LOG_LEVEL");
        else Deno.env.set("LOG_LEVEL", previousLogLevel);
        __resetLoggerConfigForTests();
      }

      const emitted = JSON.stringify({ entries, capturedAttributes, errors });
      assertEquals(
        entries.some((entry) =>
          entry.component === "api" &&
          entry.message === "Veryfront API operation" &&
          entry.context?.operation === "getReleaseFile" &&
          entry.context?.route === "/projects/{project}/releases/{release}/files/{file}"
        ),
        true,
      );
      for (
        const canary of [
          hostCanary,
          basePathCanary,
          projectCanary,
          branchCanary,
          domainCanary,
          releaseCanary,
          fileCanary,
          hashCanary,
        ]
      ) {
        assertEquals(emitted.includes(canary), false);
      }
      assertEquals(emitted.includes("getReleaseFile"), true);
      assertEquals(
        emitted.includes("/projects/{project}/releases/{release}/files/{file}"),
        true,
      );
      assertEquals(emitted.includes("lookupProjectByDomain"), true);
    });

    it("rejects invalid list limits before fetch", async () => {
      let fetchCallCount = 0;
      globalThis.fetch = (() => {
        fetchCallCount++;
        return Promise.resolve(Response.json({ data: [] }));
      }) as typeof fetch;
      const operations = new VeryfrontAPIOperations(
        "https://api.example.com",
        "token",
        { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
      );

      await assertRejects(
        () => operations.listProjects({ limit: 0 }),
        VeryfrontError,
        "positive integer",
      );
      await assertRejects(
        () => operations.listBranchFiles("project", "main", { limit: 1.5 }),
        VeryfrontError,
        "positive integer",
      );
      assertEquals(fetchCallCount, 0);
    });
  });

  describe("response validation", () => {
    it("wraps invalid provider payloads in a sanitized typed error", async () => {
      const secret = "PRIVATE_INVALID_RESPONSE_CANARY";
      stubJsonFetch(() => ({ id: "not-a-uuid", name: secret }));

      let error: unknown;
      try {
        await createOps().getProject("project");
      } catch (caught) {
        error = caught;
      }

      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.status, 502);
      assertEquals(JSON.stringify(error).includes(secret), false);
    });
  });

  describe("input snapshots", () => {
    it("reads style artifact inputs once before request construction", async () => {
      let branchReads = 0;
      let requestedBranch = "";
      globalThis.fetch = ((input: RequestInfo | URL) => {
        requestedBranch = new URL(String(input)).searchParams.get("branch") ?? "";
        return Promise.resolve(Response.json({ status: "missing" }));
      }) as typeof fetch;
      const input = {
        styleProfileHash: "profile",
        get branch() {
          branchReads++;
          if (branchReads > 1) throw new Error("PRIVATE_STYLE_GETTER_CANARY");
          return "feature";
        },
      };

      const result = await createOps().resolveStyleArtifact("project", input);

      assertEquals(result.status, "missing");
      assertEquals(requestedBranch, "feature");
      assertEquals(branchReads, 1);
    });
  });

  describe("domain lookup", () => {
    it("rejects URL-shaped domains before fetch without exposing credentials", async () => {
      const secret = "PRIVATE_DOMAIN_PASSWORD_CANARY";
      let fetchCallCount = 0;
      globalThis.fetch = (() => {
        fetchCallCount++;
        return Promise.resolve(Response.json({}));
      }) as typeof fetch;

      let error: unknown;
      try {
        await createOps().lookupProjectByDomain(`https://user:${secret}@example.com/path`);
      } catch (caught) {
        error = caught;
      }

      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.status, 400);
      assertEquals(fetchCallCount, 0);
      assertEquals(JSON.stringify(error).includes(secret), false);
    });
  });

  describe("pagination", () => {
    it("captures a token provider once for the complete paginated operation", async () => {
      let tokenReads = 0;
      let fetchCallCount = 0;
      globalThis.fetch = (() => {
        fetchCallCount++;
        return Promise.resolve(Response.json({
          data: [],
          page_info: {
            self: null,
            first: null,
            next: fetchCallCount === 1 ? "second" : null,
            prev: null,
          },
        }));
      }) as typeof fetch;
      const operations = createOps(() => {
        tokenReads++;
        return "token";
      });

      await operations.listAllBranchFiles("project", "main");

      assertEquals(fetchCallCount, 2);
      assertEquals(tokenReads, 1);
    });

    it("uses one immutable total timeout across every page", async () => {
      let fetchCallCount = 0;
      let totalTimeoutReads = 0;
      globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
        fetchCallCount++;
        if (fetchCallCount === 1) {
          return new Promise<Response>((resolve) => {
            setTimeout(() => {
              resolve(Response.json({
                data: [],
                page_info: { self: null, first: null, next: "second", prev: null },
              }));
            }, 35);
          });
        }
        return new Promise<Response>((_resolve, reject) => {
          const fallback = setTimeout(
            () => reject(new Error("request policy was not propagated")),
            120,
          );
          init?.signal?.addEventListener("abort", () => {
            clearTimeout(fallback);
            reject(new DOMException("Aborted", "AbortError"));
          }, { once: true });
        });
      }) as typeof fetch;
      const policy = Object.defineProperty({}, "totalTimeoutMs", {
        get() {
          totalTimeoutReads++;
          return 60;
        },
      });
      const startedAt = performance.now();

      const error = await assertRejects(() =>
        createOps().listAllBranchFiles("project", "main", {}, policy as never)
      );
      const durationMs = performance.now() - startedAt;

      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.status, 504);
      assertEquals(fetchCallCount, 2);
      assertEquals(totalTimeoutReads, 1);
      if (durationMs >= 85) {
        throw new Error(`Pagination reset the total timeout (${durationMs}ms)`);
      }
    });

    it("preserves the requested page size across every page", async () => {
      const requestedUrls: string[] = [];
      globalThis.fetch = ((input: RequestInfo | URL) => {
        const url = String(input);
        requestedUrls.push(url);
        const cursor = new URL(url).searchParams.get("cursor");
        return Promise.resolve(Response.json({
          data: [],
          page_info: {
            self: null,
            first: null,
            next: cursor === null ? "second-page" : null,
            prev: null,
          },
        }));
      }) as typeof fetch;

      await createOps().listAllBranchFiles("project", "main", { limit: 25 });

      assertEquals(requestedUrls.length, 2);
      assertEquals(
        requestedUrls.map((url) => new URL(url).searchParams.get("limit")),
        ["25", "25"],
      );
    });

    it("rejects a repeated cursor before issuing another request", async () => {
      let fetchCallCount = 0;
      globalThis.fetch = (() => {
        fetchCallCount++;
        if (fetchCallCount <= 2) {
          return Promise.resolve(Response.json({
            data: [],
            page_info: { self: null, first: null, next: "repeat", prev: null },
          }));
        }
        return Promise.resolve(new Response(null, { status: 400 }));
      }) as typeof fetch;
      const operations = new VeryfrontAPIOperations(
        "https://api.example.com",
        "token",
        { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
      );

      let error: unknown;
      try {
        await operations.listAllBranchFiles("project", "main");
      } catch (caught) {
        error = caught;
      }

      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.status, 502);
      assertEquals(fetchCallCount, 2);
    });

    it("stops unique-cursor pagination at the configured page budget", async () => {
      let fetchCallCount = 0;
      globalThis.fetch = (() => {
        fetchCallCount++;
        if (fetchCallCount > 2) return Promise.resolve(new Response(null, { status: 400 }));
        return Promise.resolve(Response.json({
          data: [],
          page_info: {
            self: null,
            first: null,
            next: `cursor-${fetchCallCount}`,
            prev: null,
          },
        }));
      }) as typeof fetch;

      const error = await assertRejects(() =>
        createOps().listAllBranchFiles("project", "main", { maxPages: 2 } as never)
      );

      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.status, 502);
      assertEquals(fetchCallCount, 2);
    });

    it("does not fetch beyond the file budget and requests only the remaining capacity", async () => {
      const requestedLimits: string[] = [];
      globalThis.fetch = ((input: RequestInfo | URL) => {
        requestedLimits.push(new URL(String(input)).searchParams.get("limit") ?? "");
        return Promise.resolve(Response.json({
          data: [{
            path: "one.ts",
            type: "file",
            size: 1,
            updated_at: "2026-01-01T00:00:00.000Z",
            content: "x",
          }],
          page_info: { self: null, first: null, next: "more", prev: null },
        }));
      }) as typeof fetch;

      const error = await assertRejects(() =>
        createOps().listAllBranchFiles("project", "main", {
          limit: 100,
          maxFiles: 1,
        })
      );

      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.status, 502);
      assertEquals(requestedLimits, ["1"]);
    });
  });

  describe("setTokenProvider", () => {
    it("should update the token provider", () => {
      const ops = createOps("old-token");
      assertEquals(ops.getToken(), "old-token");

      ops.setTokenProvider(() => "new-token");
      assertEquals(ops.getToken(), "new-token");
    });
  });

  describe("setProjectId/getProjectId", () => {
    it("should set and get project ID", () => {
      const ops = createOps("token", "initial-project-id");
      assertEquals(ops.getProjectId(), "initial-project-id");

      ops.setProjectId("new-project-id");
      assertEquals(ops.getProjectId(), "new-project-id");
    });

    it("should throw when getting project ID if not set", () => {
      const ops = createOps("token");

      assertThrows(
        () => ops.getProjectId(),
        Error,
        "Veryfront API client not initialized",
      );
    });
  });

  describe("methods exist", () => {
    it("should have listProjects method", () => {
      assertMethodExists(createOps(), "listProjects");
    });

    it("should have getProject method", () => {
      assertMethodExists(createOps(), "getProject");
    });

    it("should have listBranchFiles method", () => {
      assertMethodExists(createOps(), "listBranchFiles");
    });

    it("should have getBranchFile method", () => {
      assertMethodExists(createOps(), "getBranchFile");
    });

    it("should have listEnvironmentFiles method", () => {
      assertMethodExists(createOps(), "listEnvironmentFiles");
    });

    it("should have getEnvironmentFile method", () => {
      assertMethodExists(createOps(), "getEnvironmentFile");
    });

    it("should have listReleaseFiles method", () => {
      assertMethodExists(createOps(), "listReleaseFiles");
    });

    it("should have getReleaseFile method", () => {
      assertMethodExists(createOps(), "getReleaseFile");
    });

    it("should have lookupProjectByDomain method", () => {
      assertMethodExists(createOps(), "lookupProjectByDomain");
    });
  });

  describe("runtime server function access", () => {
    it("requests branch file lists with server functions for preview route discovery", async () => {
      let requestedUrl = "";
      stubJsonFetch((url) => {
        requestedUrl = url;
        return {
          data: [],
          page_info: { self: null, first: null, next: null, prev: null },
        };
      });

      await createOps().listBranchFiles("project-slug", "main");

      assertStringIncludes(requestedUrl, "include_server_functions=true");
    });

    it("passes path filters through branch file list requests", async () => {
      let requestedUrl = "";
      stubJsonFetch((url) => {
        requestedUrl = url;
        return {
          data: [],
          page_info: { self: null, first: null, next: null, prev: null },
        };
      });

      await createOps().listBranchFiles("project-slug", "main", { path: "knowledge/" });

      const parsed = new URL(requestedUrl);
      assertEquals(parsed.searchParams.get("path"), "knowledge/");
    });

    it("requests branch file content with server functions for preview handlers", async () => {
      let requestedUrl = "";
      stubJsonFetch((url) => {
        requestedUrl = url;
        return {
          id: "file-id",
          path: "app/api/ag-ui/route.ts",
          content: "export const POST = () => new Response();",
          size: 40,
          type: "function",
          updated_at: "2026-04-23T00:00:00.000Z",
        };
      });

      await createOps().getBranchFile("project-slug", "main", "app/api/ag-ui/route.ts");

      assertStringIncludes(requestedUrl, "include_server_functions=true");
    });

    it("warn-logs normal 404s for branch file content reads", async () => {
      const entries: LogEntry[] = [];
      const originalWarn = console.warn;
      console.warn = () => {};
      __registerLogRecordEmitter((entry) => entries.push(entry));
      globalThis.fetch = (() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: "Not found" }), {
            status: 404,
            statusText: "Not Found",
            headers: { "Content-Type": "application/json" },
          }),
        )) as typeof fetch;

      try {
        await assertRejects(
          () => createOps().getBranchFile("project-slug", "main", "app/globals.css"),
          Error,
          "API request failed with status 404",
        );
      } finally {
        console.warn = originalWarn;
      }

      assertEquals(
        entries.some((entry) =>
          entry.level === "warn" &&
          entry.component === "veryfront-api-client" &&
          entry.message === "Request failed"
        ),
        true,
      );
    });

    it("does not warn-log expected 404s for branch file content probes", async () => {
      const entries: LogEntry[] = [];
      const originalWarn = console.warn;
      console.warn = () => {};
      __registerLogRecordEmitter((entry) => entries.push(entry));
      globalThis.fetch = (() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: "Not found" }), {
            status: 404,
            statusText: "Not Found",
            headers: { "Content-Type": "application/json" },
          }),
        )) as typeof fetch;

      try {
        await assertRejects(
          () =>
            createOps().getBranchFile("project-slug", "main", "app/globals.css", {
              expectedMissing: true,
            }),
          Error,
          "API request failed with status 404",
        );
      } finally {
        console.warn = originalWarn;
      }

      assertEquals(
        entries.some((entry) =>
          (entry.level === "warn" || entry.level === "error") &&
          entry.component === "veryfront-api-client" &&
          entry.message === "Request failed"
        ),
        false,
      );
    });

    it("does not warn-log expected 404s for environment file content probes", async () => {
      const entries: LogEntry[] = [];
      const originalWarn = console.warn;
      console.warn = () => {};
      __registerLogRecordEmitter((entry) => entries.push(entry));
      globalThis.fetch = (() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: "Not found" }), {
            status: 404,
            statusText: "Not Found",
            headers: { "Content-Type": "application/json" },
          }),
        )) as typeof fetch;

      try {
        await assertRejects(
          () =>
            createOps().getEnvironmentFile("project-slug", "production", "app/globals.css", {
              expectedMissing: true,
            }),
          Error,
          "API request failed with status 404",
        );
      } finally {
        console.warn = originalWarn;
      }

      assertEquals(
        entries.some((entry) =>
          (entry.level === "warn" || entry.level === "error") &&
          entry.component === "veryfront-api-client" &&
          entry.message === "Request failed"
        ),
        false,
      );
    });

    it("does not warn-log expected 404s for release file content probes", async () => {
      const entries: LogEntry[] = [];
      const originalWarn = console.warn;
      console.warn = () => {};
      __registerLogRecordEmitter((entry) => entries.push(entry));
      globalThis.fetch = (() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: "Not found" }), {
            status: 404,
            statusText: "Not Found",
            headers: { "Content-Type": "application/json" },
          }),
        )) as typeof fetch;

      try {
        await assertRejects(
          () =>
            createOps().getReleaseFile("project-slug", "release-id", "app/globals.css", {
              expectedMissing: true,
            }),
          Error,
          "API request failed with status 404",
        );
      } finally {
        console.warn = originalWarn;
      }

      assertEquals(
        entries.some((entry) =>
          (entry.level === "warn" || entry.level === "error") &&
          entry.component === "veryfront-api-client" &&
          entry.message === "Request failed"
        ),
        false,
      );
    });

    it("still warn-logs authentication failures for branch file content", async () => {
      const entries: LogEntry[] = [];
      const originalWarn = console.warn;
      console.warn = () => {};
      __registerLogRecordEmitter((entry) => entries.push(entry));
      globalThis.fetch = (() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: "Invalid authentication token" }), {
            status: 401,
            statusText: "Unauthorized",
            headers: { "Content-Type": "application/json" },
          }),
        )) as typeof fetch;

      try {
        await assertRejects(
          () => createOps().getBranchFile("project-slug", "main", "app/globals.css"),
          Error,
          "API request failed with status 401",
        );
      } finally {
        console.warn = originalWarn;
      }

      assertEquals(
        entries.some((entry) =>
          entry.level === "warn" &&
          entry.component === "veryfront-api-client" &&
          entry.message === "Request failed"
        ),
        true,
      );
    });

    it("requests release file lists with server functions for runtime route discovery", async () => {
      let requestedUrl = "";
      stubJsonFetch((url) => {
        requestedUrl = url;
        return {
          data: [],
          page_info: { self: null, first: null, next: null, prev: null },
          release_id: "release-id",
          release_version: "v1",
        };
      });

      await createOps().listReleaseFiles("project-slug", "release-id");

      assertStringIncludes(requestedUrl, "include_server_functions=true");
    });

    it("requests release file content with server functions for runtime handlers", async () => {
      let requestedUrl = "";
      stubJsonFetch((url) => {
        requestedUrl = url;
        return {
          id: "file-id",
          version_id: "version-id",
          path: "pages/api/articles-2.ts",
          content: "export default () => {}",
          size: 21,
          type: "function",
          updated_at: "2026-04-23T00:00:00.000Z",
          release_id: "release-id",
          release_version: "v1",
        };
      });

      await createOps().getReleaseFile("project-slug", "release-id", "pages/api/articles-2.ts");

      assertStringIncludes(requestedUrl, "include_server_functions=true");
    });
  });

  describe("release asset manifest operations", () => {
    it("begins a build at the builds endpoint", async () => {
      let requestedUrl = "";
      let method = "";
      stubJsonFetch((url, init) => {
        requestedUrl = url;
        method = init?.method ?? "GET";
        return { id: "b1", manifest_version: 1, state: "building" };
      });

      const res = await createOps().beginReleaseAssetManifestBuild("project-slug", "rel-1");

      assertEquals(method, "POST");
      assertStringIncludes(requestedUrl, "/releases/rel-1/asset-manifest/builds");
      assertEquals(res.state, "building");
    });

    it("retries the idempotent begin operation after a transient failure", async () => {
      let fetchCallCount = 0;
      globalThis.fetch = (() => {
        fetchCallCount++;
        if (fetchCallCount === 1) return Promise.resolve(new Response(null, { status: 503 }));
        return Promise.resolve(Response.json({
          id: "b1",
          manifest_version: 1,
          state: "building",
        }));
      }) as typeof fetch;
      const operations = new VeryfrontAPIOperations(
        "https://api.example.com",
        "token",
        { maxRetries: 1, initialDelay: 0, maxDelay: 0 },
      );

      const result = await operations.beginReleaseAssetManifestBuild("project-slug", "rel-1");

      assertEquals(fetchCallCount, 2);
      assertEquals(result.state, "building");
    });

    it("uploads an asset with the content-hash header and raw bytes", async () => {
      let contentHashHeader: string | null = null;
      let contentTypeHeader: string | null = null;
      let requestedUrl = "";
      globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        requestedUrl = String(input);
        const headers = new Headers(init?.headers);
        contentHashHeader = headers.get("x-vf-content-hash");
        contentTypeHeader = headers.get("Content-Type");
        return Promise.resolve(
          new Response(JSON.stringify({ stored: true, existed: false }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }) as typeof fetch;

      const bytes = new TextEncoder().encode("export const x = 1;");
      const contentHash = await sha256Hex(bytes);
      const res = await createOps().uploadReleaseAsset(
        "project-slug",
        "rel-1",
        contentHash,
        "text/javascript",
        bytes,
      );

      assertStringIncludes(requestedUrl, "/releases/rel-1/asset-manifest/assets");
      assertEquals(contentHashHeader, contentHash);
      assertEquals(contentTypeHeader, "text/javascript");
      assertEquals(res.stored, true);
    });

    it("uploads an immutable byte snapshot even when the caller mutates its buffer", async () => {
      let uploaded = "";
      globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
        uploaded = new TextDecoder().decode(init?.body as Uint8Array);
        return Promise.resolve(Response.json({ stored: true, existed: false }));
      }) as typeof fetch;
      const bytes = new TextEncoder().encode("original");
      const contentHash = await sha256Hex(bytes);

      const upload = createOps().uploadReleaseAsset(
        "project-slug",
        "rel-1",
        contentHash,
        "text/plain",
        bytes,
      );
      bytes.fill(120);
      await upload;

      assertEquals(uploaded, "original");
    });

    it("captures the upload token before asynchronous integrity checks", async () => {
      let activeToken = "request-token-a";
      let authorization = "";
      globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
        authorization = new Headers(init?.headers).get("Authorization") ?? "";
        return Promise.resolve(Response.json({ stored: true, existed: false }));
      }) as typeof fetch;
      const bytes = new TextEncoder().encode("original");
      const contentHash = await sha256Hex(bytes);
      const operations = createOps(() => activeToken);

      const upload = operations.uploadReleaseAsset(
        "project-slug",
        "rel-1",
        contentHash,
        "text/plain",
        bytes,
      );
      activeToken = "request-token-b";
      await upload;

      assertEquals(authorization, "Bearer request-token-a");
    });

    it("uses the Uint8Array intrinsic when a byte subclass overrides slice", async () => {
      class HostileBytes extends Uint8Array {
        override slice(): Uint8Array<ArrayBuffer> {
          throw new Error("PRIVATE_BYTE_METHOD_CANARY");
        }
      }
      const bytes = new HostileBytes(new TextEncoder().encode("original"));
      const contentHash = await sha256Hex(new Uint8Array(bytes));
      let uploaded = "";
      globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
        uploaded = new TextDecoder().decode(init?.body as Uint8Array);
        return Promise.resolve(Response.json({ stored: true, existed: false }));
      }) as typeof fetch;

      await createOps().uploadReleaseAsset(
        "project-slug",
        "rel-1",
        contentHash,
        "text/plain",
        bytes,
      );

      assertEquals(uploaded, "original");
    });

    it("rejects invalid asset upload inputs before fetch", async () => {
      const secret = "PRIVATE_ASSET_INPUT_CANARY";
      let fetchCallCount = 0;
      globalThis.fetch = (() => {
        fetchCallCount++;
        return Promise.resolve(Response.json({ stored: true, existed: false }));
      }) as typeof fetch;

      const hashError = await assertRejects(() =>
        createOps().uploadReleaseAsset(
          "project-slug",
          "rel-1",
          secret,
          "text/javascript",
          new Uint8Array(),
        )
      );
      const bytesError = await assertRejects(() =>
        createOps().uploadReleaseAsset(
          "project-slug",
          "rel-1",
          "a".repeat(64),
          "text/javascript",
          secret as never,
        )
      );
      const mismatchError = await assertRejects(() =>
        createOps().uploadReleaseAsset(
          "project-slug",
          "rel-1",
          "a".repeat(64),
          "text/javascript",
          new TextEncoder().encode("different content"),
        )
      );
      const emptyHash = await sha256Hex(new Uint8Array());
      const contentTypeError = await assertRejects(() =>
        createOps().uploadReleaseAsset(
          "project-slug",
          "rel-1",
          emptyHash,
          "not-a-media-type",
          new Uint8Array(),
        )
      );
      const hostileBytes = new Proxy(new Uint8Array(), {
        getPrototypeOf() {
          throw new Error(secret);
        },
      });
      const proxyError = await assertRejects(() =>
        createOps().uploadReleaseAsset(
          "project-slug",
          "rel-1",
          emptyHash,
          "application/octet-stream",
          hostileBytes,
        )
      );

      assertEquals(fetchCallCount, 0);
      for (const error of [hashError, bytesError, mismatchError, contentTypeError, proxyError]) {
        assertInstanceOf(error, VeryfrontError);
        assertEquals(error.status, 400);
        assertEquals(JSON.stringify(error).includes(secret), false);
      }
    });

    it("rejects assets above the service upload limit before copying or hashing", async () => {
      class OversizedBytes extends Uint8Array {
        override slice(): Uint8Array<ArrayBuffer> {
          throw new Error("PRIVATE_OVERSIZED_COPY_CANARY");
        }
      }
      let fetchCallCount = 0;
      globalThis.fetch = (() => {
        fetchCallCount++;
        return Promise.resolve(Response.json({ stored: true, existed: false }));
      }) as typeof fetch;
      const oversized = new OversizedBytes(RELEASE_ASSET_MAX_SIZE_BYTES + 1);

      const error = await assertRejects(() =>
        createOps().uploadReleaseAsset(
          "project-slug",
          "rel-1",
          "a".repeat(64),
          "application/octet-stream",
          oversized,
        )
      );

      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.status, 413);
      assertEquals(fetchCallCount, 0);
      assertEquals(JSON.stringify(error).includes("PRIVATE_OVERSIZED_COPY_CANARY"), false);
    });

    it("accepts an asset exactly at the service upload limit", async () => {
      let fetchCallCount = 0;
      globalThis.fetch = (() => {
        fetchCallCount++;
        return Promise.resolve(Response.json({ stored: true, existed: false }));
      }) as typeof fetch;
      const bytes = new Uint8Array(RELEASE_ASSET_MAX_SIZE_BYTES);
      const contentHash = await sha256Hex(bytes);

      const result = await createOps().uploadReleaseAsset(
        "project-slug",
        "rel-1",
        contentHash,
        "application/octet-stream",
        bytes,
      );

      assertEquals(result.stored, true);
      assertEquals(fetchCallCount, 1);
    });

    it("PUTs the full manifest body", async () => {
      let method = "";
      let requestedUrl = "";
      stubJsonFetch((url, init) => {
        requestedUrl = url;
        method = init?.method ?? "GET";
        return { state: "ready", manifest_version: 1 };
      });

      const res = await createOps().putReleaseAssetManifest("project-slug", "rel-1", {
        schemaVersion: 1,
      });

      assertEquals(method, "PUT");
      assertStringIncludes(requestedUrl, "/releases/rel-1/asset-manifest");
      assertEquals(res.state, "ready");
    });

    it("rejects non-serializable manifests before fetch", async () => {
      const secret = "PRIVATE_MANIFEST_CANARY";
      let fetchCallCount = 0;
      globalThis.fetch = (() => {
        fetchCallCount++;
        return Promise.resolve(Response.json({ state: "ready", manifest_version: 1 }));
      }) as typeof fetch;
      const manifest: Record<string, unknown> = { secret };
      manifest.self = manifest;

      let error: unknown;
      try {
        await createOps().putReleaseAssetManifest("project", "release", manifest);
      } catch (caught) {
        error = caught;
      }

      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.status, 400);
      assertEquals(fetchCallCount, 0);
      assertEquals(JSON.stringify(error).includes(secret), false);
    });

    it("reports a failed state with sanitized error", async () => {
      const privateFailure = "PRIVATE_RELEASE_FAILURE_CANARY";
      let body: unknown;
      stubJsonFetch((_url, init) => {
        body = init?.body ? JSON.parse(String(init.body)) : undefined;
        return { state: "failed" };
      });

      await createOps().reportReleaseAssetManifestState(
        "project-slug",
        "rel-1",
        "failed",
        privateFailure,
      );

      assertEquals((body as { state: string }).state, "failed");
      assertEquals((body as { error: string }).error, "Release asset manifest build failed");
      assertEquals(JSON.stringify(body).includes(privateFailure), false);
    });

    it("fetches the manifest via GET", async () => {
      let requestedUrl = "";
      stubJsonFetch((url) => {
        requestedUrl = url;
        return { state: "ready", manifest_version: 1, manifest: { schemaVersion: 1 } };
      });

      const res = await createOps().getReleaseAssetManifest("project-slug", "rel-1");

      assertStringIncludes(requestedUrl, "/releases/rel-1/asset-manifest");
      assertEquals(res.state, "ready");
    });
  });
});
