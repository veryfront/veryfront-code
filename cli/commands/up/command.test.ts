import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { _resetEnvironmentConfig } from "#veryfront/config/environment-config.ts";
import { join } from "veryfront/platform/path";
import { parseUpArgs, UpArgsSchema, upCommand } from "./index.ts";
import type { ParsedArgs } from "#cli/shared/types";

function createArgs(flags: Record<string, unknown> = {}): ParsedArgs {
  return { _: ["up"], ...flags };
}

function assertSuccess<T extends { success: boolean; data?: unknown }>(
  result: T,
): asserts result is T & { success: true; data: NonNullable<T["data"]> } {
  assertEquals(result.success, true);
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    Deno.env.delete(name);
    return;
  }
  Deno.env.set(name, value);
}

describe("Up Command", () => {
  describe("UpArgsSchema", () => {
    it("should have correct defaults", () => {
      const result = UpArgsSchema.parse({});
      assertEquals(result.force, false);
      assertEquals(result.dryRun, false);
    });

    it("should accept force option", () => {
      const result = UpArgsSchema.parse({ force: true });
      assertEquals(result.force, true);
    });

    it("should accept dryRun option", () => {
      const result = UpArgsSchema.parse({ dryRun: true });
      assertEquals(result.dryRun, true);
    });
  });

  describe("parseUpArgs", () => {
    it("should parse empty args with defaults", () => {
      const result = parseUpArgs(createArgs());
      assertSuccess(result);
      assertEquals(result.data.force, false);
      assertEquals(result.data.dryRun, false);
    });

    it("should parse --force flag", () => {
      const result = parseUpArgs(createArgs({ force: true }));
      assertSuccess(result);
      assertEquals(result.data.force, true);
    });

    it("should parse -f short flag", () => {
      const result = parseUpArgs(createArgs({ f: true }));
      assertSuccess(result);
      assertEquals(result.data.force, true);
    });

    it("should parse --dry-run flag", () => {
      const result = parseUpArgs(createArgs({ "dry-run": true }));
      assertSuccess(result);
      assertEquals(result.data.dryRun, true);
    });

    it("should parse multiple flags", () => {
      const result = parseUpArgs(createArgs({ force: true, "dry-run": true }));
      assertSuccess(result);
      assertEquals(result.data.force, true);
      assertEquals(result.data.dryRun, true);
    });
  });

  describe("upCommand", () => {
    it("uses VERYFRONT_API_BASE_URL when creating a project", async () => {
      const originalFetch = globalThis.fetch;
      const originalApiToken = Deno.env.get("VERYFRONT_API_TOKEN");
      const originalApiBaseUrl = Deno.env.get("VERYFRONT_API_BASE_URL");
      const originalApiUrl = Deno.env.get("VERYFRONT_API_URL");
      const tempDir = await Deno.makeTempDir();
      const requestedUrls: string[] = [];

      try {
        await Deno.writeTextFile(join(tempDir, "package.json"), "{}");
        Deno.env.set("VERYFRONT_API_TOKEN", "env-token");
        Deno.env.set("VERYFRONT_API_BASE_URL", "https://api.from-env.test");
        Deno.env.delete("VERYFRONT_API_URL");
        _resetEnvironmentConfig();

        globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
          const url = String(input);
          requestedUrls.push(url);

          if (url.endsWith("/me")) {
            return Promise.resolve(
              new Response(JSON.stringify({ id: "user-1", email: "dev@example.com" }), {
                status: 200,
                headers: { "content-type": "application/json" },
              }),
            );
          }

          if (url.endsWith("/projects") && init?.method === "POST") {
            return Promise.resolve(
              new Response(JSON.stringify({ id: "project-1", slug: "test-project" }), {
                status: 200,
                headers: { "content-type": "application/json" },
              }),
            );
          }

          if (url.endsWith("/branches") && init?.method === "POST") {
            return Promise.resolve(
              new Response(
                JSON.stringify({ id: "branch-1", name: "main", projectId: "project-1" }),
                {
                  status: 200,
                  headers: { "content-type": "application/json" },
                },
              ),
            );
          }

          if (url.includes("/environments")) {
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  data: [{ id: "env-1", name: "preview", protected: false }],
                  page_info: {},
                }),
                {
                  status: 200,
                  headers: { "content-type": "application/json" },
                },
              ),
            );
          }

          if (url.endsWith("/releases") && init?.method === "POST") {
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  id: "release-1",
                  name: "Preview",
                  version: "v1",
                  export_status: "complete",
                  build_status: "complete",
                  deploy_status: "pending",
                }),
                {
                  status: 200,
                  headers: { "content-type": "application/json" },
                },
              ),
            );
          }

          if (url.endsWith("/deployments") && init?.method === "POST") {
            return Promise.resolve(
              new Response(
                JSON.stringify({ id: "deployment-1", release: "release-1", environment: "env-1" }),
                {
                  status: 200,
                  headers: { "content-type": "application/json" },
                },
              ),
            );
          }

          return Promise.resolve(
            new Response(JSON.stringify({ data: [], page_info: {} }), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          );
        }) as typeof fetch;

        await upCommand({ projectDir: tempDir, force: true, dryRun: false });

        assertEquals(
          requestedUrls.some((url) => url.startsWith("https://api.from-env.test/projects")),
          true,
        );
        assertEquals(
          requestedUrls.some((url) => url.startsWith("https://api.veryfront.com/projects")),
          false,
        );
      } finally {
        globalThis.fetch = originalFetch;
        restoreEnv("VERYFRONT_API_TOKEN", originalApiToken);
        restoreEnv("VERYFRONT_API_BASE_URL", originalApiBaseUrl);
        restoreEnv("VERYFRONT_API_URL", originalApiUrl);
        _resetEnvironmentConfig();
        await Deno.remove(tempDir, { recursive: true });
      }
    });
  });
});
