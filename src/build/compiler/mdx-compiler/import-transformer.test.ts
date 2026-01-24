import { describe, it } from "#veryfront/testing/bdd.ts";
import { expect } from "#std/expect.ts";
import { transformFinalImports, transformImports } from "./import-transformer.ts";

describe("import-transformer", () => {
  describe("transformImports", () => {
    it("should normalize React import with single quotes", () => {
      expect(transformImports("import React from 'react'")).toBe(
        'import React from "react"',
      );
    });

    it("should normalize React import with double quotes", () => {
      expect(transformImports('import React from "react"')).toBe(
        'import React from "react"',
      );
    });

    it("should normalize jsx-runtime import with single quotes", () => {
      expect(transformImports("import {jsx} from 'react/jsx-runtime'")).toBe(
        'import {jsx} from "react/jsx-runtime"',
      );
    });

    it("should normalize jsx-runtime import with double quotes", () => {
      expect(transformImports('import {jsx} from "react/jsx-runtime"')).toBe(
        'import {jsx} from "react/jsx-runtime"',
      );
    });

    it("should normalize jsx-dev-runtime import", () => {
      expect(transformImports("import {jsxDEV} from 'react/jsx-dev-runtime'"))
        .toBe('import {jsxDEV} from "react/jsx-dev-runtime"');
    });

    it("should handle multiple imports in jsx-runtime", () => {
      expect(
        transformImports("import {jsx, jsxs, Fragment} from 'react/jsx-runtime'"),
      ).toBe('import {jsx, jsxs, Fragment} from "react/jsx-runtime"');
    });

    it("should handle imports with whitespace", () => {
      expect(transformImports("import   React   from   'react'")).toBe(
        'import React from "react"',
      );
    });

    it("should preserve import with spaces in braces", () => {
      expect(transformImports("import { jsx, jsxs } from 'react/jsx-runtime'"))
        .toBe('import { jsx, jsxs } from "react/jsx-runtime"');
    });

    it("should not modify other imports", () => {
      expect(transformImports("import { foo } from 'bar'")).toBe(
        "import { foo } from 'bar'",
      );
    });

    it("should handle multiple React imports on different lines", () => {
      const result = transformImports(`import React from 'react'
import {jsx} from 'react/jsx-runtime'`);

      expect(result).toContain('import React from "react"');
      expect(result).toContain('import {jsx} from "react/jsx-runtime"');
    });

    it("should handle empty string", () => {
      expect(transformImports("")).toBe("");
    });

    it("should preserve code without imports", () => {
      const code = "const x = 10; console.log(x);";
      expect(transformImports(code)).toBe(code);
    });
  });

  describe("transformFinalImports", () => {
    it("should normalize react import from clause", () => {
      expect(transformFinalImports("import React from 'react'")).toBe(
        'import React from "react"',
      );
    });

    it("should normalize jsx-runtime from clause", () => {
      expect(transformFinalImports("import {jsx} from 'react/jsx-runtime'"))
        .toBe('import {jsx} from "react/jsx-runtime"');
    });

    it("should normalize jsx-dev-runtime from clause", () => {
      expect(transformFinalImports("import {jsxDEV} from 'react/jsx-dev-runtime'"))
        .toBe('import {jsxDEV} from "react/jsx-dev-runtime"');
    });

    it("should normalize component imports", () => {
      expect(
        transformFinalImports(
          "import MyComponent from '../shared/components/MyComponent.tsx'",
        ),
      ).toBe('import MyComponent from "../shared/components/MyComponent.tsx";');
    });

    it("should handle component imports without semicolon", () => {
      expect(
        transformFinalImports(
          "import Button from '../shared/components/Button.tsx'",
        ),
      ).toBe('import Button from "../shared/components/Button.tsx";');
    });

    it("should handle component imports with semicolon", () => {
      expect(
        transformFinalImports(
          "import Button from '../shared/components/Button.tsx';",
        ),
      ).toBe('import Button from "../shared/components/Button.tsx";');
    });

    it("should handle multiple component imports", () => {
      const result = transformFinalImports(`import Button from '../shared/components/Button.tsx'
import Card from '../shared/components/Card.tsx'`);

      expect(result).toContain('import Button from "../shared/components/Button.tsx";');
      expect(result).toContain('import Card from "../shared/components/Card.tsx";');
    });

    it("should handle all React imports together", () => {
      const result = transformFinalImports(`import React from 'react'
import {jsx} from 'react/jsx-runtime'
import {jsxDEV} from 'react/jsx-dev-runtime'`);

      expect(result).toContain('from "react"');
      expect(result).toContain('from "react/jsx-runtime"');
      expect(result).toContain('from "react/jsx-dev-runtime"');
    });

    it("should handle empty string", () => {
      expect(transformFinalImports("")).toBe("");
    });

    it("should preserve code without imports", () => {
      const code = "const x = 10; console.log(x);";
      expect(transformFinalImports(code)).toBe(code);
    });

    it("should not modify non-matching imports", () => {
      const code = "import { foo } from 'bar'";
      expect(transformFinalImports(code)).toBe(code);
    });

    it("should handle mixed import styles", () => {
      const result = transformFinalImports(`import React from 'react'
import Button from '../shared/components/Button.tsx'
import { useState } from 'react'`);

      expect(result).toContain('from "react"');
      expect(result).toContain('from "../shared/components/Button.tsx";');
    });
  });

  describe("transform pipeline", () => {
    it("should work when both transforms are applied", () => {
      const code = transformFinalImports(transformImports("import React from 'react'"));
      expect(code).toBe('import React from "react"');
    });

    it("should handle complete MDX compiled code", () => {
      const code = transformFinalImports(
        transformImports(`import React from 'react'
import {jsx} from 'react/jsx-runtime'
import MyComponent from '../shared/components/MyComponent.tsx'

export default function MDXContent() {
  return jsx('div', {}, 'Hello World');
}`),
      );

      expect(code).toContain('from "react"');
      expect(code).toContain('from "react/jsx-runtime"');
      expect(code).toContain('from "../shared/components/MyComponent.tsx";');
    });
  });
});
