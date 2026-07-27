# HTML internal reference

The HTML module assembles server-rendered document shells, metadata, import
maps, styles, hydration data, and client runtime scripts. It also adapts
authored full-document HTML templates.

This is an internal framework module. First-party code imports
`#veryfront/html`; there is no published `veryfront/html` package subpath.
Rendering ownership and request flow are described in
[Rendering runtime](../../docs/architecture/03-rendering-runtime.md).

## Module import

```ts
import {
  generateHTMLShellParts,
  injectHTMLContent,
  processMetadata,
  wrapInHTMLShell,
} from "#veryfront/html";
```

Import through `src/html/index.ts` or the configured alias. Files below that
barrel are implementation details unless another module has an explicit
first-party dependency on them.

## Export surface

### Document assembly

| Export                   | Contract                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------ |
| `wrapInHTMLShell`        | Wrap rendered content in a complete document and return `Promise<string>`.                       |
| `generateHTMLShellParts` | Return `{ start, end }` shell fragments for callers that stream or insert content independently. |
| `injectHTMLContent`      | Fill supported placeholders in an authored full-document template.                               |
| `isFullHTMLDocument`     | Detect whether a string represents a complete HTML document rather than a fragment.              |

### Metadata and tags

| Export                | Contract                                                                   |
| --------------------- | -------------------------------------------------------------------------- |
| `processMetadata`     | Merge render metadata and frontmatter into escaped tag strings.            |
| `extractHTMLMetadata` | Build bounded independent metadata from page and layout frontmatter.       |
| `generateMetaTags`    | Generate charset, viewport, description, theme-color, and custom metadata. |
| `generateLinkTags`    | Generate link and icon tags.                                               |
| `generateScriptTags`  | Generate external or inline script tags, optionally with a nonce.          |
| `generateStyleTags`   | Generate stylesheet links or inline style tags, optionally with a nonce.   |

### Hydration and development output

| Export                  | Contract                                                                         |
| ----------------------- | -------------------------------------------------------------------------------- |
| `generateHydrationData` | Serialize the bounded route, layout, props, release, and build-identity payload. |
| `getDevScripts`         | Generate development renderer, manifest, error logger, and optional HMR scripts. |
| `getProdScripts`        | Generate the versioned production hydration-runtime script tag.                  |
| `getDevStyles`          | Generate development overlay styles, optionally with a nonce.                    |

### Escaping and shell helpers

| Export                | Contract                                                               |
| --------------------- | ---------------------------------------------------------------------- |
| `escapeHTML`          | Escape `&`, `<`, `>`, double quotes, and single quotes.                |
| `escapeHtml`          | Compatibility alias for `escapeHTML`.                                  |
| `buildAttributes`     | Validate, bound, escape, and join a plain attribute record.            |
| `buildImportMapJson`  | Resolve the configured client import map and return inline-safe JSON.  |
| `buildRootAttributes` | Build the root element's framework data attributes.                    |
| `shouldDisableLayout` | Return true for frontmatter with `layout: false` or `layout: "false"`. |

The barrel also exports `HTMLGenerationOptions`, `HTMLMetadata`,
`HTMLRenderMetadata`, `HydrationData`, `ImportMapConfig`,
`InjectHTMLContentOptions`, `MDXFrontmatter`, and `ProcessedMetadata`.

## Document shells

`wrapInHTMLShell` has this call shape:

```ts
wrapInHTMLShell(
  content,
  metadata,
  options,
  params?,
  props?,
  projectCSSPromise?,
): Promise<string>
```

`generateHTMLShellParts` accepts the same metadata and options, followed by
optional params, props, Tailwind candidate content, and a prefetched project-CSS
promise:

```ts
generateHTMLShellParts(
  metadata,
  options,
  params?,
  props?,
  contentForTailwind?,
  projectCSSPromise?,
): Promise<{ start: string; end: string }>
```

A minimal assembly call uses the current framework configuration:

```ts
import {
  type HTMLGenerationOptions,
  type HTMLRenderMetadata,
  wrapInHTMLShell,
} from "#veryfront/html";

export async function renderDocument(
  config: HTMLGenerationOptions["config"],
): Promise<string> {
  const metadata: HTMLRenderMetadata = {
    slug: "home",
    title: "Home",
  };

  return await wrapInHTMLShell(
    "<main>Hello</main>",
    metadata,
    {
      config,
      mode: "production",
      environment: "production",
      isLocalProject: false,
    },
  );
}
```

The shell owns:

- `<html>`, `<head>`, root, portal, and hydration-data elements;
- metadata, import maps, module preloads, styles, and CSP nonce propagation;
- route-scoped release assets and release-versioned fallback module URLs;
- development, preview, Studio, Markdown, and production runtime selection;
- production CSS asset selection or project-CSS generation; and
- stable build identity used by browser navigation to reject stale deployment
  payloads.

The top-level metadata and options inputs must be ordinary data objects.
Accessors, enumerable symbol keys, non-plain prototypes, failed reflective
inspection, and objects beyond the field limit are rejected before assembly.

## HTML generation options

`HTMLGenerationOptions` is inferred from
`src/html/schemas/html.schema.ts`. `mode` and `config` are required. The schema
also admits:

- route identity: `pagePath`, `pageType`, `appPath`, `errorPath`,
  `appRouterRoot`, and `nestedLayouts`;
- rendering state: `frontmatter`, `layoutProps`, `headings`,
  `isolatedClientPage`, and `projectClasses`;
- project and release identity: `projectDir`, `projectId`, `projectSlug`,
  `releaseId`, `pageId`, and `sourceHash`;
- client setup: `importMap`, `globalCSS`, `nonce`, `environment`,
  `isLocalProject`, `noHmr`, and `forceProductionScripts`; and
- display and Studio state: `colorScheme`, its source flags, and
  `studioEmbed`.

Use the schema as the authoritative field and enum contract. Do not add
renderer-only properties through casts; extend the schema and its tests first.

## Metadata

`processMetadata(metadata, nonce?)` returns a `ProcessedMetadata` object with the
effective title, language, body class, normalized metadata, and generated tag
strings.

Metadata precedence is:

1. page frontmatter over layout frontmatter;
2. nested frontmatter `metadata` over the merged outer frontmatter;
3. frontmatter title over the top-level render title;
4. the normalized metadata title; then
5. `"Veryfront App"`.

Top-level description, language, and body class fill values absent from
frontmatter. Metadata extraction copies own data properties, ignores unsafe
prototype keys, and enforces entry, attribute, text, inline-content, and
aggregate byte limits. Accessors and malformed structured arrays fail closed.

Tag generation accepts only plain metadata records. Attribute values are
escaped, event-handler attributes are removed, inline `</script>` and
`</style>` sequences are neutralized, and a supplied nonce is added to script
and style output. The helpers do not sanitize arbitrary rendered HTML content.

## Hydration

`generateHydrationData` serializes:

- route params and component props;
- project-relative page, layout, app, and error module paths;
- the selected filesystem or RSC client-module strategy;
- route-scoped release asset mappings and release identity;
- framework/server/project build identity;
- frontmatter, layout props, headings, and Studio state; and
- the development renderer flag.

The serializer uses inline-script-safe JSON. The hydration schema bounds route
text, layouts, module mappings, headings, build metadata, and release
identifiers, and rejects non-canonical paths.

Production shells load a content-addressed hydration runtime whose URL and
strong ETag use the full SHA-256 digest. Development shells generate the
component manifest and client renderer and include HMR only when configuration
and mode permit it.

## Authored full-document templates

`injectHTMLContent` has this signature:

```ts
injectHTMLContent(
  template: string,
  content: string,
  metadata: HTMLMetadata,
  options: InjectHTMLContentOptions,
): string
```

Supported template placeholders are:

- `{{ content }}`
- `{{ title }}`
- `{{ description }}`
- `{{ meta }}`
- `{{ links }}`
- `{{ scripts }}`
- `{{ styles }}`

The adapter can also insert an import map, project or preview stylesheet,
client-page hydration payload, development or production scripts, and Studio
bridge data at the appropriate document boundaries. `mode` and `slug` are
required options. Client-page hydration additionally requires `pagePath` and
`isClientPage`.

`content` is treated as already-rendered HTML and is inserted verbatim. Titles,
descriptions, generated attributes, inline JSON, and Studio configuration are
escaped for their actual HTML contexts.

## Import maps

`buildImportMapJson` selects CDN, bundled, or self-hosted client resolution from
the framework configuration. It keeps core React-context modules on compatible
local runtime paths, resolves project dependency versions, applies configured
custom imports, and can map ready release dependencies to immutable assets.

Import-map results use a bounded LRU cache keyed by project, resolution mode,
provider, versions, custom imports, and release dependencies. The structured
`{ imports, json }` builder remains private; the barrel intentionally exposes
only the JSON helper.

## Security boundary

This module provides context-specific escaping and bounded structural
validation. It does not make arbitrary HTML safe. Callers remain responsible
for ensuring that rendered `content` and authored full-document templates come
from trusted rendering or sanitization paths.

When adding output:

- use `escapeHTML` for text and attribute values;
- use the shared inline JSON sanitizer for script data;
- use nonce-aware generators for inline scripts and styles;
- preserve release/build identity in hydration payloads; and
- add adversarial tests for malformed records, accessors, closing-tag
  sequences, oversized inputs, and stale release data.
