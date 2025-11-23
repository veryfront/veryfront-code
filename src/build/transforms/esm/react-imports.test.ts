import { describe, it } from "@std/testing/bdd.ts";
import { expect } from "@std/expect";
import { addDepsToEsmShUrls, resolveReactImports } from "./react-imports.ts";

describe("react-imports", () => {
  describe("resolveReactImports", () => {
    it("should resolve bare React import to CDN URL", () => {
      const code = 'import React from "react"';
      const result = resolveReactImports(code);
      expect(result).toBe('import React from "https://esm.sh/react@18.3.1"');
    });

    it("should resolve bare React import with single quotes", () => {
      const code = "import React from 'react'";
      const result = resolveReactImports(code);
      expect(result).toBe('import React from "https://esm.sh/react@18.3.1"');
    });

    it("should resolve react/jsx-runtime import", () => {
      const code = 'import { jsx } from "react/jsx-runtime"';
      const result = resolveReactImports(code);
      expect(result).toBe('import { jsx } from "https://esm.sh/react@18.3.1/jsx-runtime"');
    });

    it("should resolve react/jsx-dev-runtime import", () => {
      const code = 'import { jsxDEV } from "react/jsx-dev-runtime"';
      const result = resolveReactImports(code);
      expect(result).toBe('import { jsxDEV } from "https://esm.sh/react@18.3.1/jsx-dev-runtime"');
    });

    it("should resolve react-dom import", () => {
      const code = 'import ReactDOM from "react-dom"';
      const result = resolveReactImports(code);
      expect(result).toBe('import ReactDOM from "https://esm.sh/react-dom@18.3.1"');
    });

    it("should resolve react-dom/server import", () => {
      const code = 'import { renderToString } from "react-dom/server"';
      const result = resolveReactImports(code);
      expect(result).toBe(
        'import { renderToString } from "https://esm.sh/react-dom@18.3.1/server"',
      );
    });

    it("should resolve react-dom/client import", () => {
      const code = 'import { createRoot } from "react-dom/client"';
      const result = resolveReactImports(code);
      expect(result).toBe('import { createRoot } from "https://esm.sh/react-dom@18.3.1/client"');
    });

    it("should handle multiple React imports in order", () => {
      const code = `import React from "react"
import { jsx } from "react/jsx-runtime"
import ReactDOM from "react-dom"`;
      const result = resolveReactImports(code);
      expect(result).toContain('from "https://esm.sh/react@18.3.1"');
      expect(result).toContain('from "https://esm.sh/react@18.3.1/jsx-runtime"');
      expect(result).toContain('from "https://esm.sh/react-dom@18.3.1"');
    });

    it("should prioritize specific paths over generic react", () => {
      const code = 'import { jsx } from "react/jsx-runtime"';
      const result = resolveReactImports(code);
      expect(result).toBe('import { jsx } from "https://esm.sh/react@18.3.1/jsx-runtime"');
      expect(result).not.toContain("https://esm.sh/react@18.3.1/jsx-runtime@18.3.1");
    });

    it("should handle whitespace in imports", () => {
      const code = 'import   React   from   "react"';
      const result = resolveReactImports(code);
      expect(result).toBe('import   React   from "https://esm.sh/react@18.3.1"');
    });

    it("should not modify already resolved React URLs", () => {
      const code = 'import React from "https://esm.sh/react@18.3.1"';
      const result = resolveReactImports(code);
      expect(result).toBe(code);
    });

    it("should not modify non-React imports", () => {
      const code = 'import { something } from "other-package"';
      const result = resolveReactImports(code);
      expect(result).toBe(code);
    });

    it("should handle React import in larger code block", () => {
      const code = `
        import React from "react"

        export function MyComponent() {
          return <div>Hello</div>
        }
      `;
      const result = resolveReactImports(code);
      expect(result).toContain('import React from "https://esm.sh/react@18.3.1"');
      expect(result).toContain("export function MyComponent()");
    });

    it("should handle all React import types together", () => {
      const code = `import React from "react"
import { jsx, jsxs } from "react/jsx-runtime"
import { jsxDEV } from "react/jsx-dev-runtime"
import ReactDOM from "react-dom"
import { createRoot } from "react-dom/client"
import { renderToString } from "react-dom/server"`;
      const result = resolveReactImports(code);

      expect(result).toContain('from "https://esm.sh/react@18.3.1"');
      expect(result).toContain('from "https://esm.sh/react@18.3.1/jsx-runtime"');
      expect(result).toContain('from "https://esm.sh/react@18.3.1/jsx-dev-runtime"');
      expect(result).toContain('from "https://esm.sh/react-dom@18.3.1"');
      expect(result).toContain('from "https://esm.sh/react-dom@18.3.1/client"');
      expect(result).toContain('from "https://esm.sh/react-dom@18.3.1/server"');
    });

    it("should handle empty string", () => {
      const result = resolveReactImports("");
      expect(result).toBe("");
    });

    it("should handle code without imports", () => {
      const code = "const x = 10; console.log(x);";
      const result = resolveReactImports(code);
      expect(result).toBe(code);
    });
  });

  describe("addDepsToEsmShUrls", () => {
    it("should add deps parameter to esm.sh URL", () => {
      const code = 'import foo from "https://esm.sh/next-themes@0.4.6"';
      const result = addDepsToEsmShUrls(code);
      expect(result).toBe(
        'import foo from "https://esm.sh/next-themes@0.4.6?deps=react@18.3.1,react-dom@18.3.1"',
      );
    });

    it("should add deps to scoped packages", () => {
      const code = 'import { Button } from "https://esm.sh/@radix-ui/react-button@1.0.0"';
      const result = addDepsToEsmShUrls(code);
      expect(result).toBe(
        'import { Button } from "https://esm.sh/@radix-ui/react-button@1.0.0?deps=react@18.3.1,react-dom@18.3.1"',
      );
    });

    it("should skip URLs that already have query parameters", () => {
      const code = 'import foo from "https://esm.sh/package@1.0.0?external=react"';
      const result = addDepsToEsmShUrls(code);
      expect(result).toBe(code);
    });

    it("should skip React imports", () => {
      const code = 'import React from "https://esm.sh/react@18.3.1"';
      const result = addDepsToEsmShUrls(code);
      expect(result).toBe(code);
    });

    it("should skip react-dom imports", () => {
      const code = 'import ReactDOM from "https://esm.sh/react-dom@18.3.1"';
      const result = addDepsToEsmShUrls(code);
      expect(result).toBe(
        'import ReactDOM from "https://esm.sh/react-dom@18.3.1?deps=react@18.3.1,react-dom@18.3.1"',
      );
    });

    it("should handle multiple esm.sh imports", () => {
      const code = `import foo from "https://esm.sh/package-a@1.0.0"
import bar from "https://esm.sh/package-b@2.0.0"`;
      const result = addDepsToEsmShUrls(code);
      expect(result).toContain("package-a@1.0.0?deps=react@18.3.1,react-dom@18.3.1");
      expect(result).toContain("package-b@2.0.0?deps=react@18.3.1,react-dom@18.3.1");
    });

    it("should handle mixed URLs", () => {
      const code = `import React from "https://esm.sh/react@18.3.1"
import foo from "https://esm.sh/next-themes@0.4.6"
import bar from "https://example.com/package.js"`;
      const result = addDepsToEsmShUrls(code);

      expect(result).toContain('from "https://esm.sh/react@18.3.1"');
      expect(result).toContain("next-themes@0.4.6?deps=react@18.3.1,react-dom@18.3.1");
      expect(result).toContain('from "https://example.com/package.js"');
    });

    it("should handle URLs with subpaths", () => {
      const code = 'import { something } from "https://esm.sh/package@1.0.0/subpath"';
      const result = addDepsToEsmShUrls(code);
      expect(result).toBe(
        'import { something } from "https://esm.sh/package@1.0.0/subpath?deps=react@18.3.1,react-dom@18.3.1"',
      );
    });

    it("should not modify non-esm.sh URLs", () => {
      const code = 'import foo from "https://cdn.example.com/package.js"';
      const result = addDepsToEsmShUrls(code);
      expect(result).toBe(code);
    });

    it("should handle whitespace", () => {
      const code = 'import   foo   from   "https://esm.sh/package@1.0.0"';
      const result = addDepsToEsmShUrls(code);
      expect(result).toContain("?deps=react@18.3.1,react-dom@18.3.1");
    });

    it("should handle single quotes", () => {
      const code = "import foo from 'https://esm.sh/package@1.0.0'";
      const result = addDepsToEsmShUrls(code);
      expect(result).toBe(
        'import foo from "https://esm.sh/package@1.0.0?deps=react@18.3.1,react-dom@18.3.1"',
      );
    });

    it("should handle empty string", () => {
      const result = addDepsToEsmShUrls("");
      expect(result).toBe("");
    });

    it("should handle code without imports", () => {
      const code = "const x = 10; console.log(x);";
      const result = addDepsToEsmShUrls(code);
      expect(result).toBe(code);
    });
  });

  describe("combined usage", () => {
    it("should work with both functions in sequence", () => {
      let code = `import React from "react"
import { Button } from "next-themes"`;

      code = resolveReactImports(code);
      expect(code).toContain('from "https://esm.sh/react@18.3.1"');

      code = code.replace('from "next-themes"', 'from "https://esm.sh/next-themes@0.4.6"');
      code = addDepsToEsmShUrls(code);

      expect(code).toContain('from "https://esm.sh/react@18.3.1"');
      expect(code).toContain("next-themes@0.4.6?deps=react@18.3.1,react-dom@18.3.1");
    });

    it("should preserve React imports when adding deps", () => {
      let code = 'import React from "react"';
      code = resolveReactImports(code);
      code = addDepsToEsmShUrls(code);

      expect(code).toBe('import React from "https://esm.sh/react@18.3.1"');
      expect(code).not.toContain("?deps");
    });
  });
});
