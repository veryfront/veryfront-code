# @veryfront/ext-parser-babel

> **Category:** Build | **Contract:** `CodeParser` | **Built-in**

Provides JavaScript/TypeScript AST parsing, traversal, and JSX source-position injection for Veryfront, backed by `@babel/parser`, `@babel/traverse`, `@babel/generator`, and `@babel/types`. Used by the transform pipeline and Studio Navigator.

## Registration

This extension is auto-enabled by core bootstrap. Add it to `veryfront.config.ts` only when you need to override the built-in registration:

```ts
import extBabel from "@veryfront/ext-parser-babel";

export default defineConfig({
  extensions: [extBabel()],
});
```

## Provided contract

`CodeParser` exposes:

- `parse(source, options)` / `traverse(ast, visitor)` / `generate(ast, options)`: Generic AST pipeline for callers that want to build custom transforms.
- `injectJsxNodePositions(source, options)`: Studio Navigator helper that stamps `data-node-*` attributes onto JSX elements at compile time.

Core's `src/transforms/plugins/babel-node-positions.ts` is a thin shim that resolves this contract at call time. When the extension is not installed and the shim is invoked, Veryfront throws an install-suggestion error directing the user to add `@veryfront/ext-parser-babel`.

## Configuration

No factory options. The extension reads no environment variables and takes no config.
