# Standards-aware HTML head-boundary design

## Context

Veryfront injects framework-owned import maps, stylesheets, metadata, and theme
scripts into authored full HTML documents. The current synchronous scanner tries
to infer the structural `<head>` using a small set of lexical states. Focused
review found that it disagrees with browser parsing for omitted head tags,
script escaped states, template contents, foreign SVG content, malformed
unquoted attributes, and tag-name lookalikes. Those disagreements can silently
omit assets or report a stylesheet artifact that the browser did not place in
the document head.

The required contract is stronger than finding a textual `</head>`: insertion
must target the head element produced by standards-compatible HTML tree
construction and preserve the caller's exact JavaScript string outside the
insertion. Production rendering must fail explicitly when no reliable placement
exists. The existing public helper retains its string-returning signature, but
standards placement and bounded admission intentionally change behavior and
require approval under this design.

## Considered approaches

### 1. Parse with `parse5` and use source locations (selected)

Parse the document with source-location tracking, inspect the actual document
`head` and `body` nodes, and apply insertions directly to the original string at
validated source offsets. This follows browser tree construction for templates,
namespaces, omitted tags, script states, and malformed-but-deterministic input.
It adds a direct pinned production dependency and a full-document parse, but it
does not serialize or normalize authored HTML.

### 2. Complete the internal tokenizer and tree-construction subset

Expand the existing scanner with all relevant tokenizer states, insertion
modes, template stacks, and foreign-content rules. This avoids a dependency but
duplicates a substantial and security-sensitive portion of the HTML standard.
The current review already demonstrated that case-by-case patches miss coupled
states, so this approach has the highest maintenance and correctness risk.

### 3. Require an explicit, narrowly valid `<head>...</head>`

Validate authored full documents against a constrained grammar and reject
omitted or malformed head markup. This is simpler, but it removes valid HTML
that Veryfront previously accepted and would be a user-facing compatibility
break. It also shifts standards complexity into a validator without improving
the authoring experience.

Approach 1 is selected because it gives one standards-owned parsing authority
without rewriting source text. The dependency cost must be measured, and the
module must remain server-only so it cannot leak into browser bundles.

The repository currently rejects every third-party import from core source.
Adopting this design therefore includes one deliberate policy exception, not a
hidden gate bypass: `audit-core-deps` will allow the exact specifier
`npm:parse5@7.3.0` only from `src/html/head-boundary.ts`. Its tests must reject
the same import from every other core path, all other versions/specifiers, and
any npm alias added to root `deno.json`. No general third-party allowlist is
introduced.

## Architecture

Create a focused server-side module, `src/html/head-boundary.ts`, that owns
document parsing and head insertion. Keep generic tag/attribute helpers in
`tag-scanner.ts`; they must no longer claim structural document-head authority.

The new module directly imports `npm:parse5@7.3.0`, parses with
`{ sourceCodeLocationInfo: true, scriptingEnabled: true }`, and exposes this
internal API:

```ts
const MAX_HTML_HEAD_PARSE_BYTES = 8 * 1024 * 1024;

interface HtmlHeadPlacement {
  contentStart: number;
  endInsertionOffset: number;
  charsetEndOffset?: number;
  firstModuleScriptStartOffset?: number;
  hasLocatedStartTag: boolean;
  hasLocatedEndTag: boolean;
}

type HtmlHeadPlacementRejection =
  | "input-too-large"
  | "unsafe-insertion-state";

type LocateHtmlHeadResult =
  | { ok: true; placement: HtmlHeadPlacement }
  | { ok: false; reason: HtmlHeadPlacementRejection };

function locateHtmlHead(html: string): LocateHtmlHeadResult;

type NonEmptyHtmlHeadInsertions =
  | { afterCharset: string; atEnd?: string }
  | { afterCharset?: string; atEnd: string };

interface AdditionalHtmlHeadInsertions {
  afterCharset?: string;
  atEnd?: string;
}

type ApplyHtmlHeadInsertionsResult =
  | { ok: true; html: string; placement: HtmlHeadPlacement }
  | { ok: false; html: string; reason: HtmlHeadPlacementRejection };

function applyHtmlHeadInsertions(
  html: string,
  insertions: NonEmptyHtmlHeadInsertions,
): ApplyHtmlHeadInsertionsResult;
```

These internal names and discriminated result contracts are part of this
design; implementation must not replace them with sentinel offsets or a
bare unchanged-string result. `applyHtmlHeadInsertions` rejects calls whose
supplied fields are all absent or empty with `TypeError`; callers skip it when
no insertion is requested.

The parsed head is not assumed to occupy one contiguous source interval. HTML
tree construction can assign a head-only token that appears after an explicit
`</head>` back to the actual head. The end insertion offset is therefore the
maximum of the explicit end-tag start offset, when present, and the end offsets
of all source-located direct head children. This preserves authored DOM-head
order even for after-head `meta`, `link`, `style`, or `script` tokens.

When the parsed head has an explicit start tag, `contentStart` is the end of
that tag whether or not an end tag exists. Without an explicit start tag and
with source-located direct head children, `contentStart` is their minimum start
offset. For an empty implicit head, the anchor is, in priority order, the end
of an explicit `<html>` start tag, the end of the document doctype, or offset
zero. An explicit-start/implicit-end head uses the explicit `contentStart` and
the maximum direct-child end offset, falling back to `contentStart` only when
the head is empty.

For an empty implicit head, the end insertion offset equals its anchor. This
supports closing-only `</body>`/`</html>` input and frameset documents without
placing generated nodes after those tokens.

The minimum source start of the parsed body or frameset (including descendants)
is an upper-bound validation only. Neither its end nor EOF is used as a default
head insertion point. All offsets must be in range and satisfy
`contentStart <= charsetEndOffset <= endInsertionOffset` when a charset exists;
`endInsertionOffset` must be no later than the earliest body/frameset source
token.

An end-of-source candidate is accepted only when the final tokenizer context is
proven able to accept another head token. Unterminated comments, raw-text,
RCDATA, and template contents must not treat EOF as safe. If source locations
alone do not prove the state, the implementation reparses a copy containing an
inert uniquely marked probe at the candidate offset and accepts the offset only
when that probe becomes a direct child of the actual head. The probe is never
included in returned HTML.

The charset offset comes only from a real direct `meta[charset]` child of the
parsed head, never from text, templates, comments, or body content. It may
legitimately appear after the authored `</head>`. Blocking framework scripts
are inserted after that meta start tag; without one, they are inserted at
`contentStart`. End-position assets are inserted at `endInsertionOffset`.
Insertions at different offsets are applied from greatest to smallest so
earlier offsets remain stable. At one offset, ordering is: generated import
map, trusted additional after-charset content such as classic blocking scripts,
generated end assets, then trusted additional end content. Theme persistence
always uses the at-end lane to preserve current full-document ordering.

`firstModuleScriptStartOffset` is the minimum source start of every executable
HTML-namespace authored `script[type="module"]` that tree construction assigns
to the actual head; template contents and foreign-namespace scripts are
excluded. When an import map is requested, its after-charset source offset must
precede this value. If an authored module script precedes a late charset so both
requirements cannot be satisfied, the structured production path returns
`unsafe-insertion-state`; it does not emit an import map that the browser will
ignore. This ordering check is not applied when no import map is requested.

## Consumer behavior

Add this exact structured result around the existing injection inputs:

```ts
type HtmlHeadInsertionOutcome =
  | { status: "not-requested" }
  | { status: "inserted"; placement: HtmlHeadPlacement }
  | { status: "rejected"; reason: HtmlHeadPlacementRejection };

interface InjectHTMLContentWithHeadPlacementResult {
  html: string;
  headInsertion: HtmlHeadInsertionOutcome;
}

function injectHTMLContentWithHeadPlacement(
  template: string,
  content: string,
  metadata: HTMLMetadata,
  options: InjectHTMLContentOptions,
  additionalHeadInsertions?: AdditionalHtmlHeadInsertions,
): InjectHTMLContentWithHeadPlacementResult;
```

The existing public `injectHTMLContent` signature remains source-compatible: it
delegates to the structured API and returns its `html` even when the outcome is
`rejected`. Its behavior intentionally changes in two documented ways:
standards-valid omitted-head documents now receive the requested assets, and
documents above the 8 MiB UTF-8 admission limit retain their non-head
transformations but do not receive head assets. These behavioral changes must
be approved, changelogged, and included in migration guidance before release.
The unchanged-on-rejection behavior remains an explicit compatibility boundary,
not the production authority. No textual-regex fallback is used.

Full-document production rendering calls the structured API. A `rejected`
outcome becomes `INPUT_VALIDATION_FAILED` with a stable reason-derived detail
that does not include authored source; it cannot report a stylesheet artifact
or return apparently successful HTML with omitted framework assets. A
`not-requested` outcome performs no parse. Framework import maps, stylesheets,
and theme persistence are collected before this single insertion operation:
the import map uses `afterCharset`, while stylesheets and theme persistence use
`atEnd`. The optional fifth argument exists so the rendering orchestrator can
contribute its theme script without performing a separate parse; fields are
concatenated with the function's generated content before the nonempty check.
All additional strings are trusted, complete, head-compatible framework markup;
the API does not accept caller-authored fragments and does not attempt to parse
or repair incomplete tags.
Collected React head scripts and non-script elements likewise use one parse and
two placement offsets rather than reparsing after each mutation.

The existing streaming nonce and Studio selector rewriters are separate
consumers with incremental-tokenization requirements. This change removes the
head scanner's false authority but does not declare those streaming consumers
fixed; their script-state behavior remains a required follow-up in the HTML
hardening batch.

## Dependency and performance controls

- Pin the direct dependency; do not use an unversioned npm import.
- Import the parser only from the server-side head-boundary module.
- Amend `audit-core-deps` with the path-and-specifier-specific exception and
  regression tests described above; all other core third-party imports remain
  forbidden.
- Run dependency-boundary and browser-entrypoint audits to prove `parse5` is
  absent from client bundles.
- Parse each document once per composite insertion operation. A second
  probe-only parse is permitted only for an otherwise ambiguous end-of-source
  boundary.
- Reject input above `MAX_HTML_HEAD_PARSE_BYTES` using a bounded UTF-8 length
  counter that stops as soon as the limit is exceeded; do not allocate a second
  full encoded copy solely to measure it.
- Add a reproducible benchmark with 4 KiB, 256 KiB, 2 MiB, and 8 MiB explicit,
  implicit, and template/foreign-content documents. After 10 warmups, record 30
  samples through 2 MiB; for 8 MiB, use 5 warmups and 10 samples. Compare median
  `applyHtmlHeadInsertions` time with median direct `parse5.parse` time using the
  same parser options and input. The wrapper must remain within
  `1.35 * parseMedian + 0.25 ms` through 2 MiB and
  `1.5 * parseMedian + 2 ms` at 8 MiB. Normal cases must parse once; only the
  documented ambiguous EOF probe may parse twice.
- Do not serialize the parsed tree. All output is produced by slicing and
  concatenating the original string at validated offsets.

## Error and security behavior

Normal malformed HTML is handled by `parse5` recovery. Unexpected parser
exceptions, a missing synthetic document head, and impossible/out-of-range
source locations are parser-contract or internal/resource failures and
propagate to the sanitized 5xx rendering boundary; they must not be relabeled
as caller input errors. Only `input-too-large` and a document state proven
unsafe for the requested insertion are `HtmlHeadPlacementRejection` values and
become `INPUT_VALIDATION_FAILED` in production rendering. Generated insertion
content continues to use the existing escaping and CSP-nonce builders. Source
locations are validated as finite integer offsets within the original UTF-16
string and must be monotonically ordered.

No compatibility fallback to textual regular expressions is retained. The
production path either establishes a safe placement or fails closed. The
public string helper's unchanged-on-rejection behavior is retained and recorded
only because changing it requires separate behavioral-breaking approval.

## Verification

Implementation begins with failing regressions for:

- explicit and omitted head start/end tags;
- route documents with an entirely implicit empty head;
- comments including abrupt empty-comment endings;
- script escaped and double-escaped states;
- quoted and malformed unquoted attributes;
- head-name lookalikes;
- templates before and inside the head;
- SVG/foreign-content scripts inside templates;
- raw-text and RCDATA elements;
- missing body tags and implicit body nodes;
- malformed input for which no stable source placement exists; and
- artifact reporting only when the linked stylesheet parses into the actual
  head.

Each case reparses the resulting document with `scriptingEnabled: true` and
asserts that the generated nodes belong to the actual head, in addition to
checking exact UTF-16 source preservation around the insertion. Include
explicit-start/implicit-end, head-owned nodes after `</head>`, closing-only
body/html tokens, framesets, oversize admission, unexpected parser failure, and
zero-insertion/no-parse regressions. Focused HTML/rendering tests, formatting,
lint, typecheck, the specified benchmark, dependency audits,
browser-entrypoint checks, and the repository publication gate are required
before checkpointing.

## Documentation impact

Update the HTML module documentation to state that authored full documents use
standards-compatible head placement, omitted head tags are supported, original
JavaScript string code units are preserved outside framework insertions,
production rendering fails explicitly on unsafe placement, and the public
string helper retains its historical unchanged-on-rejection shape. Add a
changelog and migration note for the newly supported omitted-head placement and
the 8 MiB head-insertion admission limit; implementation does not begin until
those behavioral changes are approved with this design.
