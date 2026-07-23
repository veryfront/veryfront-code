import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isFrameworkOwnedModulePath } from "./module-request-policy.ts";

describe("module request policy", () => {
  it("recognizes only contained embedded framework module paths", () => {
    for (
      const pathname of [
        "/_vf_modules/_veryfront/runtime.js",
        "/_vf_modules/react/jsx-runtime.js",
        "/_vf_modules/deps/zod.js",
        "/_vf_modules/_dnt.shims.js",
      ]
    ) {
      assertEquals(isFrameworkOwnedModulePath(pathname), true, pathname);
    }

    for (
      const pathname of [
        "/_vf_modules/_veryfront/../project.js",
        "/_vf_modules/react/./project.js",
        "/_vf_modules/deps//project.js",
        "/_vf_modules/_veryfront/%252e%252e/project.js",
        "/_vf_modules/_veryfront/%E0%A4%A",
        "/_vf_modules/_veryfront\\project.js",
      ]
    ) {
      assertEquals(isFrameworkOwnedModulePath(pathname), false, pathname);
    }
  });
});
