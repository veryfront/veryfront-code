import { describe, it } from "std/testing/bdd.ts";
import { assertThrows } from "std/assert/mod.ts";
import { validateHTTPImports } from "./http-validator.ts";

describe("validateHTTPImports", () => {
  describe("static imports", () => {
    it("should pass when importing from allowed hosts", () => {
      const source = `import { foo } from 'https://esm.sh/react@18';`;
      const allowedHosts = ["https://esm.sh"];

      validateHTTPImports(source, allowedHosts);
    });

    it("should throw when importing from disallowed hosts", () => {
      const source = `import { foo } from 'https://evil.com/malware.js';`;
      const allowedHosts = ["https://esm.sh"];

      assertThrows(
        () => validateHTTPImports(source, allowedHosts),
        Error,
        "Remote import blocked",
      );
    });

    it("should handle multiple imports", () => {
      const source = `
        import { foo } from 'https://esm.sh/foo';
        import { bar } from 'https://esm.sh/bar';
      `;
      const allowedHosts = ["https://esm.sh"];

      validateHTTPImports(source, allowedHosts);
    });

    it("should throw on first disallowed import in multiple imports", () => {
      const source = `
        import { foo } from 'https://esm.sh/foo';
        import { bad } from 'https://evil.com/bad.js';
      `;
      const allowedHosts = ["https://esm.sh"];

      assertThrows(
        () => validateHTTPImports(source, allowedHosts),
        Error,
        "https://evil.com",
      );
    });
  });

  describe("dynamic imports", () => {
    it("should validate dynamic imports", () => {
      const source = `const mod = await import('https://esm.sh/react');`;
      const allowedHosts = ["https://esm.sh"];

      validateHTTPImports(source, allowedHosts);
    });

    it("should throw on disallowed dynamic imports", () => {
      const source = `const mod = await import('https://evil.com/bad.js');`;
      const allowedHosts = ["https://esm.sh"];

      assertThrows(
        () => validateHTTPImports(source, allowedHosts),
        Error,
        "Remote import blocked",
      );
    });

    it("should handle mixed static and dynamic imports", () => {
      const source = `
        import { foo } from 'https://esm.sh/foo';
        const mod = await import('https://esm.sh/bar');
      `;
      const allowedHosts = ["https://esm.sh"];

      validateHTTPImports(source, allowedHosts);
    });
  });

  describe("URL patterns", () => {
    it("should handle http imports", () => {
      const source = `import { foo } from 'http://localhost:8000/mod.js';`;
      const allowedHosts = ["http://localhost:8000"];

      validateHTTPImports(source, allowedHosts);
    });

    it("should match protocol and host exactly", () => {
      const source = `import { foo } from 'https://cdn.jsdelivr.net/npm/react@18';`;
      const allowedHosts = ["https://cdn.jsdelivr.net"];

      validateHTTPImports(source, allowedHosts);
    });

    it("should throw when protocol differs", () => {
      const source = `import { foo } from 'https://esm.sh/react';`;
      const allowedHosts = ["http://esm.sh"];

      assertThrows(
        () => validateHTTPImports(source, allowedHosts),
        Error,
        "Remote import blocked",
      );
    });

    it("should handle URLs with paths", () => {
      const source = `import { foo } from 'https://esm.sh/v120/react@18.2.0/es2022/react.mjs';`;
      const allowedHosts = ["https://esm.sh"];

      validateHTTPImports(source, allowedHosts);
    });

    it("should handle URLs with query parameters", () => {
      const source = `import { foo } from 'https://esm.sh/react?bundle=true&target=es2020';`;
      const allowedHosts = ["https://esm.sh"];

      validateHTTPImports(source, allowedHosts);
    });
  });

  describe("host prefix matching", () => {
    it("should allow hosts that start with allowed prefix", () => {
      const source = `import { foo } from 'https://esm.sh/react';`;
      const allowedHosts = ["https://esm.sh"];

      validateHTTPImports(source, allowedHosts);
    });

    it("should handle subdomain matching", () => {
      const source = `import { foo } from 'https://cdn.example.com/lib.js';`;
      const allowedHosts = ["https://cdn.example.com"];

      validateHTTPImports(source, allowedHosts);
    });
  });

  describe("edge cases", () => {
    it("should pass when no HTTP imports present", () => {
      const source = `
        import { foo } from './local.js';
        import { bar } from 'npm:package';
      `;
      const allowedHosts = ["https://esm.sh"];

      validateHTTPImports(source, allowedHosts);
    });

    it("should pass with empty allowed hosts when no HTTP imports", () => {
      const source = `import { foo } from './local.js';`;
      const allowedHosts: string[] = [];

      validateHTTPImports(source, allowedHosts);
    });

    it("should pass with empty allowed hosts when HTTP import present and length is 0", () => {
      // When allowedHosts is empty array but has length 0, the check is skipped
      const source = `import { foo } from 'https://esm.sh/react';`;
      const allowedHosts: string[] = [];

      // This should pass because allowedHosts.length === 0
      validateHTTPImports(source, allowedHosts);
    });

    it("should detect imports in comments (regex-based detection)", () => {
      // The regex detects import statements even in comments
      const source = `
        // import { foo } from 'https://evil.com/bad.js';
        import { bar } from 'https://esm.sh/good.js';
      `;
      const allowedHosts = ["https://esm.sh"];

      // This will throw because the regex finds the URL in the comment
      assertThrows(
        () => validateHTTPImports(source, allowedHosts),
        Error,
        "https://evil.com",
      );
    });

    it("should detect imports in strings (regex-based detection)", () => {
      // The regex detects import statements even in strings
      const source = `
        const str = "import { foo } from 'https://evil.com/bad.js'";
        import { bar } from 'https://esm.sh/good.js';
      `;
      const allowedHosts = ["https://esm.sh"];

      // This will throw because the regex finds the URL in the string
      assertThrows(
        () => validateHTTPImports(source, allowedHosts),
        Error,
        "https://evil.com",
      );
    });

    it("should handle multiple allowed hosts", () => {
      const source = `
        import { foo } from 'https://esm.sh/react';
        import { bar } from 'https://cdn.jsdelivr.net/npm/vue';
      `;
      const allowedHosts = ["https://esm.sh", "https://cdn.jsdelivr.net"];

      validateHTTPImports(source, allowedHosts);
    });

    it("should provide helpful error message with remediation", () => {
      const source = `import { foo } from 'https://example.com/lib.js';`;
      const allowedHosts = ["https://esm.sh"];

      assertThrows(
        () => validateHTTPImports(source, allowedHosts),
        Error,
        "Add \"https://example.com\" to security.remoteHosts",
      );
    });
  });

  describe("import syntax variations", () => {
    it("should handle default imports", () => {
      const source = `import React from 'https://esm.sh/react';`;
      const allowedHosts = ["https://esm.sh"];

      validateHTTPImports(source, allowedHosts);
    });

    it("should handle namespace imports", () => {
      const source = `import * as React from 'https://esm.sh/react';`;
      const allowedHosts = ["https://esm.sh"];

      validateHTTPImports(source, allowedHosts);
    });

    it("should handle side-effect imports", () => {
      const source = `import 'https://esm.sh/polyfill';`;
      const allowedHosts = ["https://esm.sh"];

      validateHTTPImports(source, allowedHosts);
    });

    it("should handle type-only imports", () => {
      const source = `import type { Props } from 'https://esm.sh/types';`;
      const allowedHosts = ["https://esm.sh"];

      validateHTTPImports(source, allowedHosts);
    });
  });
});
