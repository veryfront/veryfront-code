# Import rewriter reference

The import rewriter parses a module once, classifies each specifier, and applies
the first matching strategy. Lower numeric priorities run first. A custom
strategy list preserves caller order.

## Default strategies

| Priority | Strategy               | Scope                                                |
| -------: | ---------------------- | ---------------------------------------------------- |
|       -1 | `VendorStrategy`       | Configured React vendor bundle for browser output    |
|        0 | `ReactStrategy`        | React CDN mapping when no vendor bundle applies      |
|      0.5 | `NodeBuiltinStrategy`  | `node:` imports                                      |
|        1 | `AliasStrategy`        | Project aliases such as `@/components/Button`        |
|      1.5 | `VeryfrontStrategy`    | `veryfront/*`, `#veryfront/*`, and framework aliases |
|        2 | `BareStrategy`         | Valid npm package specifiers for browser output      |
|        3 | `RelativeStrategy`     | Relative project imports                             |
|        4 | `CrossProjectStrategy` | `project@version/@/path` and `project/@/path`        |
|        5 | `ImportMapStrategy`    | SSR import-map resolution                            |
|        7 | `UrlStrategy`          | Existing esm.sh URLs                                 |

`BareStrategy` explicitly excludes valid cross-project imports. This is needed
because their syntax can otherwise look like an npm package subpath.

## Resolution behavior

| Specifier                  | Browser                                                    | SSR                                  |
| -------------------------- | ---------------------------------------------------------- | ------------------------------------ |
| `react`                    | Vendor bundle when configured, otherwise pinned esm.sh URL | Pinned React mapping                 |
| `lodash@4.17.21`           | Validated esm.sh URL                                       | Resolved later by the SSR HTTP cache |
| `@/components/Button`      | Module-server URL                                          | SSR module path                      |
| `./Button`                 | Module-server URL when configured                          | Normalized relative module path      |
| `shared-ui@1.0.0/@/Button` | Cross-project module URL                                   | Preserved for SSR resolution         |
| `node:fs`                  | Built-in strategy result                                   | Preserved                            |

Package and cross-project parsers reject parent traversal, encoded traversal,
backslashes, query strings, fragments, empty path segments, invalid project
slugs, and overlong values. URL builders repeat validation so callers cannot
bypass the parser.

## Intentional separate rewrite phase

`rewriteDntImports` in
`src/transforms/mdx/esm-module-loader/module-fetcher/import-rewriter.ts` is not a
unified import strategy. It is an asynchronous filesystem-aware relocation pass
for framework source and generated DNT modules. Moving it into this pipeline
would require an asynchronous strategy contract and the associated cache and
framework-resolution tests.
