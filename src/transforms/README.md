# Transforms

The Transforms domain converts project and framework source into executable
ESM. It owns source compilation, import rewriting, MD/MDX compilation, CSS
modules, transform pipelines, and the disk and distributed cache formats used
by those operations.

## Public surface

Application code should import documented framework APIs from `veryfront`.
Framework internals use `#veryfront/transforms` for:

- `transformToESM()` and the ESM pipeline contracts;
- `MDXRenderer`, `mdxRenderer`, and MDX cache controls;
- registered remark and rehype plugin lists; and
- `clearAllLocalCaches()` for explicit local cache invalidation.

The root barrel is `src/transforms/index.ts`. Route-specific and loader-specific
helpers are internal contracts and should be imported from their owning
submodule only.

## Structure

| Directory          | Responsibility                                                                     |
| ------------------ | ---------------------------------------------------------------------------------- |
| `css-modules/`     | CSS-module compilation and scoped class names                                      |
| `esm/`             | TypeScript/JSX transformation, import parsing, HTTP bundling, and transform caches |
| `import-rewriter/` | Context-aware browser, SSR, and route import rewriting                             |
| `md/`              | Markdown compilation                                                               |
| `mdx/`             | MDX compilation, module loading, dependency graphs, and cache persistence          |
| `pipeline/`        | Ordered transformation stages and stage contracts                                  |
| `plugins/`         | Core access to extension-provided remark and rehype plugins                        |
| `shared/`          | Internal transform utilities shared by subdomains                                  |

## Operational boundaries

- Production route rewriting is lexer-scoped. It edits only parsed module
  specifiers or parsed import statements, never arbitrary import-looking text
  in comments, strings, or templates.
- MDX dependency admission is bounded to 2 MiB of UTF-8 source per module, 500
  static dependencies per file, 500 unique modules per graph, and 16 concurrent
  transforms.
- Filesystem adapters that expose a genuine bounded-read primitive use it
  before decoding. Adapters whose backing API supports only whole-object reads
  are checked before and after the read; those adapters remain responsible for
  bounding responses at their trusted transport boundary.
- A missing or malformed cache index is treated as an empty cache. Operational
  filesystem failures such as permission and I/O errors propagate to the
  caller.
- Cache initialization degrades to a process-local temporary directory only
  for an explicit permission or read-only-filesystem failure. Other failures
  propagate.
- Explicit cache clearing recreates the cache directory and propagates removal
  or creation failures. A reported successful clear therefore leaves a usable,
  empty directory.

## Example

```ts
import { transformToESM } from "#veryfront/transforms";

const result = await transformToESM(source, {
  filename: "component.tsx",
  jsx: "react",
});
```

MDX execution is an internal runtime path:

```ts
import { mdxRenderer } from "#veryfront/transforms";

const module = await mdxRenderer.loadModuleESM(
  compiledCode,
  undefined,
  undefined,
  projectDir,
);
```

## Verification

Tests are co-located with their implementation. Run the complete domain suite
when changing shared transform, cache, or module-loading behavior:

```bash
deno test --allow-all --unstable-worker-options src/transforms/
```

Route import changes also require
`src/routing/api/module-loader/external-import-rewriter.test.ts` and
`src/routing/api/module-loader/loader.test.ts`.
