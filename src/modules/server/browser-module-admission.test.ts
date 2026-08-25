import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  classifyBrowserModuleAbsoluteSourcePath,
  classifyBrowserModuleSourcePath,
  isProtectedBrowserModulePath,
} from "./browser-module-admission.ts";

describe("browser module admission", () => {
  it("protects project metadata and environment files", () => {
    for (
      const path of [
        "veryfront.config.js",
        "deno.json",
        "deno.json.js",
        "package.json",
        "package.json.js",
        "veryfront.lock",
        ".env.production",
      ]
    ) {
      assertEquals(classifyBrowserModuleSourcePath(path).protectionReason, "metadata", path);
    }
  });

  it("protects hidden project paths", () => {
    for (
      const path of [
        "config/.env.local",
        ".git/config.js",
        "src/.secrets/key.ts",
        ".vscode/settings.js",
      ]
    ) {
      assertEquals(classifyBrowserModuleSourcePath(path).protectionReason, "hidden-path", path);
      assertEquals(isProtectedBrowserModulePath(path), true, path);
    }
  });

  it("protects default and configured server roots", () => {
    assertEquals(isProtectedBrowserModulePath("app/actions/update.ts"), true);
    assertEquals(isProtectedBrowserModulePath("app/api/users/route.ts"), true);
    assertEquals(isProtectedBrowserModulePath("pages/api/users.ts"), true);
    assertEquals(
      isProtectedBrowserModulePath("source/server/actions/update.ts", {
        directories: { app: "source/server", pages: "source/pages" },
      }),
      true,
    );
    assertEquals(
      isProtectedBrowserModulePath("source/pages/api/users.ts", {
        directories: { app: "source/server", pages: "source/pages" },
      }),
      true,
    );
    assertEquals(
      isProtectedBrowserModulePath("actions/update.ts", {
        directories: { app: ".", pages: "source/pages" },
      }),
      true,
    );
    assertEquals(
      isProtectedBrowserModulePath("server/actions/update.ts", {
        directories: { app: "source/../server" },
      }),
      true,
    );
  });

  it("protects every framework discovery root and configured replacement", () => {
    for (
      const root of [
        "tools",
        "agents",
        "skills",
        "resources",
        "prompts",
        "workflows",
        "tasks",
        "schedules",
        "webhooks",
        "evals",
      ]
    ) {
      assertEquals(isProtectedBrowserModulePath(`${root}/private.ts`), true, root);
    }

    assertEquals(
      isProtectedBrowserModulePath("source/private-tools/private.ts", {
        ai: {
          tools: {
            discovery: { paths: ["source/./internal/../private-tools"] },
          },
        },
      }),
      true,
    );
  });

  it("protects app route handlers and root middleware", () => {
    for (
      const path of [
        "app/route.ts",
        "app/account/route.tsx",
        "source/server/account/route.js",
        "middleware.ts",
        "middleware.js",
        "middleware.mjs",
      ]
    ) {
      assertEquals(
        isProtectedBrowserModulePath(
          path,
          path.startsWith("source/") ? { directories: { app: "source/server" } } : undefined,
        ),
        true,
        path,
      );
    }
  });

  it("keeps ordinary browser candidates eligible for deeper checks", () => {
    assertEquals(isProtectedBrowserModulePath("app/page.tsx"), false);
    assertEquals(isProtectedBrowserModulePath("components/Button.tsx"), false);
    assertEquals(isProtectedBrowserModulePath("src/client.ts"), false);
  });

  it("applies the canonical policy to resolved absolute project paths", () => {
    assertEquals(
      classifyBrowserModuleAbsoluteSourcePath(
        "/tenant/project/app/actions/private.ts",
        "/tenant/project",
      ),
      {
        canonicalPath: "app/actions/private.ts",
        protectionReason: "server-route",
        requiresClientBoundary: false,
      },
    );
    assertEquals(
      classifyBrowserModuleAbsoluteSourcePath(
        "/tenant/other/private.ts",
        "/tenant/project",
      ).protectionReason,
      "invalid-path",
    );
  });
});
