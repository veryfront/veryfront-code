import { describe, it } from "@std/testing/bdd.ts";
import { expect } from "@std/expect";
import { addDepsToEsmShUrls, resolveReactImports } from "./react-imports.ts";
import { rewriteVendorImports } from "./import-rewriter.ts";

describe("react-imports", () => {
  describe("resolveReactImports", () => {
    it("should resolve bare React import to CDN URL", async () => {
      const code = 'import React from "react"';
      const result = await resolveReactImports(code);
      expect(result).toBe('import React from "https://esm.sh/react@18.3.1"');
    });

    it("should resolve bare React import with single quotes", async () => {
      const code = "import React from 'react'";
      const result = await resolveReactImports(code);
      // Preserves single quotes
      expect(result).toBe("import React from 'https://esm.sh/react@18.3.1'");
    });

    it("should resolve react/jsx-runtime import", async () => {
      const code = 'import { jsx } from "react/jsx-runtime"';
      const result = await resolveReactImports(code);
      expect(result).toBe('import { jsx } from "https://esm.sh/react@18.3.1/jsx-runtime"');
    });

    it("should resolve react/jsx-dev-runtime import", async () => {
      const code = 'import { jsxDEV } from "react/jsx-dev-runtime"';
      const result = await resolveReactImports(code);
      expect(result).toBe('import { jsxDEV } from "https://esm.sh/react@18.3.1/jsx-dev-runtime"');
    });

    it("should resolve react-dom import", async () => {
      const code = 'import ReactDOM from "react-dom"';
      const result = await resolveReactImports(code);
      expect(result).toBe('import ReactDOM from "https://esm.sh/react-dom@18.3.1"');
    });

    it("should resolve react-dom/server import", async () => {
      const code = 'import { renderToString } from "react-dom/server"';
      const result = await resolveReactImports(code);
      expect(result).toBe(
        'import { renderToString } from "https://esm.sh/react-dom@18.3.1/server"',
      );
    });

    it("should resolve react-dom/client import", async () => {
      const code = 'import { createRoot } from "react-dom/client"';
      const result = await resolveReactImports(code);
      expect(result).toBe('import { createRoot } from "https://esm.sh/react-dom@18.3.1/client"');
    });

    it("should handle multiple React imports in order", async () => {
      const code = `import React from "react"
import { jsx } from "react/jsx-runtime"
import ReactDOM from "react-dom"`;
      const result = await resolveReactImports(code);
      expect(result).toContain('from "https://esm.sh/react@18.3.1"');
      expect(result).toContain('from "https://esm.sh/react@18.3.1/jsx-runtime"');
      expect(result).toContain('from "https://esm.sh/react-dom@18.3.1"');
    });

    it("should prioritize specific paths over generic react", async () => {
      const code = 'import { jsx } from "react/jsx-runtime"';
      const result = await resolveReactImports(code);
      expect(result).toBe('import { jsx } from "https://esm.sh/react@18.3.1/jsx-runtime"');
      expect(result).not.toContain("https://esm.sh/react@18.3.1/jsx-runtime@18.3.1");
    });

    it("should handle whitespace in imports", async () => {
      const code = 'import   React   from   "react"';
      const result = await resolveReactImports(code);
      expect(result).toBe('import   React   from   "https://esm.sh/react@18.3.1"');
    });

    it("should not modify already resolved React URLs", async () => {
      const code = 'import React from "https://esm.sh/react@18.3.1"';
      const result = await resolveReactImports(code);
      expect(result).toBe(code);
    });

    it("should not modify non-React imports", async () => {
      const code = 'import { something } from "other-package"';
      const result = await resolveReactImports(code);
      expect(result).toBe(code);
    });

    it("should handle React import in larger code block", async () => {
      const code = `
        import React from "react"

        export function MyComponent() {
          return React.createElement("div", null, "Hello")
        }
      `;
      const result = await resolveReactImports(code);
      expect(result).toContain('import React from "https://esm.sh/react@18.3.1"');
      expect(result).toContain("export function MyComponent()");
    });

    it("should handle all React import types together", async () => {
      const code = `import React from "react"
import { jsx, jsxs } from "react/jsx-runtime"
import { jsxDEV } from "react/jsx-dev-runtime"
import ReactDOM from "react-dom"
import { createRoot } from "react-dom/client"
import { renderToString } from "react-dom/server"`;
      const result = await resolveReactImports(code);

      expect(result).toContain('from "https://esm.sh/react@18.3.1"');
      expect(result).toContain('from "https://esm.sh/react@18.3.1/jsx-runtime"');
      expect(result).toContain('from "https://esm.sh/react@18.3.1/jsx-dev-runtime"');
      expect(result).toContain('from "https://esm.sh/react-dom@18.3.1"');
      expect(result).toContain('from "https://esm.sh/react-dom@18.3.1/client"');
      expect(result).toContain('from "https://esm.sh/react-dom@18.3.1/server"');
    });

    it("should handle empty string", async () => {
      const result = await resolveReactImports("");
      expect(result).toBe("");
    });

    it("should handle code without imports", async () => {
      const code = "const x = 10; console.log(x);";
      const result = await resolveReactImports(code);
      expect(result).toBe(code);
    });
  });

  describe("addDepsToEsmShUrls", () => {
    it("should add deps parameter to esm.sh URL", async () => {
      const code = 'import foo from "https://esm.sh/next-themes@0.4.6"';
      const result = await addDepsToEsmShUrls(code);
      expect(result).toBe(
        'import foo from "https://esm.sh/next-themes@0.4.6?deps=react@18.3.1,react-dom@18.3.1"',
      );
    });

    it("should add deps to scoped packages", async () => {
      const code = 'import { Button } from "https://esm.sh/@radix-ui/react-button@1.0.0"';
      const result = await addDepsToEsmShUrls(code);
      expect(result).toBe(
        'import { Button } from "https://esm.sh/@radix-ui/react-button@1.0.0?deps=react@18.3.1,react-dom@18.3.1"',
      );
    });

    it("should skip URLs that already have query parameters", async () => {
      const code = 'import foo from "https://esm.sh/package@1.0.0?external=react"';
      const result = await addDepsToEsmShUrls(code);
      expect(result).toBe(code);
    });

    it("should skip React imports", async () => {
      const code = 'import React from "https://esm.sh/react@18.3.1"';
      const result = await addDepsToEsmShUrls(code);
      expect(result).toBe(code);
    });

    it("should skip react-dom imports", async () => {
      const code = 'import ReactDOM from "https://esm.sh/react-dom@18.3.1"';
      const result = await addDepsToEsmShUrls(code);
      expect(result).toBe(
        'import ReactDOM from "https://esm.sh/react-dom@18.3.1?deps=react@18.3.1,react-dom@18.3.1"',
      );
    });

    it("should handle multiple esm.sh imports", async () => {
      const code = `import foo from "https://esm.sh/package-a@1.0.0"
import bar from "https://esm.sh/package-b@2.0.0"`;
      const result = await addDepsToEsmShUrls(code);
      expect(result).toContain("package-a@1.0.0?deps=react@18.3.1,react-dom@18.3.1");
      expect(result).toContain("package-b@2.0.0?deps=react@18.3.1,react-dom@18.3.1");
    });

    it("should handle mixed URLs", async () => {
      const code = `import React from "https://esm.sh/react@18.3.1"
import foo from "https://esm.sh/next-themes@0.4.6"
import bar from "https://example.com/package.js"`;
      const result = await addDepsToEsmShUrls(code);

      expect(result).toContain('from "https://esm.sh/react@18.3.1"');
      expect(result).toContain("next-themes@0.4.6?deps=react@18.3.1,react-dom@18.3.1");
      expect(result).toContain('from "https://example.com/package.js"');
    });

    it("should handle URLs with subpaths", async () => {
      const code = 'import { something } from "https://esm.sh/package@1.0.0/subpath"';
      const result = await addDepsToEsmShUrls(code);
      expect(result).toBe(
        'import { something } from "https://esm.sh/package@1.0.0/subpath?deps=react@18.3.1,react-dom@18.3.1"',
      );
    });

    it("should not modify non-esm.sh URLs", async () => {
      const code = 'import foo from "https://cdn.example.com/package.js"';
      const result = await addDepsToEsmShUrls(code);
      expect(result).toBe(code);
    });

    it("should handle whitespace", async () => {
      const code = 'import   foo   from   "https://esm.sh/package@1.0.0"';
      const result = await addDepsToEsmShUrls(code);
      expect(result).toContain("?deps=react@18.3.1,react-dom@18.3.1");
    });

    it("should handle single quotes", async () => {
      const code = "import foo from 'https://esm.sh/package@1.0.0'";
      const result = await addDepsToEsmShUrls(code);
      // Preserves single quotes
      expect(result).toBe(
        "import foo from 'https://esm.sh/package@1.0.0?deps=react@18.3.1,react-dom@18.3.1'",
      );
    });

    it("should handle empty string", async () => {
      const result = await addDepsToEsmShUrls("");
      expect(result).toBe("");
    });

    it("should handle code without imports", async () => {
      const code = "const x = 10; console.log(x);";
      const result = await addDepsToEsmShUrls(code);
      expect(result).toBe(code);
    });
  });

  describe("combined usage", () => {
    it("should work with both functions in sequence", async () => {
      let code = `import React from "react"
import { Button } from "next-themes"`;

      code = await resolveReactImports(code);
      expect(code).toContain('from "https://esm.sh/react@18.3.1"');

      code = code.replace('from "next-themes"', 'from "https://esm.sh/next-themes@0.4.6"');
      code = await addDepsToEsmShUrls(code);

      expect(code).toContain('from "https://esm.sh/react@18.3.1"');
      expect(code).toContain("next-themes@0.4.6?deps=react@18.3.1,react-dom@18.3.1");
    });

    it("should preserve React imports when adding deps", async () => {
      let code = 'import React from "react"';
      code = await resolveReactImports(code);
      code = await addDepsToEsmShUrls(code);

      expect(code).toBe('import React from "https://esm.sh/react@18.3.1"');
      expect(code).not.toContain("?deps");
    });
  });

  describe("rewriteVendorImports", () => {
    it("preserves export statements when rewriting to vendor bundle", async () => {
      const code = `
        export { useState } from "react";
        export { default as React } from 'react';
        export * from "react";
      `;

      const result = await rewriteVendorImports(code, "https://modules", "abc123");

      expect(result).toContain(
        `export { useState } from "https://modules/_vendor.js?v=abc123"`,
      );
      expect(result).toContain(
        `export { default as React } from 'https://modules/_vendor.js?v=abc123'`,
      );
      expect(result).toContain(
        `export * from "https://modules/_vendor.js?v=abc123"`,
      );
      // Should not inject an extra const/assignment for exports
      expect(result.includes("const {")).toBe(false);
    });
  });
});
