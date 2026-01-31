import { describe, it } from "#veryfront/testing/bdd.ts";
import { expect } from "#std/expect.ts";
import { transformFinalImports, transformImports } from "./import-transformer.ts";

function expectTransformImports(input: string, output: string): void {
  expect(transformImports(input)).toBe(output);
}

function expectTransformFinalImports(input: string, output: string): void {
  expect(transformFinalImports(input)).toBe(output);
}

describe("import-transformer", () => {
  describe("transformImports", () => {
    it("should normalize React import with single quotes", () => {
      expectTransformImports("import React from 'react'", 'import React from "react"');
    });

    it("should normalize React import with double quotes", () => {
      expectTransformImports('import React from "react"', 'import React from "react"');
    });

    it("should normalize jsx-runtime import with single quotes", () => {
      expectTransformImports(
        "import {jsx} from 'react/jsx-runtime'",
        'import {jsx} from "react/jsx-runtime"',
      );
    });

    it("should normalize jsx-runtime import with double quotes", () => {
      expectTransformImports(
        'import {jsx} from "react/jsx-runtime"',
        'import {jsx} from "react/jsx-runtime"',
      );
    });

    it("should normalize jsx-dev-runtime import", () => {
      expectTransformImports(
        "import {jsxDEV} from 'react/jsx-dev-runtime'",
        'import {jsxDEV} from "react/jsx-dev-runtime"',
      );
    });

    it("should handle multiple imports in jsx-runtime", () => {
      expectTransformImports(
        "import {jsx, jsxs, Fragment} from 'react/jsx-runtime'",
        'import {jsx, jsxs, Fragment} from "react/jsx-runtime"',
      );
    });

    it("should handle imports with whitespace", () => {
      expectTransformImports(
        "import   React   from   'react'",
        'import React from "react"',
      );
    });

    it("should preserve import with spaces in braces", () => {
      expectTransformImports(
        "import { jsx, jsxs } from 'react/jsx-runtime'",
        'import { jsx, jsxs } from "react/jsx-runtime"',
      );
    });

    it("should not modify other imports", () => {
      expectTransformImports("import { foo } from 'bar'", "import { foo } from 'bar'");
    });

    it("should handle multiple React imports on different lines", () => {
      const result = transformImports(`import React from 'react'
import {jsx} from 'react/jsx-runtime'`);

      expect(result).toContain('import React from "react"');
      expect(result).toContain('import {jsx} from "react/jsx-runtime"');
    });

    it("should handle empty string", () => {
      expectTransformImports("", "");
    });

    it("should preserve code without imports", () => {
      const code = "const x = 10; console.log(x);";
      expectTransformImports(code, code);
    });
  });

  describe("transformFinalImports", () => {
    it("should normalize react import from clause", () => {
      expectTransformFinalImports("import React from 'react'", 'import React from "react"');
    });

    it("should normalize jsx-runtime from clause", () => {
      expectTransformFinalImports(
        "import {jsx} from 'react/jsx-runtime'",
        'import {jsx} from "react/jsx-runtime"',
      );
    });

    it("should normalize jsx-dev-runtime from clause", () => {
      expectTransformFinalImports(
        "import {jsxDEV} from 'react/jsx-dev-runtime'",
        'import {jsxDEV} from "react/jsx-dev-runtime"',
      );
    });

    it("should normalize component imports", () => {
      expectTransformFinalImports(
        "import MyComponent from '../shared/components/MyComponent.tsx'",
        'import MyComponent from "../shared/components/MyComponent.tsx";',
      );
    });

    it("should handle component imports without semicolon", () => {
      expectTransformFinalImports(
        "import Button from '../shared/components/Button.tsx'",
        'import Button from "../shared/components/Button.tsx";',
      );
    });

    it("should handle component imports with semicolon", () => {
      expectTransformFinalImports(
        "import Button from '../shared/components/Button.tsx';",
        'import Button from "../shared/components/Button.tsx";',
      );
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
      expectTransformFinalImports("", "");
    });

    it("should preserve code without imports", () => {
      const code = "const x = 10; console.log(x);";
      expectTransformFinalImports(code, code);
    });

    it("should not modify non-matching imports", () => {
      const code = "import { foo } from 'bar'";
      expectTransformFinalImports(code, code);
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
