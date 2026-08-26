import "#veryfront/schemas/_test-setup.ts";

import {
  assert,
  assertEquals,
  assertExists,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  __registerLogRecordEmitter,
  __resetLogRecordEmitterForTests,
  type LogEntry,
} from "#veryfront/utils/logger/logger.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import { JsonNonValueBytesTooLargeError } from "#veryfront/utils/response-body.ts";
import {
  createVeryfrontApiTransport,
  type TransportRequestInit,
} from "#veryfront/platform/adapters/veryfront-api-transport.ts";
import { VeryfrontAPIOperations } from "./operations.ts";
import { installMockFetch, restoreMockFetch } from "#veryfront/testing/mock-fetch.ts";

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

async function withoutAbortSignalAny<T>(operation: () => Promise<T>): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(AbortSignal, "any");
  Object.defineProperty(AbortSignal, "any", {
    configurable: true,
    value: undefined,
    writable: true,
  });
  try {
    return await operation();
  } finally {
    if (descriptor === undefined) Reflect.deleteProperty(AbortSignal, "any");
    else Object.defineProperty(AbortSignal, "any", descriptor);
  }
}

function observeAbortListenerBalance(signal: AbortSignal): {
  readonly counts: { added: number; removed: number };
  restore(): void;
} {
  const addDescriptor = Object.getOwnPropertyDescriptor(signal, "addEventListener");
  const removeDescriptor = Object.getOwnPropertyDescriptor(signal, "removeEventListener");
  const addEventListener = signal.addEventListener.bind(signal);
  const removeEventListener = signal.removeEventListener.bind(signal);
  const counts = { added: 0, removed: 0 };
  Object.defineProperty(signal, "addEventListener", {
    configurable: true,
    value: ((...args: Parameters<AbortSignal["addEventListener"]>) => {
      if (args[0] === "abort") counts.added++;
      return addEventListener(...args);
    }) as AbortSignal["addEventListener"],
  });
  Object.defineProperty(signal, "removeEventListener", {
    configurable: true,
    value: ((...args: Parameters<AbortSignal["removeEventListener"]>) => {
      if (args[0] === "abort") counts.removed++;
      return removeEventListener(...args);
    }) as AbortSignal["removeEventListener"],
  });
  return {
    counts,
    restore() {
      if (addDescriptor === undefined) Reflect.deleteProperty(signal, "addEventListener");
      else Object.defineProperty(signal, "addEventListener", addDescriptor);
      if (removeDescriptor === undefined) Reflect.deleteProperty(signal, "removeEventListener");
      else Object.defineProperty(signal, "removeEventListener", removeDescriptor);
    },
  };
}

describe("VeryfrontAPIOperations", () => {
  function stubJsonFetch(handler: (url: string, init?: RequestInit) => unknown): void {
    installMockFetch(
      ((input: RequestInfo | URL, init?: RequestInit) => {
        const body = handler(String(input), init);
        return Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }) as typeof fetch,
    );
  }

  afterEach(() => {
    restoreMockFetch();
    __resetLogRecordEmitterForTests();
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

      const detail = await createOps().getBranchFile(
        "project-slug",
        "main",
        "app/api/ag-ui/route.ts",
      );

      assertStringIncludes(requestedUrl, "include_server_functions=true");
      assertEquals(detail, {
        path: "app/api/ag-ui/route.ts",
        content: "export const POST = () => new Response();",
        id: "file-id",
        type: "function",
        size: 40,
      }, "branch file detail must map every payload field");
    });

    it("maps every environment file detail field returned by the API", async () => {
      stubJsonFetch(() => ({
        id: "file-id",
        version_id: "version-id",
        path: "app/api/agents/route.ts",
        content: "export const GET = () => new Response();",
        size: 39,
        type: "function",
        updated_at: "2026-04-23T00:00:00.000Z",
        environment_id: "environment-id",
        environment_name: "production",
        release_id: "release-id",
        release_version: "v1",
      }));

      const detail = await createOps().getEnvironmentFile(
        "project-slug",
        "production",
        "app/api/agents/route.ts",
      );

      assertEquals(detail, {
        path: "app/api/agents/route.ts",
        content: "export const GET = () => new Response();",
        id: "file-id",
        version_id: "version-id",
        release_id: "release-id",
        release_version: "v1",
      }, "environment file detail must map every payload field");
    });

    it("maps every release file detail field returned by the API", async () => {
      stubJsonFetch(() => ({
        id: "file-id",
        version_id: "version-id",
        path: "pages/api/articles-2.ts",
        content: "export default () => {}",
        size: 23,
        type: "function",
        updated_at: "2026-04-23T00:00:00.000Z",
        release_id: "release-id",
        release_version: "v1",
      }));

      const detail = await createOps().getReleaseFile(
        "project-slug",
        "release-id",
        "pages/api/articles-2.ts",
      );

      assertEquals(detail, {
        path: "pages/api/articles-2.ts",
        content: "export default () => {}",
        id: "file-id",
        version_id: "version-id",
        release_id: "release-id",
        release_version: "v1",
      }, "release file detail must map every payload field");
    });

    it("warn-logs normal 404s for branch file content reads", async () => {
      const entries: LogEntry[] = [];
      const originalWarn = console.warn;
      console.warn = () => {};
      __registerLogRecordEmitter((entry) => entries.push(entry));
      installMockFetch(
        (() =>
          Promise.resolve(
            new Response(JSON.stringify({ error: "Not found" }), {
              status: 404,
              statusText: "Not Found",
              headers: { "Content-Type": "application/json" },
            }),
          )) as typeof fetch,
      );

      try {
        await assertRejects(
          () => createOps().getBranchFile("project-slug", "main", "app/globals.css"),
          Error,
          "API request failed: 404 Not Found",
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
      installMockFetch(
        (() =>
          Promise.resolve(
            new Response(JSON.stringify({ error: "Not found" }), {
              status: 404,
              statusText: "Not Found",
              headers: { "Content-Type": "application/json" },
            }),
          )) as typeof fetch,
      );

      try {
        await assertRejects(
          () =>
            createOps().getBranchFile("project-slug", "main", "app/globals.css", {
              expectedMissing: true,
            }),
          Error,
          "API request failed: 404 Not Found",
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
      installMockFetch(
        (() =>
          Promise.resolve(
            new Response(JSON.stringify({ error: "Not found" }), {
              status: 404,
              statusText: "Not Found",
              headers: { "Content-Type": "application/json" },
            }),
          )) as typeof fetch,
      );

      try {
        await assertRejects(
          () =>
            createOps().getEnvironmentFile("project-slug", "production", "app/globals.css", {
              expectedMissing: true,
            }),
          Error,
          "API request failed: 404 Not Found",
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
      installMockFetch(
        (() =>
          Promise.resolve(
            new Response(JSON.stringify({ error: "Not found" }), {
              status: 404,
              statusText: "Not Found",
              headers: { "Content-Type": "application/json" },
            }),
          )) as typeof fetch,
      );

      try {
        await assertRejects(
          () =>
            createOps().getReleaseFile("project-slug", "release-id", "app/globals.css", {
              expectedMissing: true,
            }),
          Error,
          "API request failed: 404 Not Found",
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
      installMockFetch(
        (() =>
          Promise.resolve(
            new Response(JSON.stringify({ error: "Invalid authentication token" }), {
              status: 401,
              statusText: "Unauthorized",
              headers: { "Content-Type": "application/json" },
            }),
          )) as typeof fetch,
      );

      try {
        await assertRejects(
          () => createOps().getBranchFile("project-slug", "main", "app/globals.css"),
          Error,
          "API request failed: 401 Unauthorized",
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

  describe("lookupProjectByDomain", () => {
    it("strips the port and matches environment domains case-insensitively", async () => {
      let requestedUrl = "";
      stubJsonFetch((url) => {
        requestedUrl = url;
        return {
          id: "550e8400-e29b-41d4-a716-446655440000",
          name: "P",
          slug: "p",
          environments: [{
            id: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
            name: "production",
            domains: ["APP.EXAMPLE.COM"],
            active_release_id: "6ba7b811-9dad-11d1-80b4-00c04fd430c8",
          }],
        };
      });

      const result = await createOps().lookupProjectByDomain("app.example.com:8443");

      assertEquals(
        new URL(requestedUrl).pathname,
        "/projects/app.example.com",
        "the lookup path must drop the :port suffix",
      );
      assertEquals(
        result?.environment?.name,
        "production",
        "domain matching must be case-insensitive",
      );
      assertEquals(
        result?.release_id,
        "6ba7b811-9dad-11d1-80b4-00c04fd430c8",
        "the matching environment's active release must be returned",
      );
    });

    it("resolves to null when the domain has no project", async () => {
      const originalWarn = console.warn;
      console.warn = () => {};
      installMockFetch(
        (() =>
          Promise.resolve(
            new Response("{}", {
              status: 404,
              statusText: "Not Found",
              headers: { "Content-Type": "application/json" },
            }),
          )) as typeof fetch,
      );

      try {
        assertEquals(
          await createOps().lookupProjectByDomain("missing.example.com"),
          null,
          "a 404 lookup must resolve to null, not throw",
        );
      } finally {
        console.warn = originalWarn;
      }
    });

    it("rethrows non-404 upstream failures", async () => {
      const originalWarn = console.warn;
      console.warn = () => {};
      installMockFetch(
        (() =>
          Promise.resolve(
            new Response("{}", {
              status: 500,
              statusText: "Internal Server Error",
              headers: { "Content-Type": "application/json" },
            }),
          )) as typeof fetch,
      );
      const ops = new VeryfrontAPIOperations(
        "https://api.example.com",
        "token",
        { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
      );

      try {
        await assertRejects(
          () => ops.lookupProjectByDomain("app.example.com"),
          VeryfrontError,
          undefined,
          "a 500 must surface as an error instead of a null lookup",
        );
      } finally {
        console.warn = originalWarn;
      }
    });
  });

  describe("bounded file content", () => {
    it("returns exact UTF-8 bytes through the normal branch file endpoint", async () => {
      let requestedUrl = "";
      installMockFetch(
        ((input: RequestInfo | URL) => {
          requestedUrl = String(input);
          return Promise.resolve(
            new Response(JSON.stringify({ ignored: [1, 2, 3], content: "é" }), {
              headers: { "Content-Type": "application/json" },
            }),
          );
        }) as typeof fetch,
      );

      const bytes = await createOps().getBranchFileContentBytesWithinLimit(
        "project-slug",
        "main",
        "styles/manifest.json",
        2,
      );

      assertEquals([...bytes], [0xc3, 0xa9]);
      assertStringIncludes(requestedUrl, "/projects/project-slug/files/styles%2Fmanifest.json?");
      assertStringIncludes(requestedUrl, "branch=main");
      assertStringIncludes(requestedUrl, "include_server_functions=true");
    });

    it("rejects oversized content before JSON.parse and without retries", async () => {
      let fetchCalls = 0;
      let parseCalls = 0;
      const originalJsonParse = JSON.parse;
      installMockFetch(
        (() => {
          fetchCalls++;
          return Promise.resolve(new Response(JSON.stringify({ content: "xx" })));
        }) as typeof fetch,
      );
      JSON.parse = ((...args: Parameters<typeof JSON.parse>) => {
        parseCalls++;
        return Reflect.apply(originalJsonParse, JSON, args);
      }) as typeof JSON.parse;

      try {
        await assertRejects(
          () =>
            createOps().getBranchFileContentBytesWithinLimit(
              "project-slug",
              "main",
              "styles/manifest.json",
              1,
            ),
          RangeError,
          "1 UTF-8 bytes",
        );
      } finally {
        JSON.parse = originalJsonParse;
      }

      assertEquals(fetchCalls, 1);
      assertEquals(parseCalls, 0);
    });

    it("defensively copies and post-validates custom transport bytes", async () => {
      const operations = createOps();
      const mutable = operations as unknown as {
        transport: { request(): Promise<unknown> };
      };
      const source = new Uint8Array([1, 2]);
      mutable.transport = { request: () => Promise.resolve(source) };

      const bytes = await operations.getBranchFileContentBytesWithinLimit(
        "project-slug",
        "main",
        "manifest.json",
        2,
      );
      source[0] = 9;
      assertEquals([...bytes], [1, 2]);

      mutable.transport = { request: () => Promise.resolve(new Uint8Array([1, 2, 3])) };
      await assertRejects(
        () =>
          operations.getBranchFileContentBytesWithinLimit(
            "project-slug",
            "main",
            "manifest.json",
            2,
          ),
        RangeError,
        "exceeds 2 bytes",
      );
    });
  });

  describe("bounded transport failures", () => {
    it("propagates caller cancellation to the active fetch without retrying", async () => {
      let fetchCalls = 0;
      let requestStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        requestStarted = resolve;
      });
      installMockFetch(
        ((_input: RequestInfo | URL, init?: RequestInit) => {
          fetchCalls++;
          const signal = init?.signal;
          requestStarted();
          return new Promise<Response>((_resolve, reject) => {
            if (!signal) return;
            const rejectAbort = () => reject(signal.reason);
            if (signal.aborted) rejectAbort();
            else signal.addEventListener("abort", rejectAbort, { once: true });
          });
        }) as typeof fetch,
      );
      const transport = createVeryfrontApiTransport<unknown>({
        baseUrl: "https://api.example.com",
        getToken: () => "token",
        retry: { maxRetries: 2, initialDelay: 0, maxDelay: 0 },
      });
      const controller = new AbortController();
      const request = transport.request("/cancelled", { signal: controller.signal });
      await started;

      controller.abort(new Error("caller cancelled"));

      await assertRejects(() => request, Error, "caller cancelled");
      assertEquals(fetchCalls, 1);
    });

    it("propagates caller cancellation when AbortSignal.any is unavailable", async () => {
      await withoutAbortSignalAny(async () => {
        let observedSignal: AbortSignal | undefined;
        let markStarted!: () => void;
        const started = new Promise<void>((resolve) => {
          markStarted = resolve;
        });
        installMockFetch(
          ((_input: RequestInfo | URL, init?: RequestInit) => {
            observedSignal = init?.signal ?? undefined;
            markStarted();
            return new Promise<Response>((_resolve, reject) => {
              observedSignal?.addEventListener(
                "abort",
                () => reject(observedSignal?.reason),
                { once: true },
              );
            });
          }) as typeof fetch,
        );
        const transport = createVeryfrontApiTransport<unknown>({
          baseUrl: "https://api.example.com",
          getToken: () => "token",
          retry: { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
        });
        const controller = new AbortController();
        const observation = observeAbortListenerBalance(controller.signal);
        try {
          const cancellation = new Error("compat cancellation");
          const request = transport.request("/cancelled", { signal: controller.signal });
          await started;

          controller.abort(cancellation);

          assertEquals(observedSignal?.reason, cancellation);
          await assertRejects(() => request, Error, "compat cancellation");
          assertEquals(observation.counts, { added: 1, removed: 1 });
        } finally {
          observation.restore();
        }
      });
    });

    it("detaches compatibility listeners after a successful request", async () => {
      await withoutAbortSignalAny(async () => {
        installMockFetch((() => Promise.resolve(new Response("{}"))) as typeof fetch);
        const caller = new AbortController();
        const observation = observeAbortListenerBalance(caller.signal);
        try {
          const transport = createVeryfrontApiTransport<unknown>({
            baseUrl: "https://api.example.com",
            getToken: () => "token",
            retry: { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
            timeoutMs: 1_000,
          });

          await transport.request("/ok", { signal: caller.signal });

          assertEquals(observation.counts, { added: 1, removed: 1 });
        } finally {
          observation.restore();
        }
      });
    });

    it("detaches compatibility listeners after a non-abort failure", async () => {
      await withoutAbortSignalAny(async () => {
        installMockFetch((() => Promise.reject(new Error("network failed"))) as typeof fetch);
        const caller = new AbortController();
        const observation = observeAbortListenerBalance(caller.signal);
        try {
          const transport = createVeryfrontApiTransport<unknown>({
            baseUrl: "https://api.example.com",
            getToken: () => "token",
            retry: { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
            timeoutMs: 1_000,
          });

          await assertRejects(
            () => transport.request("/failed", { signal: caller.signal }),
            VeryfrontError,
            "network failed",
          );

          assertEquals(observation.counts, { added: 1, removed: 1 });
        } finally {
          observation.restore();
        }
      });
    });

    it("balances compatibility listeners across retry attempts", async () => {
      await withoutAbortSignalAny(async () => {
        let fetchCalls = 0;
        installMockFetch(
          (() => {
            fetchCalls++;
            return fetchCalls === 1
              ? Promise.reject(new Error("retryable failure"))
              : Promise.resolve(new Response("{}"));
          }) as typeof fetch,
        );
        const caller = new AbortController();
        const observation = observeAbortListenerBalance(caller.signal);
        try {
          const transport = createVeryfrontApiTransport<unknown>({
            baseUrl: "https://api.example.com",
            getToken: () => "token",
            retry: { maxRetries: 1, initialDelay: 0, maxDelay: 0 },
            timeoutMs: 1_000,
          });

          await transport.request("/retried", { signal: caller.signal });

          assertEquals(fetchCalls, 2);
          assertEquals(observation.counts.added, observation.counts.removed);
          assert(observation.counts.added >= fetchCalls);
        } finally {
          observation.restore();
        }
      });
    });

    it("reserves worst-case JSON escape bytes outside the non-value response budget", async () => {
      const body = '{"content":"\\u0000\\u0000"}';
      assertEquals(new TextEncoder().encode(body).byteLength, 26);
      installMockFetch((() => Promise.resolve(new Response(body))) as typeof fetch);
      const transport = createVeryfrontApiTransport<unknown>({
        baseUrl: "https://api.example.com",
        getToken: () => "token",
        retry: { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
      });

      const result = await transport.request("/bounded", {
        // The compact document has 14 non-value bytes and the two admitted
        // NULs use the exact worst case of six wire bytes each.
        maxResponseBytes: 14,
        jsonStringFieldWithinLimit: { fieldName: "content", maximumBytes: 2 },
      });

      assertEquals(result, new Uint8Array([0, 0]));
    });

    it("does not let unused string headroom enlarge the non-value response budget", async () => {
      const body = '{"content":"","x":0}';
      assertEquals(new TextEncoder().encode(body).byteLength, 20);
      let fetchCalls = 0;
      installMockFetch(
        (() => {
          fetchCalls++;
          return Promise.resolve(new Response(body));
        }) as typeof fetch,
      );
      const transport = createVeryfrontApiTransport<unknown>({
        baseUrl: "https://api.example.com",
        getToken: () => "token",
        retry: { maxRetries: 2, initialDelay: 0, maxDelay: 0 },
      });

      const error = await assertRejects(
        () =>
          transport.request("/bounded", {
            // The selected value is empty, so all 20 bytes count against the
            // independent 14-byte non-value policy despite the 26-byte hard cap.
            maxResponseBytes: 14,
            jsonStringFieldWithinLimit: { fieldName: "content", maximumBytes: 2 },
          }),
        VeryfrontError,
        "invalid bounded JSON content",
      );

      assertEquals(
        (error as VeryfrontError).cause instanceof JsonNonValueBytesTooLargeError,
        true,
      );
      assertEquals(fetchCalls, 1);
    });

    it("retries a body read aborted by the per-attempt timeout", async () => {
      let fetchCalls = 0;
      let cancellations = 0;
      installMockFetch(
        (() => {
          fetchCalls++;
          return Promise.resolve(
            new Response(
              new ReadableStream<Uint8Array>({
                pull() {
                  return new Promise<void>(() => {});
                },
                cancel() {
                  cancellations++;
                },
              }),
            ),
          );
        }) as typeof fetch,
      );
      const transport = createVeryfrontApiTransport<unknown>({
        baseUrl: "https://api.example.com",
        getToken: () => "token",
        retry: { maxRetries: 1, initialDelay: 0, maxDelay: 0 },
        timeoutMs: 5,
      });

      await assertRejects(
        () =>
          transport.request("/bounded", {
            maxResponseBytes: 128,
            jsonStringFieldWithinLimit: { fieldName: "content", maximumBytes: 8 },
          }),
        VeryfrontError,
      );

      assertEquals(fetchCalls, 2);
      assertEquals(cancellations, 2);
    });

    it("preserves a 400 status when its diagnostic body is malformed UTF-8", async () => {
      let fetchCalls = 0;
      installMockFetch(
        (() => {
          fetchCalls++;
          return Promise.resolve(
            new Response(new Uint8Array([0xc3, 0x28]), {
              status: 400,
              statusText: "Bad Request",
            }),
          );
        }) as typeof fetch,
      );
      const transport = createVeryfrontApiTransport<unknown>({
        baseUrl: "https://api.example.com",
        getToken: () => "token",
        retry: { maxRetries: 2, initialDelay: 0, maxDelay: 0 },
      });

      const error = await assertRejects(
        () => transport.request("/invalid"),
        VeryfrontError,
        "API request failed: 400 Bad Request",
      );

      assertEquals((error as VeryfrontError).status, 400);
      assertEquals(fetchCalls, 1);
    });

    it("retries a 500 even when its diagnostic body is malformed UTF-8", async () => {
      let fetchCalls = 0;
      installMockFetch(
        (() => {
          fetchCalls++;
          return Promise.resolve(
            new Response(new Uint8Array([0xc3, 0x28]), {
              status: 500,
              statusText: "Internal Server Error",
            }),
          );
        }) as typeof fetch,
      );
      const transport = createVeryfrontApiTransport<unknown>({
        baseUrl: "https://api.example.com",
        getToken: () => "token",
        retry: { maxRetries: 1, initialDelay: 0, maxDelay: 0 },
      });

      await assertRejects(
        () => transport.request("/failed"),
        VeryfrontError,
        "API request failed after 1 retries",
      );

      assertEquals(fetchCalls, 2);
    });

    it("rejects invalid bounded options before fetching", async () => {
      let fetchCalls = 0;
      installMockFetch(
        (() => {
          fetchCalls++;
          return Promise.resolve(new Response("{}"));
        }) as typeof fetch,
      );
      const transport = createVeryfrontApiTransport<unknown>({
        baseUrl: "https://api.example.com",
        getToken: () => "token",
        retry: { maxRetries: 2, initialDelay: 0, maxDelay: 0 },
      });
      const invalidOptions = [
        { maxResponseBytes: 0 },
        { maxResponseBytes: Number.MAX_SAFE_INTEGER + 1 },
        { jsonStringFieldWithinLimit: { fieldName: "", maximumBytes: 1 } },
        { jsonStringFieldWithinLimit: { fieldName: "content", maximumBytes: 1.5 } },
        {
          maxResponseBytes: 1,
          jsonStringFieldWithinLimit: {
            fieldName: "content",
            maximumBytes: Number.MAX_SAFE_INTEGER,
          },
        },
      ] as TransportRequestInit[];

      for (const init of invalidOptions) {
        await assertRejects(() => transport.request("/invalid", init));
      }
      assertEquals(fetchCalls, 0);
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

    it("uploads an asset with the content-hash header and raw bytes", async () => {
      let contentHashHeader: string | null = null;
      let contentTypeHeader: string | null = null;
      let requestedUrl = "";
      installMockFetch(
        ((input: RequestInfo | URL, init?: RequestInit) => {
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
        }) as typeof fetch,
      );

      const bytes = new TextEncoder().encode("export const x = 1;");
      const res = await createOps().uploadReleaseAsset(
        "project-slug",
        "rel-1",
        "a".repeat(64),
        "text/javascript",
        bytes,
      );

      assertStringIncludes(requestedUrl, "/releases/rel-1/asset-manifest/assets");
      assertEquals(contentHashHeader, "a".repeat(64));
      assertEquals(contentTypeHeader, "text/javascript");
      assertEquals(res.stored, true);
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

    it("reports a failed state with sanitized error", async () => {
      let body: unknown;
      stubJsonFetch((_url, init) => {
        body = init?.body ? JSON.parse(String(init.body)) : undefined;
        return { state: "failed" };
      });

      await createOps().reportReleaseAssetManifestState(
        "project-slug",
        "rel-1",
        "failed",
        "boom",
      );

      assertEquals((body as { state: string }).state, "failed");
      assertEquals((body as { error: string }).error, "boom");
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

  describe("dependency artifact build operations", () => {
    it("uploads an attempt asset with raw hash-verified bytes", async () => {
      let requestedUrl = "";
      let method = "";
      let contentType = "";
      let body: BodyInit | null | undefined;
      installMockFetch(
        ((input: RequestInfo | URL, init?: RequestInit) => {
          requestedUrl = String(input);
          method = init?.method ?? "GET";
          contentType = new Headers(init?.headers).get("content-type") ?? "";
          body = init?.body;
          return Promise.resolve(
            new Response(JSON.stringify({ stored: true, existed: false }), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          );
        }) as typeof fetch,
      );
      const bytes = new TextEncoder().encode("export const value = 42;");
      const contentHash = await crypto.subtle.digest("SHA-256", bytes).then((digest) =>
        [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("")
      );

      const result = await createOps().uploadDependencyArtifactAsset(
        "11111111-1111-4111-8111-111111111111",
        2,
        contentHash,
        "text/javascript",
        bytes,
      );

      assertEquals(method, "PUT");
      assertStringIncludes(
        requestedUrl,
        `/dependency-artifacts/11111111-1111-4111-8111-111111111111/attempts/2/assets/${contentHash}`,
      );
      assertEquals(contentType, "text/javascript");
      assertEquals(body, bytes);
      assertEquals(result, { stored: true, existed: false });
    });

    it("rejects a local content hash mismatch before transport", async () => {
      let fetchCalls = 0;
      installMockFetch(
        ((_input: RequestInfo | URL, _init?: RequestInit) => {
          fetchCalls++;
          return Promise.resolve(new Response("{}"));
        }) as typeof fetch,
      );

      await assertRejects(
        () =>
          createOps().uploadDependencyArtifactAsset(
            "11111111-1111-4111-8111-111111111111",
            2,
            "a".repeat(64),
            "text/javascript",
            new TextEncoder().encode("different"),
          ),
        Error,
        "content hash",
      );
      assertEquals(fetchCalls, 0);
    });

    it("reports the complete ready graph to the lease-bound result endpoint", async () => {
      let requestedUrl = "";
      let method = "";
      let body: unknown;
      stubJsonFetch((url, init) => {
        requestedUrl = url;
        method = init?.method ?? "GET";
        body = init?.body ? JSON.parse(String(init.body)) : undefined;
        return { accepted: true, state: "ready" };
      });
      const hash = "b".repeat(64);

      const result = await createOps().reportDependencyArtifactBuildResult(
        "11111111-1111-4111-8111-111111111111",
        2,
        {
          outcome: "ready",
          graph: {
            graph_schema_version: 1,
            root_content_hash: hash,
            assets: [{
              content_hash: hash,
              content_type: "text/javascript",
              size: 42,
            }],
          },
        },
      );

      assertEquals(method, "POST");
      assertStringIncludes(
        requestedUrl,
        "/dependency-artifacts/11111111-1111-4111-8111-111111111111/attempts/2/result",
      );
      assertEquals((body as { outcome: string }).outcome, "ready");
      assertEquals(result, { accepted: true, state: "ready" });
    });
  });
});
