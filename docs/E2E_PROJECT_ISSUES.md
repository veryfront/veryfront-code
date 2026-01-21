# E2E Test Project Issues

Projects that fail E2E tests.

| Project | Issue | Fix Location |
|---------|-------|--------------|
| `real-estate-template` | TypeScript `interface` in MDX | Project content |
| `dashboard` | Invalid JSX expression in MDX | Project content |
| `tomcode` | SVG component missing `export default` | **RENDERER BUG** |

## real-estate-template

**Error:** `Could not parse import/exports with acorn`

**Cause:** `pages/index.mdx` contains TypeScript syntax (`interface SearchFilters { ... }`). MDX uses acorn which only parses JavaScript, not TypeScript.

**Fix:** Rename to `.tsx` or move interfaces to a separate `.ts` file.

## dashboard

**Error:** `Could not parse expression with acorn`

**Cause:** `pages/dashboard/index.mdx` contains an invalid JSX expression that acorn cannot parse.

**Fix:** Fix the expression or convert to `.tsx`.

## tomcode

**Error:** `The requested module does not provide an export named 'default'`

**Cause:** SVG components are compiled to JSX but missing `export default`. This is a **renderer bug** in `src/transforms/esm/`.
