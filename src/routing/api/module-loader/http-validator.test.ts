import "#veryfront/schemas/_test-setup.ts";
import { assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { validateHTTPImports } from "./http-validator.ts";

describe("routing/api/module-loader/http-validator", () => {
  describe("validateHTTPImports", () => {
    it("should block all remote imports when allowedHosts is empty", () => {
      assertThrows(
        () => validateHTTPImports('import foo from "https://evil.com/lib.js";', []),
        Error,
        "Remote import blocked",
      );
    });

    it("should block bare side-effect remote imports when allowedHosts is empty", () => {
      assertThrows(
        () => validateHTTPImports('import "https://evil.com/x.js";', []),
        Error,
        "Remote import blocked",
        "a side-effect-only remote import must still be blocked by the allow-list",
      );
    });

    it("should reject an http:// URL for an https-only allowed host", () => {
      assertThrows(
        () => {
          validateHTTPImports('import x from "http://esm.sh/react";', [
            "https://esm.sh",
          ]);
        },
        Error,
        "Remote import blocked",
        "an http:// URL must not satisfy an https-only allowed host",
      );
    });

    it("should reject an off-port URL for an allowed host", () => {
      assertThrows(
        () => {
          validateHTTPImports('import x from "https://esm.sh:8443/react";', [
            "https://esm.sh",
          ]);
        },
        Error,
        "Remote import blocked",
        "a non-default port must not satisfy an allowed host pinned to the default port",
      );
    });

    it("should block remote re-exports that are not allow-listed", () => {
      assertThrows(
        () => validateHTTPImports('export { pwn } from "https://evil.com/x.js";', []),
        Error,
        "Remote import blocked",
        "a named re-export is a remote import and must be blocked",
      );
      assertThrows(
        () => validateHTTPImports('export * from "https://evil.com/x.js";', []),
        Error,
        "Remote import blocked",
        "a star re-export is a remote import and must be blocked",
      );
    });

    it("should allow remote re-exports from allowed hosts", () => {
      validateHTTPImports('export { a } from "https://esm.sh/x.js";', [
        "https://esm.sh",
      ]);
      validateHTTPImports('export * from "https://esm.sh/x.js";', ["https://esm.sh"]);
    });

    it("should allow imports from allowed hosts", () => {
      validateHTTPImports('import React from "https://esm.sh/react@18";', [
        "https://esm.sh",
      ]);
    });

    it("should reject imports from non-allowed hosts", () => {
      assertThrows(
        () => {
          validateHTTPImports('import malware from "https://evil.com/bad.js";', [
            "https://esm.sh",
          ]);
        },
        Error,
        "Remote import blocked",
      );
    });

    it("should reject prefix-domain bypasses of allowed hosts", () => {
      assertThrows(
        () => {
          validateHTTPImports('import malware from "https://esm.sh.evil.example/bad.js";', [
            "https://esm.sh",
          ]);
        },
        Error,
        "Remote import blocked",
      );
    });

    it("should check dynamic imports", () => {
      assertThrows(
        () => {
          validateHTTPImports('const mod = import("https://evil.com/mod.js");', [
            "https://esm.sh",
          ]);
        },
        Error,
        "Remote import blocked",
      );
    });

    it("should allow multiple hosts", () => {
      validateHTTPImports(
        'import a from "https://esm.sh/react";\nimport b from "https://cdn.example.com/lib.js";',
        ["https://esm.sh", "https://cdn.example.com"],
      );
    });

    it("should not flag non-HTTP imports", () => {
      validateHTTPImports(
        'import { foo } from "./local.ts";\nimport bar from "lodash";',
        ["https://esm.sh"],
      );
    });

    it("should handle source with no imports", () => {
      validateHTTPImports("const x = 1;", ["https://esm.sh"]);
    });
  });
});
