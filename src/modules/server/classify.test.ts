import "#veryfront/schemas/_test-setup.ts";
/**
 * classify.ts unit tests
 *
 * Table-driven tests over every URL pattern that classifyModuleRequest
 * recognises, plus rejection of non-module URLs.
 *
 * @module modules/server/classify.test
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { classifyModuleRequest, type ModuleRequestKind } from "./classify.ts";

function url(pathname: string, host = "localhost:3000"): URL {
  return new URL(`http://${host}${pathname}`);
}

describe("classifyModuleRequest", () => {
  describe("not-module", () => {
    for (
      const pathname of [
        "/",
        "/api/data",
        "/pages/index",
        "/_vf_mod",
        "/_veryfront/mod",
        "/vf_modules/page.js",
      ]
    ) {
      it(`returns not-module for ${pathname}`, () => {
        const result = classifyModuleRequest(url(pathname));
        assertEquals(result.kind, "not-module");
      });
    }
  });

  describe("snippet", () => {
    it("classifies /_vf_modules/_snippets/<hash>.js as snippet", () => {
      const result = classifyModuleRequest(
        url("/_vf_modules/_snippets/abc123def456.js"),
      );
      assertEquals(result satisfies ModuleRequestKind, result);
      assertEquals(result.kind, "snippet");
      if (result.kind === "snippet") {
        assertEquals(result.hash, "abc123def456");
      }
    });

    it("classifies full hex hash in snippet URL", () => {
      const hash = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4";
      const result = classifyModuleRequest(url(`/_vf_modules/_snippets/${hash}.js`));
      assertEquals(result.kind, "snippet");
      if (result.kind === "snippet") {
        assertEquals(result.hash, hash);
      }
    });

    it("does NOT classify _snippets path without .js extension as snippet", () => {
      // Falls through to dev-module since DEV_MODULE_PREFIX matches
      const result = classifyModuleRequest(url("/_vf_modules/_snippets/abc123.ts"));
      assertEquals(result.kind, "dev-module");
    });
  });

  describe("cross-project-versioned", () => {
    it("classifies /_vf_modules/_cross/<slug>@<version>/@/<path>", () => {
      const result = classifyModuleRequest(
        url("/_vf_modules/_cross/my-project@1.2.3/@/components/Button.js"),
      );
      assertEquals(result.kind, "cross-project-versioned");
      if (result.kind === "cross-project-versioned") {
        assertEquals(result.slug, "my-project");
        assertEquals(result.version, "1.2.3");
        assertEquals(result.path, "components/Button.js");
      }
    });

    it("handles semver range version like ^1.0.0", () => {
      const result = classifyModuleRequest(
        url("/_vf_modules/_cross/demo@^1.0.0/@/lib/utils.js"),
      );
      assertEquals(result.kind, "cross-project-versioned");
      if (result.kind === "cross-project-versioned") {
        assertEquals(result.version, "^1.0.0");
      }
    });

    it("handles x-range version like 1.x", () => {
      const result = classifyModuleRequest(
        url("/_vf_modules/_cross/demo@1.x/@/lib/utils.js"),
      );
      assertEquals(result.kind, "cross-project-versioned");
      if (result.kind === "cross-project-versioned") {
        assertEquals(result.version, "1.x");
      }
    });
  });

  describe("cross-project-latest", () => {
    it("classifies /_vf_modules/_cross/<slug>/@/<path>", () => {
      const result = classifyModuleRequest(
        url("/_vf_modules/_cross/my-project/@/components/Button.js"),
      );
      assertEquals(result.kind, "cross-project-latest");
      if (result.kind === "cross-project-latest") {
        assertEquals(result.slug, "my-project");
        assertEquals(result.path, "components/Button.js");
      }
    });

    it("preserves nested path", () => {
      const result = classifyModuleRequest(
        url("/_vf_modules/_cross/acme-corp/@/a/b/c/deep.js"),
      );
      assertEquals(result.kind, "cross-project-latest");
      if (result.kind === "cross-project-latest") {
        assertEquals(result.path, "a/b/c/deep.js");
      }
    });
  });

  describe("dev-module", () => {
    for (
      const pathname of [
        "/_vf_modules/components/Button.js",
        "/_vf_modules/_veryfront/utils/index.js",
        "/_veryfront/modules/lib/utils.ts",
        "/_vf_modules/_dnt.shims.js",
        "/_vf_modules/page.tsx",
      ]
    ) {
      it(`classifies ${pathname} as dev-module`, () => {
        const result = classifyModuleRequest(url(pathname));
        assertEquals(result.kind, "dev-module");
      });
    }

    it("classifies /_vf_modules/ with query params as dev-module", () => {
      const result = classifyModuleRequest(url("/_vf_modules/file.tsx?t=123&ssr=true"));
      assertEquals(result.kind, "dev-module");
    });
  });

  describe("precedence", () => {
    it("snippet prefix takes priority over dev-module", () => {
      const result = classifyModuleRequest(url("/_vf_modules/_snippets/deadbeef.js"));
      assertEquals(result.kind, "snippet");
    });

    it("versioned cross-project takes priority over latest cross-project", () => {
      // If a slug contains @ it should match versioned, not latest
      const result = classifyModuleRequest(
        url("/_vf_modules/_cross/proj@2.0.0/@/index.js"),
      );
      assertEquals(result.kind, "cross-project-versioned");
    });
  });
});
