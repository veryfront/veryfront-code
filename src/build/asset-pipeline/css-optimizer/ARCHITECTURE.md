# CSS optimization pipeline

This document explains the design and operating contract of the CSS optimizer.
Public option and result shapes remain defined in
[`types/index.ts`](./types/index.ts); resource bounds and pinned dependencies
remain defined in [`constants.ts`](./constants.ts).

## Contract

`CSSOptimizer` is the public facade. It resolves the runtime adapter once and
delegates to `CSSOptimizerService`. The service treats an optimization as one
publication:

1. Validate the project boundary, configuration, and required filesystem
   capabilities.
2. Discover regular `.css` inputs deterministically within configured bounds.
3. If enabled, remove unused rules with PurgeCSS using validated project
   content.
4. Transform every stylesheet with Lightning CSS, including browser-target
   compilation, minification, and optional source maps.
5. Write all CSS files, maps, and the complete manifest into an isolated
   staging directory.
6. Atomically replace the prior output only after every file and the manifest
   succeed.

Concurrent calls on one optimizer instance share the same in-flight run and
receive defensive copies of its result. A later failed run leaves the last
published output and in-memory cache unchanged.

## Why the stages have a fixed order

Purging and CSS compilation are complementary transformations rather than
alternative strategies. PurgeCSS must see the uncompiled rule structure and
content evidence first. Lightning CSS then parses and emits the final syntax.
The service therefore uses a fixed `purge -> compile` pipeline; strategy
priority values remain exported only for compatibility with callers that
instantiate the strategy classes directly.

Lightning CSS and Browserslist are required for batch optimization. PurgeCSS is
required when purging or critical-CSS extraction is requested. Missing,
malformed, or failing dependencies reject the operation. There is no CDN
import, regex minifier, or partial-success fallback.

## Filesystem and publication safety

The project directory is an absolute trust boundary. Input, output, and content
patterns must resolve within it; input and output trees cannot overlap.
Discovery skips symlinks, sorts paths, and enforces file-count, depth, entry,
per-file, and aggregate byte limits.

Output paths are derived from normalized project-relative input paths and
checked for case-folded and Unicode-normalized collisions. Source maps are
validated before staging. The publication helper serializes writers targeting
the same output and restores the previous directory if promotion fails.

The generated `css-manifest.json` contains complete bundle records, including
the emitted CSS and optional source map. `loadCSSManifest()` validates
structure, paths, sizes, collision freedom, and statistics. It can hydrate the
older content-free manifest format from the corresponding generated CSS file;
all other malformed manifests reject.

## Purging and critical CSS

Batch purging requires at least one matching content file. Missing optional
static roots contribute no matches, while permission and I/O failures remain
fatal. Dynamic selectors must be declared with `purgeSafelist`; silent
retention guesses are not made.

Purge output cannot currently be composed with a trustworthy source map, so
`purge: true` with `sourceMap: true` rejects explicitly.

Critical CSS depends on a specific HTML document and is therefore exposed only
through `CSSOptimizer.extractCriticalCSS(cssPath, html)`. Setting the legacy
`criticalCSS` batch option rejects with migration guidance. The extraction API
uses PurgeCSS's parsed retained/rejected outputs so nested at-rules stay
structurally valid.

## Failure model

Configuration errors, unsafe paths, missing inputs, invalid CSS, dependency
failures, malformed source maps, exhausted resource bounds, write failures, and
manifest failures all reject the run. Work already written during that run is
confined to staging and cleaned up. Cleanup failures are reported together with
the original failure instead of masking it.

Disabled optimization is the only successful no-op. An enabled batch with no
CSS inputs rejects because publishing an apparently successful empty result
would conceal a configuration error.
