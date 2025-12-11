
import { describe, it } from "@std/testing/bdd.ts";
import { expect } from "@std/expect";
import { transformFinalImports, transformImports } from "./import-transformer.ts";

describe("import-transformer", () => {
  describe("transformImports", () => {
    it("should normalize React import with single quotes", () => {
      const code = "import React from 'react'";
      const result = transformImports(code);
      expect(result).toBe('import React from "react"');
    });

    it("should normalize React import with double quotes", () => {
      const code = 'import React from "react"';
      const result = transformImports(code);
      expect(result).toBe('import React from "react"');
    });

    it("should normalize jsx-runtime import with single quotes", () => {
      const code = "import {jsx} from 'react/jsx-runtime'";
      const result = transformImports(code);
      expect(result).toBe('import {jsx} from "react/jsx-runtime"');
    });

    it("should normalize jsx-runtime import with double quotes", () => {
      const code = 'import {jsx} from "react/jsx-runtime"';
      const result = transformImports(code);
      expect(result).toBe('import {jsx} from "react/jsx-runtime"');
    });

    it("should normalize jsx-dev-runtime import", () => {
      const code = "import {jsxDEV} from 'react/jsx-dev-runtime'";
      const result = transformImports(code);
      expect(result).toBe('import {jsxDEV} from "react/jsx-dev-runtime"');
    });

    it("should handle multiple imports in jsx-runtime", () => {
      const code = "import {jsx, jsxs, Fragment} from 'react/jsx-runtime'";
      const result = transformImports(code);
      expect(result).toBe('import {jsx, jsxs, Fragment} from "react/jsx-runtime"');
    });

    it("should handle imports with whitespace", () => {
      const code = "import   React   from   'react'";
      const result = transformImports(code);
      expect(result).toBe('import React from "react"');
    });

    it("should preserve import with spaces in braces", () => {
      const code = "import { jsx, jsxs } from 'react/jsx-runtime'";
      const result = transformImports(code);
      expect(result).toBe('import { jsx, jsxs } from "react/jsx-runtime"');
    });

    it("should not modify other imports", () => {
      const code = "import { foo } from 'bar'";
      const result = transformImports(code);
      expect(result).toBe("import { foo } from 'bar'");
    });

    it("should handle multiple React imports on different lines", () => {
      const code = `import React from 'react'
import {jsx} from 'react/jsx-runtime'`;
      const result = transformImports(code);
      expect(result).toContain('import React from "react"');
      expect(result).toContain('import {jsx} from "react/jsx-runtime"');
    });

    it("should handle empty string", () => {
      const result = transformImports("");
      expect(result).toBe("");
    });

    it("should preserve code without imports", () => {
      const code = "const x = 10; console.log(x);";
      const result = transformImports(code);
      expect(result).toBe(code);
    });
  });

  describe("transformFinalImports", () => {
    it("should normalize react import from clause", () => {
      const code = "import React from 'react'";
      const result = transformFinalImports(code);
      expect(result).toBe('import React from "react"');
    });

    it("should normalize jsx-runtime from clause", () => {
      const code = "import {jsx} from 'react/jsx-runtime'";
      const result = transformFinalImports(code);
      expect(result).toBe('import {jsx} from "react/jsx-runtime"');
    });

    it("should normalize jsx-dev-runtime from clause", () => {
      const code = "import {jsxDEV} from 'react/jsx-dev-runtime'";
      const result = transformFinalImports(code);
      expect(result).toBe('import {jsxDEV} from "react/jsx-dev-runtime"');
    });

    it("should normalize component imports", () => {
      const code = "import MyComponent from '../shared/components/MyComponent.tsx'";
      const result = transformFinalImports(code);
      expect(result).toBe('import MyComponent from "../shared/components/MyComponent.tsx";');
    });

    it("should handle component imports without semicolon", () => {
      const code = "import Button from '../shared/components/Button.tsx'";
      const result = transformFinalImports(code);
      expect(result).toBe('import Button from "../shared/components/Button.tsx";');
    });

    it("should handle component imports with semicolon", () => {
      const code = "import Button from '../shared/components/Button.tsx';";
      const result = transformFinalImports(code);
      expect(result).toBe('import Button from "../shared/components/Button.tsx";');
    });

    it("should handle multiple component imports", () => {
      const code = `import Button from '../shared/components/Button.tsx'
import Card from '../shared/components/Card.tsx'`;
      const result = transformFinalImports(code);
      expect(result).toContain('import Button from "../shared/components/Button.tsx";');
      expect(result).toContain('import Card from "../shared/components/Card.tsx";');
    });

    it("should handle all React imports together", () => {
      const code = `import React from 'react'
import {jsx} from 'react/jsx-runtime'
import {jsxDEV} from 'react/jsx-dev-runtime'`;
      const result = transformFinalImports(code);
      expect(result).toContain('from "react"');
      expect(result).toContain('from "react/jsx-runtime"');
      expect(result).toContain('from "react/jsx-dev-runtime"');
    });

    it("should handle empty string", () => {
      const result = transformFinalImports("");
      expect(result).toBe("");
    });

    it("should preserve code without imports", () => {
      const code = "const x = 10; console.log(x);";
      const result = transformFinalImports(code);
      expect(result).toBe(code);
    });

    it("should not modify non-matching imports", () => {
      const code = "import { foo } from 'bar'";
      const result = transformFinalImports(code);
      expect(result).toBe(code);
    });

    it("should handle mixed import styles", () => {
      const code = `import React from 'react'
import Button from '../shared/components/Button.tsx'
import { useState } from 'react'`;
      const result = transformFinalImports(code);
      expect(result).toContain('from "react"');
      expect(result).toContain('from "../shared/components/Button.tsx";');
    });
  });

  describe("transform pipeline", () => {
    it("should work when both transforms are applied", () => {
      let code = "import React from 'react'";
      code = transformImports(code);
      code = transformFinalImports(code);
      expect(code).toBe('import React from "react"');
    });

    it("should handle complete MDX compiled code", () => {
      let code = `import React from 'react'
import {jsx} from 'react/jsx-runtime'
import MyComponent from '../shared/components/MyComponent.tsx'

export default function MDXContent() {
  return jsx('div', {}, 'Hello World');
}`;
      code = transformImports(code);
      code = transformFinalImports(code);

      expect(code).toContain('from "react"');
      expect(code).toContain('from "react/jsx-runtime"');
      expect(code).toContain('from "../shared/components/MyComponent.tsx";');
    });
  });
});
