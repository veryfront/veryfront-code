import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isProtectedBrowserModulePath } from "./browser-module-admission.ts";

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
  });

  it("keeps ordinary browser candidates eligible for deeper checks", () => {
    assertEquals(isProtectedBrowserModulePath("app/page.tsx"), false);
    assertEquals(isProtectedBrowserModulePath("components/Button.tsx"), false);
    assertEquals(isProtectedBrowserModulePath("src/client.ts"), false);
  });
});
