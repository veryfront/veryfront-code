import "#veryfront/schemas/_test-setup.ts";
import "#veryfront/transforms/plugins/__tests__/code-parser-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { clearReactVersionCache } from "#veryfront/transforms/esm/package-registry.ts";
import { refreshLoggerConfig } from "#veryfront/utils";
import { register, tryResolve } from "#veryfront/extensions/contracts.ts";
import type { Bundler } from "#veryfront/extensions/bundler/bundler.ts";
import {
  getBrowserModuleEndpointStatsForTesting,
  handleRSCEndpoint,
  resetBrowserModuleEndpointStateForTesting,
} from "./endpoint-router.ts";
import {
  createMockAdapter,
  makeParams,
  noExperimentalConfig,
  rscDisabledConfig,
  rscEnabledConfig,
} from "./endpoint-router.test-helpers.ts";

describe("server/services/rsc/endpoints/endpoint-router", () => {
  afterEach(async () => {
    resetBrowserModuleEndpointStateForTesting();
    const esbuild = await import("veryfront/extensions/bundler");
    await esbuild.stop();
  });

  describe("non-RSC paths", () => {
    it("returns null for paths not starting with /_veryfront/rsc/", async () => {
      const result = await handleRSCEndpoint(makeParams({ pathname: "/some/other/path" }));
      assertEquals(result, null);
    });

    it("returns null for root path", async () => {
      const result = await handleRSCEndpoint(makeParams({ pathname: "/" }));
      assertEquals(result, null);
    });

    it("returns null for similar but not matching prefix", async () => {
      const result = await handleRSCEndpoint(
        makeParams({ pathname: "/_veryfront/rscx/something" }),
      );
      assertEquals(result, null);
    });

    it("returns null for partial prefix /_veryfront/rsc (no trailing slash)", async () => {
      const result = await handleRSCEndpoint(makeParams({ pathname: "/_veryfront/rsc" }));
      assertEquals(result, null);
    });
  });

  describe("flight_page (deprecated)", () => {
    it("returns 410 Gone regardless of RSC config", async () => {
      const result = await handleRSCEndpoint(
        makeParams({ pathname: "/_veryfront/rsc/flight_page" }),
      );
      assertEquals(result instanceof Response, true);
      assertEquals(result!.status, 410);
      const body = await result!.text();
      assertStringIncludes(body, "Flight endpoint removed");
    });

    it("returns 410 Gone even when RSC is enabled", async () => {
      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/flight_page",
          config: rscEnabledConfig,
        }),
      );
      assertEquals(result!.status, 410);
    });

    it("returns 410 Gone even when RSC is disabled", async () => {
      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/flight_page",
          config: rscDisabledConfig,
        }),
      );
      assertEquals(result!.status, 410);
    });
  });

  describe("RSC not enabled", () => {
    it("returns null for RSC sub-endpoints when config has rsc: false", async () => {
      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/probe",
          config: rscDisabledConfig,
        }),
      );
      assertEquals(result, null);
    });

    it("returns null for RSC sub-endpoints when no config provided", async () => {
      const result = await handleRSCEndpoint(
        makeParams({ pathname: "/_veryfront/rsc/probe" }),
      );
      assertEquals(result, null);
    });

    it("returns null for RSC sub-endpoints when no experimental section", async () => {
      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/probe",
          config: noExperimentalConfig,
        }),
      );
      assertEquals(result, null);
    });

    it("returns null for stream endpoint when RSC disabled", async () => {
      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/stream",
          config: rscDisabledConfig,
        }),
      );
      assertEquals(result, null);
    });

    it("keeps the module endpoint available when RSC disabled", async () => {
      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/module",
          config: rscDisabledConfig,
        }),
      );
      assertEquals(result instanceof Response, true);
      assertEquals(result!.status, 400);
    });
  });

  describe("probe endpoint", () => {
    it("returns JSON {ok: true, rsc: true} when RSC enabled", async () => {
      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/probe",
          config: rscEnabledConfig,
        }),
      );
      assertEquals(result instanceof Response, true);
      assertEquals(result!.status, 200);
      assertEquals(result!.headers.get("content-type"), "application/json");
      const body = await result!.json();
      assertEquals(body, { ok: true, rsc: true });
    });
  });

  describe("render endpoint", () => {
    it("renders components from the request filesystem adapter", async () => {
      const pagePath = "/virtual/project/app/page.tsx";
      const adapter = createMockAdapter({
        stat: (path) =>
          path === pagePath
            ? Promise.resolve({
              isFile: true,
              isDirectory: false,
              size: 1,
              mtime: null,
            })
            : Promise.reject(new Error("not found")),
        readFile: (path) =>
          path === pagePath
            ? Promise.resolve("export default function Page() { return null; }")
            : Promise.reject(new Error("not found")),
      });

      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/render",
          req: new Request("http://localhost/_veryfront/rsc/render"),
          projectDir: "/virtual/project",
          projectId: "virtual-project",
          contentSourceId: "preview-main",
          adapter,
          config: rscEnabledConfig,
          isLocalProject: false,
          mode: "development",
        }),
      );

      assertEquals(result instanceof Response, true);
      assertEquals(result!.status, 200);
    });
  });

  describe("action endpoint", () => {
    it("rejects non-POST with 405", async () => {
      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/action",
          config: rscEnabledConfig,
          req: new Request("http://localhost/_veryfront/rsc/action", { method: "GET" }),
        }),
      );
      assertEquals(result instanceof Response, true);
      assertEquals(result!.status, 405);
      const body = await result!.text();
      assertStringIncludes(body, "Method Not Allowed");
    });

    it("rejects PUT with 405", async () => {
      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/action",
          config: rscEnabledConfig,
          req: new Request("http://localhost/_veryfront/rsc/action", { method: "PUT" }),
        }),
      );
      assertEquals(result!.status, 405);
    });

    it("returns a sanitized 500 when action lookup fails", async () => {
      const sensitiveMessage = "action storage unavailable: credential=SENSITIVE_LOG_MARKER";
      const adapter = createMockAdapter({
        stat: () => Promise.reject(new Error(sensitiveMessage)),
      });
      const originalConsoleError = console.error;
      let errorLog = "";
      console.error = (...args: unknown[]) => {
        errorLog += args.map(String).join(" ");
      };

      let result: Response | null;
      try {
        result = await handleRSCEndpoint(
          makeParams({
            pathname: "/_veryfront/rsc/action",
            config: rscEnabledConfig,
            adapter,
            req: new Request("http://localhost/_veryfront/rsc/action", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ id: "save", args: [] }),
            }),
          }),
        );
      } finally {
        console.error = originalConsoleError;
      }

      assertEquals(result?.status, 500);
      const body = await result!.json();
      assertEquals(body, { ok: false, error: "action failed" });
      assertEquals(JSON.stringify(body).includes(sensitiveMessage), false);
      assertEquals(errorLog.includes(sensitiveMessage), false);
    });
  });

  describe("module endpoint", () => {
    it("returns 400 when missing rel param", async () => {
      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/module",
          config: rscEnabledConfig,
          req: new Request("http://localhost/_veryfront/rsc/module"),
        }),
      );
      assertEquals(result instanceof Response, true);
      assertEquals(result!.status, 400);
      const body = await result!.text();
      assertStringIncludes(body, "Missing rel query parameter");
    });

    it("rejects unsupported hybrid CommonJS and ESM JSX suffixes", async () => {
      for (const extension of [".mtsx", ".ctsx", ".mjsx", ".cjsx"] as const) {
        const filePath = `/tmp/test-project/app/Unsupported${extension}`;
        const adapter = createMockAdapter({
          knownFiles: [filePath],
          exists: (path: string) => Promise.resolve(path === filePath),
          readFile: () => Promise.resolve('"use client"; export default null;'),
        });

        const result = await handleRSCEndpoint(
          makeParams({
            pathname: "/_veryfront/rsc/module",
            config: rscDisabledConfig,
            req: new Request(
              `http://localhost/_veryfront/rsc/module?rel=${
                encodeURIComponent(`app/Unsupported${extension}`)
              }`,
            ),
            adapter,
          }),
        );

        assertEquals(result?.status, 404);
      }
    });

    it("does not expose discovered Pages Router modules", async () => {
      const helperPath = "/tmp/test-project/pages/helper.ts";
      const adapter = createMockAdapter({
        exists: (path: string) => Promise.resolve(path === helperPath),
        readFile: (path: string) =>
          Promise.resolve(
            path === helperPath ? "export const secret = 'PAGES_HELPER_MUST_STAY_PRIVATE';" : "",
          ),
        stat: (path: string) => {
          if (path === "/tmp/test-project/pages") {
            return Promise.resolve({
              isFile: false,
              isDirectory: true,
              size: 0,
              mtime: null,
            });
          }
          if (path === helperPath) {
            return Promise.resolve({
              isFile: true,
              isDirectory: false,
              size: 1,
              mtime: null,
            });
          }
          return Promise.reject(new Deno.errors.NotFound("not found"));
        },
        readDir: async function* (path: string) {
          if (path === "/tmp/test-project/pages") {
            yield {
              name: "helper.ts",
              isFile: true,
              isDirectory: false,
              isSymlink: false,
            };
          }
        },
      });

      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/module",
          config: rscDisabledConfig,
          req: new Request(
            "http://localhost/_veryfront/rsc/module?rel=pages%2Fhelper.ts",
          ),
          adapter,
          projectDir: "/tmp/test-project",
        }),
      );

      assertEquals(result?.status, 404);
      assertEquals((await result!.text()).includes("PAGES_HELPER_MUST_STAY_PRIVATE"), false);
    });

    it("rejects symlinked app modules before reading their target content", async () => {
      const modulePath = "/tmp/test-project/app/Counter.client.ts";
      const reads: string[] = [];
      const adapter = createMockAdapter({
        exists: (path: string) => Promise.resolve(path === modulePath),
        readFile: (path: string) => {
          reads.push(path);
          return Promise.resolve(
            "'use client';\nexport const leaked = 'OUTSIDE_PROJECT_MARKER';",
          );
        },
        readDir: async function* (path: string) {
          if (path === "/tmp/test-project") {
            yield {
              name: "app",
              isFile: false,
              isDirectory: true,
              isSymlink: false,
            };
          }
          if (path === "/tmp/test-project/app") {
            yield {
              name: "Counter.client.ts",
              isFile: false,
              isDirectory: false,
              isSymlink: true,
            };
          }
        },
      });

      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/module",
          config: rscDisabledConfig,
          req: new Request(
            "http://localhost/_veryfront/rsc/module?rel=app%2FCounter.client.ts",
          ),
          adapter,
          projectDir: "/tmp/test-project",
        }),
      );

      assertEquals(result?.status, 404);
      assertEquals(reads, []);
      assertEquals((await result!.text()).includes("OUTSIDE_PROJECT_MARKER"), false);
    });

    it("fails closed when app path metadata cannot be inspected", async () => {
      const modulePath = "/tmp/test-project/app/Counter.ts";
      const reads: string[] = [];
      const adapter = createMockAdapter({
        exists: (path: string) => Promise.resolve(path === modulePath),
        readFile: (path: string) => {
          reads.push(path);
          return Promise.resolve("'use client';\nexport default function Counter() {}");
        },
        readDir: () => ({
          [Symbol.asyncIterator]: () => ({
            next: () => Promise.reject(new Error("metadata unavailable")),
          }),
        }),
      });

      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/module",
          config: rscDisabledConfig,
          req: new Request(
            "http://localhost/_veryfront/rsc/module?rel=app%2FCounter.ts",
          ),
          adapter,
          projectDir: "/tmp/test-project",
        }),
      );

      assertEquals(result?.status, 404);
      assertEquals(reads, []);
    });

    it("serves declared client modules from the app root", async () => {
      const adapter = createMockAdapter({
        knownFiles: ["/tmp/test-project/app/hello.js"],
        exists: (path: string) => Promise.resolve(path === "/tmp/test-project/app/hello.js"),
        readFile: () => Promise.resolve("'use client';\nconsole.log('hello');"),
      });

      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/module",
          config: rscEnabledConfig,
          req: new Request("http://localhost/_veryfront/rsc/module?rel=app%2Fhello.js"),
          adapter,
          projectDir: "/tmp/test-project",
        }),
      );
      assertEquals(result instanceof Response, true);
      assertEquals(result!.status, 200);
      assertEquals(
        result!.headers.get("content-type"),
        "application/javascript; charset=utf-8",
      );
      const body = await result!.text();
      assertStringIncludes(body, 'console.log("hello")');
      assertEquals(body.includes("/tmp/test-project"), false);
    });

    it("bundles tsx modules into browser-ready javascript", async () => {
      const adapter = createMockAdapter({
        knownFiles: ["/tmp/test-project/app/widget.tsx"],
        exists: (path: string) => Promise.resolve(path.includes("/app/widget.tsx")),
        readFile: () =>
          Promise.resolve(
            [
              '"use client";',
              'import React from "react";',
              "export default function Widget(){",
              '  return <div data-kind="widget">Hello</div>;',
              "}",
            ].join("\n"),
          ),
      });

      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/module",
          config: rscEnabledConfig,
          req: new Request("http://localhost/_veryfront/rsc/module?rel=widget.tsx"),
          adapter,
          projectDir: "/tmp/test-project",
        }),
      );

      assertEquals(result instanceof Response, true);
      assertEquals(result!.status, 200);
      const body = await result!.text();
      assertStringIncludes(body, 'from "react/jsx-runtime"');
      assertStringIncludes(body, '"data-kind": "widget"');
    });

    it("does not expose reserved server components or their imports as browser modules", async () => {
      const reads: string[] = [];
      const files: Record<string, string> = {
        "/tmp/test-project/app/layout.tsx": [
          'import { secret } from "./private.ts";',
          'import "../globals.css";',
          "export default function Layout({ children }: { children: React.ReactNode }) {",
          "  return <html data-secret={secret}><body>{children}</body></html>;",
          "}",
        ].join("\n"),
        "/tmp/test-project/app/private.ts":
          "'use server';\nexport const secret = 'must-not-reach-browser';",
        "/tmp/test-project/app/template.tsx":
          "export default function Template({ children }) { return children; }",
        "/tmp/test-project/app/error.tsx": "export default function ErrorView() { return null; }",
        "/tmp/test-project/app/loading.tsx": "export default function Loading() { return null; }",
        "/tmp/test-project/app/not-found.tsx":
          "export default function NotFound() { return null; }",
        "/tmp/test-project/globals.css": '@import "tailwindcss";',
      };
      const adapter = createMockAdapter({
        knownFiles: Object.keys(files),
        exists: (path: string) => Promise.resolve(path in files),
        readFile: (path: string) => {
          reads.push(path);
          return Promise.resolve(files[path] ?? "");
        },
      });

      for (const fileName of ["layout", "template", "error", "loading", "not-found"]) {
        const result = await handleRSCEndpoint(
          makeParams({
            pathname: "/_veryfront/rsc/module",
            config: rscDisabledConfig,
            req: new Request(
              `http://localhost/_veryfront/rsc/module?rel=app%2F${fileName}.tsx`,
            ),
            adapter,
            projectDir: "/tmp/test-project",
          }),
        );

        assertEquals(result instanceof Response, true);
        assertEquals(result!.status, 404);
      }

      assertEquals(reads.includes("/tmp/test-project/app/private.ts"), false);
      assertEquals(reads.length, 5);
    });

    it("serves analyzer-confirmed client layouts for legitimate hydration", async () => {
      const files: Record<string, string> = {
        "/tmp/test-project/app/layout.tsx": [
          '"use client";',
          'import "../globals.css";',
          "export default function Layout({ children }: { children: React.ReactNode }) {",
          "  return <div data-layout>{children}</div>;",
          "}",
        ].join("\n"),
        "/tmp/test-project/globals.css": '@import "tailwindcss";',
      };
      const adapter = createMockAdapter({
        knownFiles: Object.keys(files),
        exists: (path: string) => Promise.resolve(path in files),
        readFile: (path: string) => Promise.resolve(files[path] ?? ""),
      });

      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/module",
          config: rscDisabledConfig,
          req: new Request("http://localhost/_veryfront/rsc/module?rel=app%2Flayout.tsx"),
          adapter,
          projectDir: "/tmp/test-project",
        }),
      );

      assertEquals(result instanceof Response, true);
      assertEquals(result!.status, 200);
      const body = await result!.text();
      assertStringIncludes(body, "function Layout");
      assertEquals(body.includes("tailwindcss"), false);
    });

    it("rejects client entries that import use-server dependencies", async () => {
      const secretMarker = "SERVER_ONLY_TRANSITIVE_MARKER";
      const files: Record<string, string> = {
        "/tmp/test-project/app/Counter.tsx": [
          '"use client";',
          'import { serverSecret } from "./server-secret.ts";',
          "export default function Counter() {",
          "  return <button data-secret={serverSecret}>Count</button>;",
          "}",
        ].join("\n"),
        "/tmp/test-project/app/server-secret.ts": [
          '"use server";',
          `export const serverSecret = "${secretMarker}";`,
        ].join("\n"),
      };
      const adapter = createMockAdapter({
        knownFiles: Object.keys(files),
        exists: (path: string) => Promise.resolve(path in files),
        readFile: (path: string) => Promise.resolve(files[path] ?? ""),
      });

      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/module",
          config: rscDisabledConfig,
          req: new Request(
            "http://localhost/_veryfront/rsc/module?rel=app%2FCounter.tsx",
          ),
          adapter,
          projectDir: "/tmp/test-project",
        }),
      );

      assertEquals(result instanceof Response, true);
      const body = await result!.text();
      assertEquals(body.includes(secretMarker), false);
      assertEquals(result!.status, 500);
    });

    it("rejects entries with conflicting client and server directives", async () => {
      const secretMarker = "CONFLICTING_BOUNDARY_MARKER";
      const filePath = "/tmp/test-project/app/Conflicting.tsx";
      const adapter = createMockAdapter({
        knownFiles: [filePath],
        exists: (path: string) => Promise.resolve(path === filePath),
        readFile: () =>
          Promise.resolve(
            [
              '"use client";',
              '"use server";',
              `export const marker = "${secretMarker}";`,
            ].join("\n"),
          ),
      });

      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/module",
          config: rscDisabledConfig,
          req: new Request(
            "http://localhost/_veryfront/rsc/module?rel=app%2FConflicting.tsx",
          ),
          adapter,
          projectDir: "/tmp/test-project",
        }),
      );

      assertEquals(result instanceof Response, true);
      const body = await result!.text();
      assertEquals(body.includes(secretMarker), false);
      assertEquals(result!.status, 404);
    });

    it("returns 404 when file not found in any candidate root", async () => {
      const adapter = createMockAdapter({
        exists: () => Promise.resolve(false),
      });

      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/module",
          config: rscEnabledConfig,
          req: new Request("http://localhost/_veryfront/rsc/module?rel=nonexistent.js"),
          adapter,
          projectDir: "/tmp/test-project",
        }),
      );
      assertEquals(result instanceof Response, true);
      assertEquals(result!.status, 404);
    });

    it("returns 400 for path traversal attempts without touching the filesystem", async () => {
      const attemptedPaths: string[] = [];
      const adapter = createMockAdapter({
        exists: (path: string) => {
          attemptedPaths.push(path);
          return Promise.resolve(true);
        },
      });

      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/module",
          config: rscEnabledConfig,
          req: new Request(
            "http://localhost/_veryfront/rsc/module?rel=../../etc/passwd",
          ),
          adapter,
          projectDir: "/tmp/test-project",
        }),
      );
      assertEquals(result instanceof Response, true);
      assertEquals(result!.status, 400);
      assertEquals(attemptedPaths, []);
      const body = await result!.text();
      assertStringIncludes(body, "Invalid rel query parameter");
    });

    it("rejects project files that are not trusted browser module entries", async () => {
      const files: Record<string, string> = {
        "/tmp/test-project/veryfront.config.ts": "export default { secret: 'private' };",
        "/tmp/test-project/app/server-only.ts": "'use server';\nexport const secret = 'private';",
        "/tmp/test-project/app/page.tsx":
          "'use server';\nexport default function Page() { return null; }",
        "/tmp/test-project/app/data.json": '{"secret":"private"}',
        "/tmp/test-project/pages/helper.ts": "export const secret = 'private';",
        "/tmp/test-project/src/internal.ts": "export const secret = 'private';",
      };
      const adapter = createMockAdapter({
        knownFiles: Object.keys(files),
        exists: (path: string) => Promise.resolve(path in files),
        readFile: (path: string) => Promise.resolve(files[path] ?? ""),
        stat: (path: string) => {
          if (path === "/tmp/test-project/pages") {
            return Promise.resolve({
              isFile: false,
              isDirectory: true,
              size: 0,
              mtime: null,
            });
          }
          if (path in files) {
            return Promise.resolve({
              isFile: true,
              isDirectory: false,
              size: files[path]!.length,
              mtime: null,
            });
          }
          return Promise.reject(new Deno.errors.NotFound("not found"));
        },
      });

      for (
        const rel of [
          "veryfront.config.ts",
          "app/server-only.ts",
          "app/page.tsx",
          "app/data.json",
          "pages/helper.ts",
          "src/internal.ts",
        ]
      ) {
        const result = await handleRSCEndpoint(
          makeParams({
            pathname: "/_veryfront/rsc/module",
            config: rscDisabledConfig,
            req: new Request(
              `http://localhost/_veryfront/rsc/module?rel=${encodeURIComponent(rel)}`,
            ),
            adapter,
            projectDir: "/tmp/test-project",
          }),
        );

        assertEquals(result?.status, 404, `expected ${rel} to stay private`);
      }
    });

    it("serves client modules from the configured app directory", async () => {
      const filePath = "/tmp/test-project/frontend/Counter.tsx";
      const adapter = createMockAdapter({
        knownFiles: [filePath],
        exists: (path: string) => Promise.resolve(path === filePath),
        readFile: () =>
          Promise.resolve(
            `'use client';\nexport default function Counter() { return <button>Count</button>; }`,
          ),
      });

      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/module",
          config: {
            ...rscDisabledConfig,
            directories: { app: "frontend" },
          },
          req: new Request(
            "http://localhost/_veryfront/rsc/module?rel=frontend%2FCounter.tsx",
          ),
          adapter,
          projectDir: "/tmp/test-project",
        }),
      );

      assertEquals(result?.status, 200);
    });

    it("runs one expensive bundle for concurrent identical module requests", async () => {
      const entryPath = "/tmp/test-project/app/Counter.tsx";
      const dependencyPath = "/tmp/test-project/app/shared.ts";
      const files: Record<string, string> = {
        [entryPath]: [
          '"use client";',
          'import { marker } from "./shared.ts";',
          "export default function Counter() { return marker; }",
        ].join("\n"),
        [dependencyPath]: 'export const marker = "SINGLE_FLIGHT_MARKER";',
      };
      let dependencyReads = 0;
      const adapter = createMockAdapter({
        knownFiles: Object.keys(files),
        exists: (path) => Promise.resolve(path in files),
        readFile: (path) => {
          if (path === dependencyPath) dependencyReads++;
          return Promise.resolve(files[path] ?? "");
        },
      });
      const request = () =>
        handleRSCEndpoint(
          makeParams({
            pathname: "/_veryfront/rsc/module",
            config: rscDisabledConfig,
            req: new Request(
              "http://localhost/_veryfront/rsc/module?rel=app%2FCounter.tsx",
            ),
            adapter,
          }),
        );

      const [first, second] = await Promise.all([request(), request()]);

      assertEquals(first?.status, 200);
      assertEquals(second?.status, 200);
      assertEquals(dependencyReads, 1);
    });

    it("rebuilds when a transitive browser dependency changes", async () => {
      const entryPath = "/tmp/test-project/app/Counter.tsx";
      const dependencyPath = "/tmp/test-project/app/shared.ts";
      const files: Record<string, string> = {
        [entryPath]: [
          '"use client";',
          'import { marker } from "./shared.ts";',
          "export default function Counter() { return marker; }",
        ].join("\n"),
        [dependencyPath]: 'export const marker = "DEPENDENCY_FIRST";',
      };
      const adapter = createMockAdapter({
        knownFiles: Object.keys(files),
        exists: (path) => Promise.resolve(path in files),
        readFile: (path) => Promise.resolve(files[path] ?? ""),
      });
      const request = () =>
        handleRSCEndpoint(
          makeParams({
            pathname: "/_veryfront/rsc/module",
            config: rscDisabledConfig,
            req: new Request(
              "http://localhost/_veryfront/rsc/module?rel=app%2FCounter.tsx",
            ),
            adapter,
          }),
        );

      const first = await request();
      files[dependencyPath] = 'export const marker = "DEPENDENCY_SECOND";';
      const second = await request();

      assertStringIncludes(await first!.text(), "DEPENDENCY_FIRST");
      const secondBody = await second!.text();
      assertStringIncludes(secondBody, "DEPENDENCY_SECOND");
      assertEquals(secondBody.includes("DEPENDENCY_FIRST"), false);
    });

    it("uses the detected dependency import map in the module cache key", async () => {
      const projectDir = await Deno.makeTempDir({ prefix: "vf-rsc-import-map-" });
      const entryPath = `${projectDir}/app/Counter.tsx`;
      const source = [
        '"use client";',
        'import React from "react";',
        "export default function Counter() { return React.createElement('div'); }",
      ].join("\n");
      const adapter = createMockAdapter({
        knownFiles: [entryPath],
        exists: (path) => Promise.resolve(path === entryPath),
        readFile: () => Promise.resolve(source),
      });
      const bundler = tryResolve<Bundler>("Bundler");
      if (!bundler) throw new Error("Bundler test contract is not registered");
      let bundleCalls = 0;
      register<Bundler>("Bundler", {
        bundle: (options) => {
          bundleCalls++;
          return bundler.bundle(options);
        },
        transform: (options) => bundler.transform(options),
      });
      const request = () =>
        handleRSCEndpoint(
          makeParams({
            pathname: "/_veryfront/rsc/module",
            config: rscDisabledConfig,
            req: new Request(
              "http://localhost/_veryfront/rsc/module?rel=app%2FCounter.tsx",
            ),
            adapter,
            projectDir,
          }),
        );

      try {
        await Deno.writeTextFile(
          `${projectDir}/package.json`,
          JSON.stringify({ dependencies: { react: "19.1.0" } }),
        );
        clearReactVersionCache();
        assertEquals((await request())?.status, 200);
        assertEquals(getBrowserModuleEndpointStatsForTesting().cacheEntries, 1);

        await Deno.writeTextFile(
          `${projectDir}/package.json`,
          JSON.stringify({ dependencies: { react: "19.2.0" } }),
        );
        clearReactVersionCache();
        assertEquals((await request())?.status, 200);
        assertEquals(getBrowserModuleEndpointStatsForTesting().cacheEntries, 1);
      } finally {
        register("Bundler", bundler);
        clearReactVersionCache();
        await Deno.remove(projectDir, { recursive: true });
      }

      assertEquals(bundleCalls, 2);
      assertEquals(getBrowserModuleEndpointStatsForTesting().cacheEntries, 1);
    });

    it("returns ETags and requires revalidation even when the URL has an entry-only version", async () => {
      const entryPath = "/tmp/test-project/app/Counter.tsx";
      const source = '"use client"; export default function Counter() { return null; }';
      const adapter = createMockAdapter({
        knownFiles: [entryPath],
        exists: (path) => Promise.resolve(path === entryPath),
        readFile: () => Promise.resolve(source),
      });
      const url =
        "http://localhost/_veryfront/rsc/module?rel=app%2FCounter.tsx&v=entry-source-only";

      const first = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/module",
          config: rscDisabledConfig,
          req: new Request(url),
          adapter,
        }),
      );
      const etag = first!.headers.get("etag");
      const cacheControl = first!.headers.get("cache-control") ?? "";
      assertEquals(first?.status, 200);
      assertEquals(typeof etag, "string");
      assertStringIncludes(cacheControl, "must-revalidate");
      assertEquals(cacheControl.includes("immutable"), false);

      const revalidated = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/module",
          config: rscDisabledConfig,
          req: new Request(url, { headers: { "if-none-match": etag! } }),
          adapter,
        }),
      );
      assertEquals(revalidated?.status, 304);
      assertEquals(await revalidated!.text(), "");
      assertEquals(revalidated!.headers.get("etag"), etag);
    });

    it("returns a sanitized 503 immediately when module build capacity is saturated", async () => {
      resetBrowserModuleEndpointStateForTesting({
        globalLimit: 1,
        perProjectLimit: 1,
      });
      const firstPath = "/tmp/test-project/app/First.tsx";
      const secondPath = "/tmp/test-project/app/Second.tsx";
      const files: Record<string, string> = {
        [firstPath]: '"use client"; export default function First() { return null; }',
        [secondPath]: '"use client"; export default function Second() { return null; }',
      };
      let firstReads = 0;
      let signalStarted!: () => void;
      let releaseBuild!: () => void;
      const started = new Promise<void>((resolve) => signalStarted = resolve);
      const release = new Promise<void>((resolve) => releaseBuild = resolve);
      const adapter = createMockAdapter({
        knownFiles: Object.keys(files),
        exists: (path) => Promise.resolve(path in files),
        readFile: async (path) => {
          if (path === firstPath && ++firstReads === 2) {
            signalStarted();
            await release;
          }
          return files[path] ?? "";
        },
      });
      const first = handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/module",
          config: rscDisabledConfig,
          req: new Request(
            "http://localhost/_veryfront/rsc/module?rel=app%2FFirst.tsx",
          ),
          adapter,
        }),
      );
      await started;

      const saturated = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/module",
          config: rscDisabledConfig,
          req: new Request(
            "http://localhost/_veryfront/rsc/module?rel=app%2FSecond.tsx",
          ),
          adapter,
        }),
      );
      assertEquals(saturated?.status, 503);
      assertEquals(await saturated!.text(), "Service Unavailable");
      assertEquals(saturated!.headers.get("cache-control"), "no-store");
      assertEquals(saturated!.headers.get("retry-after"), "1");

      releaseBuild();
      assertEquals((await first)?.status, 200);
    });

    it("does not write attacker-controlled module paths to failure logs", async () => {
      const attackPrefix = "ATTACKER_LOG_PREFIX\nATTACKER_LOG_SUFFIX";
      const rel = `app/${attackPrefix}${"x".repeat(4096)}.ts`;
      const adapter = createMockAdapter({
        exists: () => Promise.reject(new Error("lookup unavailable")),
      });
      const previousLogLevel = Deno.env.get("LOG_LEVEL");
      const previousLogFormat = Deno.env.get("LOG_FORMAT");
      const originalDebug = console.debug;
      const logs: string[] = [];
      let result: Response | null = null;
      Deno.env.set("LOG_LEVEL", "DEBUG");
      Deno.env.set("LOG_FORMAT", "text");
      refreshLoggerConfig();
      console.debug = (...args: unknown[]) => logs.push(args.map(String).join(" "));

      try {
        result = await handleRSCEndpoint(
          makeParams({
            pathname: "/_veryfront/rsc/module",
            config: rscDisabledConfig,
            req: new Request(
              `http://localhost/_veryfront/rsc/module?rel=${encodeURIComponent(rel)}`,
            ),
            adapter,
          }),
        );
      } finally {
        console.debug = originalDebug;
        if (previousLogLevel === undefined) Deno.env.delete("LOG_LEVEL");
        else Deno.env.set("LOG_LEVEL", previousLogLevel);
        if (previousLogFormat === undefined) Deno.env.delete("LOG_FORMAT");
        else Deno.env.set("LOG_FORMAT", previousLogFormat);
        refreshLoggerConfig();
      }

      const output = logs.join("\n");
      assertEquals(result?.status, 500);
      assertEquals(output.includes("ATTACKER_LOG_PREFIX"), false);
      assertEquals(output.includes("ATTACKER_LOG_SUFFIX"), false);
      assertEquals(output.length < 1000, true);
    });

    it("does not expose function-local server action source through the module endpoint", async () => {
      const marker = "FUNCTION_LOCAL_ACTION_SECRET_MARKER";
      const entryPath = "/tmp/test-project/app/Counter.tsx";
      const adapter = createMockAdapter({
        knownFiles: [entryPath],
        exists: (path) => Promise.resolve(path === entryPath),
        readFile: () =>
          Promise.resolve(
            [
              '"use client";',
              "export async function save() {",
              '  "use server";',
              `  return "${marker}";`,
              "}",
              "export default function Counter() { return null; }",
            ].join("\n"),
          ),
      });

      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/module",
          config: rscDisabledConfig,
          req: new Request(
            "http://localhost/_veryfront/rsc/module?rel=app%2FCounter.tsx",
          ),
          adapter,
        }),
      );

      const body = await result!.text();
      assertEquals(result?.status, 500);
      assertEquals(body.includes(marker), false);
    });
  });

  describe("stream endpoint (root)", () => {
    it("returns NDJSON with name parameter", async () => {
      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/stream",
          config: rscEnabledConfig,
          req: new Request("http://localhost/_veryfront/rsc/stream?name=Alice"),
        }),
      );
      assertEquals(result instanceof Response, true);
      assertEquals(result!.status, 200);
      assertEquals(result!.headers.get("content-type"), "application/x-ndjson");

      const body = await result!.text();
      assertStringIncludes(body, "Alice");
      // Verify it's NDJSON (lines of JSON)
      const lines = body.trim().split("\n");
      assertEquals(lines.length >= 4, true);
      // Each non-malformed line should be valid JSON
      for (const line of lines) {
        const parsed = JSON.parse(line);
        assertEquals(typeof parsed.type, "string");
      }
    });

    it("defaults name to World when no name param", async () => {
      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/stream",
          config: rscEnabledConfig,
          req: new Request("http://localhost/_veryfront/rsc/stream"),
        }),
      );
      const body = await result!.text();
      assertStringIncludes(body, "World");
    });

    it("escapes HTML in name (XSS prevention)", async () => {
      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/stream",
          config: rscEnabledConfig,
          req: new Request(
            "http://localhost/_veryfront/rsc/stream?name=<script>alert(1)</script>",
          ),
        }),
      );
      const body = await result!.text();
      // The raw <script> tag should NOT appear in the output
      assertEquals(body.includes("<script>"), false);
      // Escaped version should appear
      assertStringIncludes(body, "&lt;script&gt;");
    });

    it("includes malformed JSON when ?bad param present", async () => {
      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/stream",
          config: rscEnabledConfig,
          req: new Request("http://localhost/_veryfront/rsc/stream?bad"),
        }),
      );
      const body = await result!.text();
      assertStringIncludes(body, "{malformed json}");
      // Should have 5 lines (4 normal + 1 malformed)
      const lines = body.trim().split("\n");
      assertEquals(lines.length, 5);
    });

    it("does not include malformed JSON without ?bad param", async () => {
      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/stream",
          config: rscEnabledConfig,
          req: new Request("http://localhost/_veryfront/rsc/stream"),
        }),
      );
      const body = await result!.text();
      assertEquals(body.includes("{malformed json}"), false);
      const lines = body.trim().split("\n");
      assertEquals(lines.length, 4);
    });
  });

  describe("unknown RSC sub-endpoint", () => {
    it("returns null for unrecognized sub-endpoint when RSC enabled", async () => {
      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/unknown-thing",
          config: rscEnabledConfig,
        }),
      );
      assertEquals(result, null);
    });
  });

  describe("action endpoint - POST handling", () => {
    it("handles POST action with missing body id", async () => {
      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/action",
          config: rscEnabledConfig,
          req: new Request("http://localhost/_veryfront/rsc/action", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ args: [] }),
          }),
        }),
      );
      assertEquals(result instanceof Response, true);
      assertEquals(result!.status, 400);
    });

    it("handles POST action with invalid JSON body", async () => {
      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/action",
          config: rscEnabledConfig,
          req: new Request("http://localhost/_veryfront/rsc/action", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "not json",
          }),
        }),
      );
      assertEquals(result instanceof Response, true);
      // Should still get a response (400 for bad body)
      assertEquals(result!.status, 400);
    });

    it("handles POST action with path traversal id", async () => {
      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/action",
          config: rscEnabledConfig,
          req: new Request("http://localhost/_veryfront/rsc/action", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ id: "../evil", args: [] }),
          }),
        }),
      );
      assertEquals(result instanceof Response, true);
      assertEquals(result!.status, 400);
    });

    it("handles POST action with valid id but non-existent file returns error", async () => {
      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/action",
          config: rscEnabledConfig,
          req: new Request("http://localhost/_veryfront/rsc/action", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ id: "valid-action", args: ["hello"] }),
          }),
        }),
      );
      assertEquals(result instanceof Response, true);
      assertEquals(result!.status, 404);
    });

    it("rejects DELETE with 405", async () => {
      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/action",
          config: rscEnabledConfig,
          req: new Request("http://localhost/_veryfront/rsc/action", { method: "DELETE" }),
        }),
      );
      assertEquals(result!.status, 405);
    });
  });

  describe("payload endpoint", () => {
    it("does not fabricate a successful demo payload when the root component is missing", async () => {
      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/payload",
          config: rscEnabledConfig,
          req: new Request("http://localhost/_veryfront/rsc/payload"),
        }),
      );

      assertEquals(result instanceof Response, true);
      assertEquals(result!.status, 404);
    });

    it("returns a structured not-found response instead of demo payload fields", async () => {
      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/payload",
          config: rscEnabledConfig,
          req: new Request("http://localhost/_veryfront/rsc/payload"),
        }),
      );
      assertEquals(result instanceof Response, true);
      assertEquals(result!.status, 404);
      const body = await result!.json();
      assertEquals(body.status, 404);
      assertEquals("html" in body, false);
      assertEquals("modules" in body, false);
      assertEquals("slots" in body, false);
    });

    it("does not echo query parameters when the root component is missing", async () => {
      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/payload",
          config: rscEnabledConfig,
          req: new Request("http://localhost/_veryfront/rsc/payload?name=Test"),
        }),
      );
      const body = await result!.text();
      assertEquals(body.includes("Test"), false);
    });

    it("does not reflect HTML from payload query parameters", async () => {
      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/payload",
          config: rscEnabledConfig,
          req: new Request(
            "http://localhost/_veryfront/rsc/payload?name=<script>xss</script>",
          ),
        }),
      );
      const body = await result!.text();
      assertEquals(body.includes("<script>"), false);
      assertEquals(body.includes("&lt;script&gt;"), false);
    });
  });

  describe("manifest endpoint", () => {
    it("returns response when RSC enabled", async () => {
      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/manifest",
          config: rscEnabledConfig,
        }),
      );
      assertEquals(result instanceof Response, true);
    });
  });

  describe("removed hydrator script endpoints", () => {
    it("does not serve legacy hydrator.js", async () => {
      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/hydrator.js",
          config: rscEnabledConfig,
        }),
      );
      assertEquals(result, null);
    });

    it("does not serve legacy hydrate.js", async () => {
      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/hydrate.js",
          config: rscEnabledConfig,
        }),
      );
      assertEquals(result, null);
    });
  });

  describe("page endpoint (root)", () => {
    it("returns response for /_veryfront/rsc/page", async () => {
      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/page",
          config: rscEnabledConfig,
        }),
      );
      assertEquals(result instanceof Response, true);
    });

    it("keeps runtime mode independent from local filesystem trust", async () => {
      const remotePreview = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/page",
          projectId: "remote-preview-project",
          config: rscEnabledConfig,
          isLocalProject: false,
          mode: "development",
        }),
      );
      const localProduction = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/page",
          projectId: "local-production-project",
          config: rscEnabledConfig,
          isLocalProject: true,
          mode: "production",
        }),
      );

      assertStringIncludes(await remotePreview!.text(), "window.__VERYFRONT_DEV__ = true");
      assertStringIncludes(
        await localProduction!.text(),
        "window.__VERYFRONT_DEV__ = false",
      );
    });
  });

  describe("module endpoint - fs error handling", () => {
    it("returns 500 when fs.exists throws", async () => {
      const adapter = createMockAdapter({
        exists: () => {
          throw new Error("fs error");
        },
      });

      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/module",
          config: rscEnabledConfig,
          req: new Request("http://localhost/_veryfront/rsc/module?rel=foo.js"),
          adapter,
          projectDir: "/tmp/test-project",
        }),
      );
      assertEquals(result instanceof Response, true);
      assertEquals(result!.status, 500);
    });

    it("handles leading slash in rel param", async () => {
      const adapter = createMockAdapter({
        knownFiles: ["/tmp/test-project/app/test.js"],
        exists: (path: string) => Promise.resolve(path.includes("/app/test.js")),
        readFile: () => Promise.resolve("'use client';\nexport default {}"),
      });

      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/module",
          config: rscEnabledConfig,
          req: new Request(
            "http://localhost/_veryfront/rsc/module?rel=/test.js",
          ),
          adapter,
          projectDir: "/tmp/test-project",
        }),
      );
      assertEquals(result instanceof Response, true);
      assertEquals(result!.status, 200);
    });
  });

  describe("module endpoint - edge cases", () => {
    it("returns 400 for backslash path traversal", async () => {
      const adapter = createMockAdapter({
        exists: () => Promise.resolve(true),
      });

      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/module",
          config: rscEnabledConfig,
          req: new Request(
            "http://localhost/_veryfront/rsc/module?rel=..\\..\\etc\\passwd",
          ),
          adapter,
          projectDir: "/tmp/test-project",
        }),
      );
      assertEquals(result instanceof Response, true);
      assertEquals(result!.status, 400);
    });

    it("serves file from app directory root", async () => {
      const adapter = createMockAdapter({
        knownFiles: ["/tmp/test-project/app/component.js"],
        exists: (path: string) => Promise.resolve(path.includes("/app/component.js")),
        readFile: () => Promise.resolve("'use client';\nexport default {}"),
      });

      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/module",
          config: rscEnabledConfig,
          req: new Request("http://localhost/_veryfront/rsc/module?rel=component.js"),
          adapter,
          projectDir: "/tmp/test-project",
        }),
      );
      assertEquals(result instanceof Response, true);
      assertEquals(result!.status, 200);
      const body = await result!.text();
      assertStringIncludes(body, "as default");
    });
  });

  describe("stream endpoint - sub-paths", () => {
    it("returns null for stream sub-path when RSC disabled", async () => {
      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/stream/sub",
          config: rscDisabledConfig,
        }),
      );
      assertEquals(result, null);
    });

    it("returns null for page sub-path when RSC disabled", async () => {
      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/page/sub",
          config: rscDisabledConfig,
        }),
      );
      assertEquals(result, null);
    });

    it("returns null for render sub-path when RSC disabled", async () => {
      const result = await handleRSCEndpoint(
        makeParams({
          pathname: "/_veryfront/rsc/render/sub",
          config: rscDisabledConfig,
        }),
      );
      assertEquals(result, null);
    });
  });
});
