# HTML runtime

The HTML module assembles server-rendered content into complete documents. It
owns document shells, metadata tags, import maps, hydration payloads, runtime
scripts, CSP nonce propagation, and project CSS references.

This is an internal framework module. Source code imports it through
`#veryfront/html`. The package export map does not expose `veryfront/html` as a
public application API.

## Explanation

### Responsibilities and boundaries

The module accepts already-rendered HTML and trusted runtime context. It does
not render React components, route requests, or build application bundles.

- `rendering/` produces the rendered page or full document.
- `html/` validates document inputs and assembles the final HTML.
- `styles-builder/` compiles and caches project CSS artifacts.
- `server/` sends the generated document and serves referenced assets.

Keep these boundaries explicit. Hydration JSON is not an AG-UI stream, CSS
artifact state is not durable run state, and HTML generation must not perform
request routing.

### Document generation flow

`wrapInHTMLShell` performs the normal fragment-to-document path:

1. Validate runtime mode, identifiers, paths, metadata, and resource budgets.
2. Resolve one release-asset manifest snapshot and one import-map snapshot.
3. Select immutable release CSS or compile project CSS when production needs it.
4. Generate metadata, preload hints, hydration data, and runtime scripts.
5. Return the shell start, rendered content, and shell end as one bounded HTML
   document.

`injectHTMLContent` handles a page that already returned a complete HTML
document. It replaces supported placeholders and adds the same framework
assets without wrapping the document in another shell.

### Trust and resource model

Treat page metadata, route params, component props, project paths, import maps,
release manifests, and extension output as untrusted at runtime.

- Escape text and attribute values for their exact HTML context.
- Escape inline JSON so `</script>` and Unicode line separators cannot end a
  script element.
- Snapshot hydration JSON without running getters or user-defined `toJSON`
  hooks.
- Reject cycles, unsupported JSON values, unsafe paths, excessive nesting, and
  oversized collections.
- Require a project root before converting an absolute filesystem path to a
  browser-visible module path.
- Fail closed when required production CSS or hydration data is invalid.

Central limits live in `limits.ts`. Stylesheet-specific limits live in
`styles-builder/resource-limits.ts`. Add or change a limit there instead of
placing a new numeric threshold in a caller.

### Development and production behavior

Local development and preview documents load development scripts, error
reporting, and cache-busted project CSS. Production documents load the
versioned hydration runtime and prefer immutable CSS and module URLs from a
ready release manifest. A missing valid production CSS result is an error, not
an instruction to return an unstyled page.

## Reference

### Internal entrypoint

`index.ts` exports these supported module surfaces:

| Surface                  | Signature or purpose                                                                   |
| ------------------------ | -------------------------------------------------------------------------------------- |
| `wrapInHTMLShell`        | `(content, metadata, options, params?, props?, projectCSSPromise?) => Promise<string>` |
| `generateHTMLShellParts` | Returns bounded `{ start, end }` shell fragments for streaming callers.                |
| `injectHTMLContent`      | `(template, content, metadata, options) => string`                                     |
| `isFullHTMLDocument`     | Detects a complete HTML5 document, not an HTML-looking fragment.                       |
| `processMetadata`        | Converts `RenderMetadata` into validated document metadata and tags.                   |
| `extractHTMLMetadata`    | Merges page and layout frontmatter into `HTMLMetadata`.                                |
| `generateMetaTags`       | Generates escaped `<meta>` elements.                                                   |
| `generateLinkTags`       | Generates escaped `<link>` elements.                                                   |
| `generateScriptTags`     | Generates escaped script elements and applies an optional nonce.                       |
| `generateStyleTags`      | Generates escaped style and stylesheet elements.                                       |
| `generateHydrationData`  | Serializes validated page state for browser hydration.                                 |
| `getDevScripts`          | Generates development hydration, component-manifest, error, and HMR scripts.           |
| `getProdScripts`         | Generates the versioned production hydration-runtime script.                           |
| `getDevStyles`           | Generates development indicator and error-overlay styles.                              |
| `escapeHTML`             | Escapes a value for HTML text or a quoted attribute.                                   |
| `buildAttributes`        | Validates and renders an attribute record.                                             |
| `buildImportMapJson`     | Builds validated import-map JSON with a bounded cache.                                 |
| `buildRootAttributes`    | Builds the framework root element attributes.                                          |
| `shouldDisableLayout`    | Reads the supported frontmatter layout-disable values.                                 |

The exact option types are generated from `schemas/html.schema.ts` and
re-exported by `types.ts`. Runtime-only release-manifest context is represented
by `HTMLRuntimeGenerationOptions` and is not part of the public schema type.

### Main implementation areas

```text
src/html/
|-- html-shell-generator.ts       Complete shell assembly
|-- html-injection.ts             Existing-document placeholder injection
|-- metadata-*.ts                 Frontmatter normalization and tag metadata
|-- tag-generators.ts             Context-aware tag generation
|-- html-escape.ts                Text, attribute, script, and style escaping
|-- hydration-script-builder/     Hydration data and browser runtime scripts
|-- styles-builder/               Project CSS compilation and bounded caches
|-- import-map-validation.ts      Import-map structural and size validation
|-- json-snapshot.ts              Getter-free bounded JSON snapshots
|-- path-safety.ts                Module-path decoding and traversal checks
|-- nonce-injection.ts            Streaming CSP nonce injection
|-- schemas/                      Shared generation and hydration schemas
`-- limits.ts                     HTML and hydration resource limits
```

### Placeholder reference

`injectHTMLContent` recognizes these placeholders:

| Placeholder         | Replacement                  |
| ------------------- | ---------------------------- |
| `{{ content }}`     | Rendered page content        |
| `{{ title }}`       | Escaped metadata title       |
| `{{ description }}` | Escaped metadata description |
| `{{ meta }}`        | Generated meta tags          |
| `{{ links }}`       | Generated link tags          |
| `{{ scripts }}`     | Metadata scripts             |
| `{{ styles }}`      | Metadata styles              |
| `{{ devScripts }}`  | Development scripts          |
| `{{ devStyles }}`   | Development styles           |
| `{{ prodScripts }}` | Production hydration script  |

Replacement is case-insensitive and preserves `$` replacement tokens in input
content. Generated output remains subject to the document byte budget.

## How-to guides

### Generate a document from an HTML fragment

Use the internal entrypoint from framework source:

```ts
import { wrapInHTMLShell } from "#veryfront/html";
import type { HTMLGenerationOptions } from "#veryfront/html";
import type { RenderMetadata } from "#veryfront/types";

const content = "<main><h1>Hello</h1></main>";
const metadata: RenderMetadata = {
  title: "Hello",
  slug: "hello",
  frontmatter: { description: "A complete example" },
};
const options: HTMLGenerationOptions = {
  mode: "development",
  config: {},
  isLocalProject: true,
};

const html = await wrapInHTMLShell(content, metadata, options);
```

Pass route params as the fourth argument and JSON-serializable component props
as the fifth argument. Pass `projectDir` whenever `pagePath`, `appPath`, or a
layout path is absolute.

### Inject framework assets into a complete document

Use placeholders in the returned document. Do not concatenate unescaped page
metadata into the template.

```ts
import { injectHTMLContent } from "#veryfront/html";
import type { HTMLMetadata } from "#veryfront/html";

const template = `<!DOCTYPE html>
<html>
  <head><title>{{ title }}</title>{{ meta }}</head>
  <body>{{ content }}{{ prodScripts }}</body>
</html>`;
const metadata: HTMLMetadata = {
  title: "Status",
  description: "Current project status",
};

const html = injectHTMLContent(
  template,
  "<main>Ready</main>",
  metadata,
  { mode: "production", slug: "status" },
);
```

For client-page hydration, provide a project-relative `pagePath`, set
`isClientPage: true`, and pass validated route params. Absolute paths require
`projectDir`.

### Apply a CSP nonce

Pass the same request-scoped nonce through the HTML generation options. The
module applies it to framework-generated inline and external scripts and
styles.

```ts
const options: HTMLGenerationOptions = {
  mode: "development",
  config: {},
  isLocalProject: true,
  nonce: "<NONCE>",
};
```

Never log or persist the real nonce.

### Change a generation contract

1. Add a focused failing test beside the affected implementation.
2. Update the runtime validator and the schema together.
3. Update hydration templates when the browser consumes the field.
4. Update generated runtime bundles when a template changes.
5. Update this reference when an exported signature or documented contract
   changes.
6. Run the focused test, the complete HTML suite, type checks, lint, formatting,
   consumer tests, and generated-bundle checks.

### Verify the module

Run commands from the repository root:

```bash
VF_DISABLE_LRU_INTERVAL=1 SSR_TRANSFORM_PER_PROJECT_LIMIT=0 \
  REVALIDATION_PER_PROJECT_LIMIT=0 NODE_ENV=production LOG_FORMAT=text \
  deno test --no-check --allow-all src/html

rg --files src/html -g '*.ts' | xargs deno check
deno lint src/html
deno fmt --check src/html
git diff --check -- src/html
```

When a change affects runtime assembly, also run focused consumers under
`src/rendering/` and `src/server/`. When a hydration template changes, verify
the generated module parses and the browser-targeted bundle still builds.

## Related modules

- [`rendering/`](../rendering/README.md) owns SSR and RSC rendering.
- [`react/`](../react/README.md) owns framework React components and contexts.
- [`server/`](../server/README.md) owns HTTP request and asset delivery.
