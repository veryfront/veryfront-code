import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  isCanonicalHydrationModulePath,
  isCanonicalHydrationPath,
  resolveCanonicalProjectRelativePath,
} from "./project-relative-path.ts";

describe("html/project-relative-path", () => {
  it("rejects every WHATWG URL dot-segment spelling", () => {
    for (
      const segment of [
        ".",
        "%2e",
        "%2E",
        "..",
        ".%2e",
        ".%2E",
        "%2e.",
        "%2E.",
        "%2e%2e",
        "%2E%2E",
      ]
    ) {
      const relativePath = `app/${segment}/page.tsx`;
      assertEquals(isCanonicalHydrationPath(relativePath), false);
      assertEquals(isCanonicalHydrationModulePath(relativePath), false);
      assertEquals(
        resolveCanonicalProjectRelativePath(relativePath, "/project", { module: true }),
        undefined,
      );
      assertEquals(
        resolveCanonicalProjectRelativePath(
          `/project/${relativePath}`,
          "/project",
          { module: true },
        ),
        undefined,
      );
    }
  });

  it("preserves safe encoded and Unicode names beneath the module URL prefix", () => {
    for (
      const path of [
        "app/hello%20world.tsx",
        "app/caf%C3%A9.tsx",
        "app/%2ehidden.tsx",
        "app/%2e%2e.tsx",
        "app/%252e/page.tsx",
        "app/日本語.tsx",
      ]
    ) {
      const resolved = resolveCanonicalProjectRelativePath(
        `/project/${path}`,
        "/project",
        { module: true },
      );
      assertEquals(resolved, path);
      assertEquals(
        new URL(`/_vf_modules/${resolved}`, "https://example.test").pathname.startsWith(
          "/_vf_modules/",
        ),
        true,
      );
    }
  });
});
