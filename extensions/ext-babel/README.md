# @veryfront/ext-babel

Veryfront extension that registers the `CodeParser` contract, backed by `@babel/parser`, `@babel/traverse`, `@babel/generator`, and `@babel/types`. Used by Veryfront's transform pipeline and the Studio Navigator to parse, traverse, and generate JavaScript / TypeScript AST.

## Installation

Add the extension to your project's `veryfront.config.ts`:

```ts
import extBabel from "@veryfront/ext-babel";

export default defineConfig({
  extensions: [extBabel()],
});
```

## Provided contract

`CodeParser` — exposes:

- `parse(source, options)` / `traverse(ast, visitor)` / `generate(ast, options)` — generic AST pipeline for callers that want to build custom transforms.
- `injectJsxNodePositions(source, options)` — the Studio Navigator helper that stamps `data-node-*` attributes onto JSX elements at compile time.

Core's `src/transforms/plugins/babel-node-positions.ts` is a thin shim that resolves this contract at call time. When the extension is not installed and the shim is invoked, Veryfront throws an install-suggestion error directing the user to add `@veryfront/ext-babel`.

## Configuration

No factory options. The extension reads no environment variables and takes no config.
