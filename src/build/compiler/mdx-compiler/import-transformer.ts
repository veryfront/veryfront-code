export function transformImports(code: string): string {
  return code
    .replace(/import\s+React\s+from\s+["']react["']/g, 'import React from "react"')
    .replace(
      /import\s+\{([^}]+)\}\s+from\s+["']react\/jsx-runtime["']/g,
      'import {$1} from "react/jsx-runtime"',
    )
    .replace(
      /import\s+\{([^}]+)\}\s+from\s+["']react\/jsx-dev-runtime["']/g,
      'import {$1} from "react/jsx-dev-runtime"',
    );
}

export function transformFinalImports(code: string): string {
  return code
    .replace(/from\s+["']react["']/g, 'from "react"')
    .replace(/from\s+["']react\/jsx-runtime["']/g, 'from "react/jsx-runtime"')
    .replace(/from\s+["']react\/jsx-dev-runtime["']/g, 'from "react/jsx-dev-runtime"')
    .replace(
      /import\s+(\w+)\s+from\s+['"]\.\.\/shared\/components\/(\w+)\.tsx['"];?/g,
      'import $1 from "../shared/components/$2.tsx";',
    )
    .replace(
      /import\s+(\w+)\s+from\s+['"]\.\.\/components\/(\w+)\.tsx['"];?/g,
      'import $1 from "../components/$2.tsx";',
    );
}
