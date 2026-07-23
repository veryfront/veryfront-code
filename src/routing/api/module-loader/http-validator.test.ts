import "#veryfront/schemas/_test-setup.ts";
import { assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { validateHTTPImports } from "./http-validator.ts";

describe("routing/api/module-loader/http-validator", () => {
  describe("validateHTTPImports", () => {
    it("should block every remote import when allowedHosts is empty", () => {
      assertThrows(
        () => validateHTTPImports('import foo from "https://evil.com/lib.js";', []),
        Error,
        "Remote import blocked",
      );
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

    it("should check export-from declarations", () => {
      assertThrows(
        () =>
          validateHTTPImports('export { unsafe } from "https://evil.com/mod.js";', [
            "https://esm.sh",
          ]),
        Error,
        "Remote import blocked",
      );
    });

    it("should ignore comments and ordinary string data", () => {
      validateHTTPImports(
        [
          '// import unsafe from "https://evil.com/comment.js";',
          "const example = 'import(\"https://evil.com/data.js\")';",
        ].join("\n"),
        ["https://esm.sh"],
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
