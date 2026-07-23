import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { resolveAppComponentPath } from "./app-resolver.ts";
import { VeryfrontError } from "#veryfront/errors/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";

function createMockAdapter(
  existingFiles: Set<string> = new Set(),
  symlinks: Set<string> = new Set(),
): RuntimeAdapter {
  return {
    fs: {
      readFile: async () => "",
      exists: async (path: string) => existingFiles.has(path),
      readDir: async function* () {},
      writeFile: async () => {},
      mkdir: async () => {},
      stat: async (path: string) => ({
        isFile: existingFiles.has(path),
        isDirectory: false,
        isSymlink: symlinks.has(path),
      }),
    },
    env: { get: () => undefined },
  } as unknown as RuntimeAdapter;
}

describe("rendering/layouts/utils/app-resolver", () => {
  describe("resolveAppComponentPath", () => {
    it("should return null when config.app is false", async () => {
      const adapter = createMockAdapter();
      const config = { app: false } as unknown as VeryfrontConfig;
      const result = await resolveAppComponentPath("/project", adapter, config);
      assertEquals(result, null);
    });

    it("should return null when no app component found via discovery", async () => {
      const adapter = createMockAdapter();
      const result = await resolveAppComponentPath("/project", adapter);
      assertEquals(result, null);
    });

    it("should discover app.tsx in components directory", async () => {
      const files = new Set(["/project/components/app.tsx"]);
      const adapter = createMockAdapter(files);
      const result = await resolveAppComponentPath("/project", adapter);
      assertEquals(result, "/project/components/app.tsx");
    });

    it("should discover app.jsx in components directory", async () => {
      const files = new Set(["/project/components/app.jsx"]);
      const adapter = createMockAdapter(files);
      const result = await resolveAppComponentPath("/project", adapter);
      assertEquals(result, "/project/components/app.jsx");
    });

    it("should discover app.ts in components directory", async () => {
      const files = new Set(["/project/components/app.ts"]);
      const adapter = createMockAdapter(files);
      const result = await resolveAppComponentPath("/project", adapter);
      assertEquals(result, "/project/components/app.ts");
    });

    it("should prefer tsx over jsx (first match wins)", async () => {
      const files = new Set([
        "/project/components/app.tsx",
        "/project/components/app.jsx",
      ]);
      const adapter = createMockAdapter(files);
      const result = await resolveAppComponentPath("/project", adapter);
      assertEquals(result, "/project/components/app.tsx");
    });

    it("should use config.app path when provided and file exists", async () => {
      const files = new Set(["/project/src/app.tsx"]);
      const adapter = createMockAdapter(files);
      const config = { app: "src/app.tsx" } as unknown as VeryfrontConfig;
      const result = await resolveAppComponentPath("/project", adapter, config);
      assertEquals(result, "/project/src/app.tsx");
    });

    it("should use an absolute config.app path inside the project", async () => {
      const files = new Set(["/project/src/app.tsx"]);
      const adapter = createMockAdapter(files);
      const config = { app: "/project/src/app.tsx" } as unknown as VeryfrontConfig;
      const result = await resolveAppComponentPath("/project", adapter, config);
      assertEquals(result, "/project/src/app.tsx");
    });

    it("rejects absolute and relative paths outside the project", async () => {
      for (const app of ["/absolute/app.tsx", "../outside/app.tsx"]) {
        const adapter = createMockAdapter(new Set([app]));
        const config = { app } as unknown as VeryfrontConfig;
        await assertRejects(
          () => resolveAppComponentPath("/project", adapter, config),
          VeryfrontError,
          "must stay inside the project",
        );
      }
    });

    it("rejects symlink app components", async () => {
      const app = "/project/app.tsx";
      const adapter = createMockAdapter(new Set([app]), new Set([app]));
      const config = { app: "app.tsx" } as unknown as VeryfrontConfig;
      await assertRejects(
        () => resolveAppComponentPath("/project", adapter, config),
        VeryfrontError,
        "must be a regular file",
      );
    });

    it("should throw when config.app path does not exist", async () => {
      const adapter = createMockAdapter();
      const config = { app: "nonexistent/app.tsx" } as unknown as VeryfrontConfig;
      await assertRejects(
        () => resolveAppComponentPath("/project", adapter, config),
        VeryfrontError,
      );
    });

    it("should throw for invalid extension in config.app", async () => {
      const adapter = createMockAdapter();
      const config = { app: "app.css" } as unknown as VeryfrontConfig;
      await assertRejects(
        () => resolveAppComponentPath("/project", adapter, config),
        VeryfrontError,
      );
    });

    it("should throw for config.app without extension", async () => {
      const adapter = createMockAdapter();
      const config = { app: "app" } as unknown as VeryfrontConfig;
      await assertRejects(
        () => resolveAppComponentPath("/project", adapter, config),
        VeryfrontError,
      );
    });

    it("should return null when no config provided and no default files exist", async () => {
      const adapter = createMockAdapter();
      const result = await resolveAppComponentPath("/project", adapter, undefined);
      assertEquals(result, null);
    });

    it("should discover app.mdx in components directory", async () => {
      const files = new Set(["/project/components/app.mdx"]);
      const adapter = createMockAdapter(files);
      const result = await resolveAppComponentPath("/project", adapter);
      assertEquals(result, "/project/components/app.mdx");
    });
  });
});
