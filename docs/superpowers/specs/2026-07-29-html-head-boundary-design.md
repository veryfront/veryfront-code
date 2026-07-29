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
exists. The existing exported helper retains its string-returning signature,
but standards placement and bounded admission intentionally change behavior.
The parser implementation must also respect Veryfront's dependency boundary:
core source has no direct third-party dependency. Vendor implementations belong
in first-party extension packages behind core-owned contracts.

## Considered approaches

### 1. Use an extension-owned standards parser (selected)

Define a narrow synchronous `HTMLHeadLocator` interface in core and implement it
in a new first-party `@veryfront/ext-parser-parse5/parser-only` package entry.
The server-only head module imports that first-party entry synchronously. The
extension parses with source-location tracking, inspects the actual document
`head` and `body` nodes, and returns only validated placement facts. Core
applies insertions directly to the original string. This follows browser tree
construction without exposing a parser AST or vendor types to core.

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

Approach 1 is selected because it preserves one standards-owned parsing
authority while following the repository's existing dependency-inversion and
extension-publication model. `parse5` remains an exact dependency of the
extension package only. The core dependency audit keeps its empty third-party
allowlist. The required parser-only entry follows the existing Babel
parser-only packaging pattern, preserves the synchronous API without mutable
registry state, and remains server-only so it cannot leak into browser bundles.

## Architecture

Add a dependency-free contract at
`src/extensions/parser/html-head-locator.ts`, exported through
`veryfront/extensions/parser`. The contract exposes placement, not a DOM:

```ts
export const HTMLHeadLocatorName = "HTMLHeadLocator" as const;
export const MAX_HTML_HEAD_PARSE_BYTES = 8_388_608 as const;
export type MaxHTMLHeadParseBytes = typeof MAX_HTML_HEAD_PARSE_BYTES;

export type HtmlHeadInsertionPoint =
  | { readonly status: "available"; readonly offset: number }
  | {
    readonly status: "unavailable";
    readonly reason: "unsafe-insertion-state";
  };

export type HtmlModuleResolutionOrdering =
  | { readonly status: "known"; readonly firstConsumerStartOffset?: number }
  | {
    readonly status: "unavailable";
    readonly reason: "unsafe-insertion-state";
  };

export type AuthoredImportMapState =
  | { readonly status: "absent" }
  | {
    readonly status: "valid";
    readonly count: number;
    readonly lastProcessingEndOffset: number;
  }
  | {
    readonly status: "invalid";
    readonly reason:
      | "unusable-element"
      | "invalid-json"
      | "invalid-shape"
      | "input-too-complex";
  };

export interface HtmlHeadPlacement {
  readonly contentStart: number;
  readonly importMapInsertion: HtmlHeadInsertionPoint;
  readonly endInsertion: HtmlHeadInsertionPoint;
  readonly importMapPreludeEndOffset: number;
  readonly moduleResolutionOrdering: HtmlModuleResolutionOrdering;
  readonly firstBodyOrFramesetSourceOffset?: number;
  readonly authoredImportMapState: AuthoredImportMapState;
  readonly hasLocatedStartTag: boolean;
  readonly hasLocatedEndTag: boolean;
}

export type HtmlHeadLocationResult =
  | { readonly ok: true; readonly placement: HtmlHeadPlacement }
  | {
    readonly ok: false;
    readonly reason: "input-too-large" | "input-too-complex";
  };

export interface HTMLHeadLocator {
  locate(html: string): HtmlHeadLocationResult;
}
```

Create `extensions/ext-parser-parse5` as the first-party implementation. It
owns the exact `npm:parse5@7.3.0` dependency and all parse, tree-construction,
namespace, template, script-state, source-location, and probe logic. It parses
with `{ sourceCodeLocationInfo: true, scriptingEnabled: true }` and never
returns parse5 nodes or types across the boundary. Its package root remains a
normal extension factory that can provide `HTMLHeadLocator` to explicit
extension consumers. Its `./parser-only` entry exports the concrete synchronous
locator used by core, analogous to `@veryfront/ext-parser-babel/parser-only`.
Both the extension factory and parser-only entry enforce the contract-owned
8 MiB UTF-8 admission limit before parsing, so direct extension consumers cannot
bypass the bound. Core repeats the same bounded check defensively before calling
across the package boundary.

The parser-only entry imports locator contracts and
`MaxHTMLHeadParseBytes` with `import type` only. It defines an extension-local
`8_388_608 satisfies MaxHTMLHeadParseBytes` constant so its emitted runtime has
no `veryfront` edge and cannot form a root-to-extension-to-root load cycle. A
conformance test imports both packages and asserts runtime equality. The normal
extension factory may use core contracts through its ordinary extension peer;
the parser-only runtime graph may not.

The extension uses a budgeted parse5 `Tokenizer` subclass, capped tree adapter,
and iterative traversal. The tokenizer is installed before input is written and
rejects before starting attribute attempt 257 on one start tag, starting total
attribute attempt 16,385, emitting token 131,073, or consuming code unit 65,537
within one start or end tag. Duplicate attribute attempts count even when the
tokenizer later discards them. The tree adapter rejects before allocating node
32,769. Parser stack instrumentation rejects immediately when a push makes the
live open-elements depth 1,025, before any further token or tree processing.
That depth metric is the live parse5 open-elements stack, not final DOM
parent-chain depth: it counts every HTML, foreign, and template element entry,
including implicit `html`, `head`, and `body` while each is on the stack;
`Document` and template `DocumentFragment` nodes are not stack entries. It is
enforced through the exact pinned Parser/OpenElementStack `onItemPush` and
`onItemPop` integration so nested templates, foster parenting, and adoption-
agency reparenting cannot bypass it. Node counts include document, fragment,
element, text, and comment nodes, including template contents. The
implementation subclasses parse5's exported `Parser` and protected tokenizer
hooks at the exact pinned version; it does not copy vendor source, patch module
globals, or wait until a completed attribute array reaches the tree adapter.
Contract tests must prove each hook is still active before a parse5 upgrade is
accepted.

An HTML tokenizer or tree-adapter budget exit during the initial parse returns
only the contract-owned `input-too-complex` location result. Only the
extension's private, identity-checked budget sentinel is converted; unexpected
exceptions still propagate. The exact limits are release compatibility and
security constants, not environment-tunable defaults. Probe accounting and
authored import-map JSON have the separately scoped behavior defined below so
they cannot reject an unrelated insertion lane.

Create a focused server-side module, `src/html/head-boundary.ts`, that owns
admission limits, defensive placement validation, insertion policy, and
original-string slicing. It synchronously imports and constructs the locator
from `@veryfront/ext-parser-parse5/parser-only`; it does not import `parse5`,
resolve mutable global registry state, or permit a runtime override. Keep
generic tag and attribute helpers in `tag-scanner.ts`; they must no longer claim
structural document-head authority. The core module exposes this internal API:

```ts
type HtmlHeadPlacementRejection =
  | "input-too-large"
  | "input-too-complex"
  | "unsafe-insertion-state";

type HtmlHeadPlacementRequirements =
  | {
    importMap: true;
    atEnd?: boolean;
  }
  | { importMap?: never; atEnd: true };

type LocateHtmlHeadResult =
  | { ok: true; placement: HtmlHeadPlacement }
  | { ok: false; reason: HtmlHeadPlacementRejection };

function locateHtmlHead(
  html: string,
  requirements: HtmlHeadPlacementRequirements,
): LocateHtmlHeadResult;

type NonEmptyHtmlHeadInsertions =
  | { importMap: string; atEnd?: string }
  | { importMap?: never; atEnd: string };

interface AdditionalHtmlHeadInsertions {
  atEnd?: string;
}

type HtmlHeadInsertionPlan = (
  placement: Readonly<HtmlHeadPlacement>,
) => NonEmptyHtmlHeadInsertions | Promise<NonEmptyHtmlHeadInsertions>;

type ApplyHtmlHeadInsertionsResult =
  | { ok: true; html: string; placement: HtmlHeadPlacement }
  | { ok: false; html: string; reason: HtmlHeadPlacementRejection };

function applyHtmlHeadInsertions(
  html: string,
  insertions: NonEmptyHtmlHeadInsertions,
): ApplyHtmlHeadInsertionsResult;

function applyHtmlHeadInsertionPlan(
  html: string,
  plan: HtmlHeadInsertionPlan,
): Promise<ApplyHtmlHeadInsertionsResult>;
```

These internal names and discriminated result contracts are part of this
design; implementation must not replace them with sentinel offsets or a
bare unchanged-string result. `applyHtmlHeadInsertions` rejects calls whose
supplied fields are all absent or empty with `TypeError`; callers skip it when
no insertion is requested. It derives placement requirements from the nonempty
insertion lanes and rejects only when a requested lane is unavailable.

`applyHtmlHeadInsertionPlan` admits and locates the source once, passes a deeply
frozen validated placement to the plan callback, awaits its result, validates
the returned nonempty insertions, derives their requirements, and applies them
without reparsing. This lets Pages decide whether an asynchronously built
fallback import map is needed only after structural inspection. The synchronous
apply function and asynchronous plan function share one internal capture and
commit implementation; neither delegates to the other. The plan path captures
both lane facts without rejecting an unavailable lane until the returned
insertions establish which lanes are required; it does not call the public
requirements-first `locateHtmlHead` wrapper. Every placement and
nested placement field is readonly in the type contract as well as frozen at
runtime. An exception or rejected promise from the plan callback propagates as
that build operation's own failure; it is not converted into a placement
rejection or an unchanged-HTML result.

The extension result is treated as untrusted data for shape and range
validation. Core captures each required own data property once, rejects
accessors and invalid shapes, and validates every offset as a finite integer in
the original UTF-16 string. It also validates ordering and the body or frameset
upper bound before slicing. Structural meaning remains the locator
implementation's contract. Core uses only the required first-party parser-only
implementation and does not accept a runtime replacement. Invalid placement
output is an internal contract failure, never caller input.

The two insertion lanes are independently available. An unsafe end-of-source
state can make `endInsertion` unavailable while a proven import-map boundary is
safe, and an unknown early module-resolution consumer can make
`importMapInsertion` unavailable while the end lane remains safe. Core validates
each available lane independently against the body or frameset upper bound. For
an available import-map lane it also validates
`importMapPreludeEndOffset <= importMapInsertion.offset` and, when a first
consumer exists,
`importMapInsertion.offset <= firstConsumerStartOffset`.

`@veryfront/ext-parser-parse5` is a required co-versioned dependency of the
published root server package. Source builds resolve its workspace entry, npm
builds preserve the package subpath through an explicit DNT mapping, and
compiled-binary builds include the parser-only source. The head locator is a
document-correctness invariant rather than an application customization point,
so configured extension priority does not replace the core locator.

The parsed head is not assumed to occupy one contiguous source interval. HTML
tree construction can assign a head-only token that appears after an explicit
`</head>` back to the actual head. When the end lane is available, its offset is
the maximum of the explicit end-tag start offset, when present, and the end
offsets of all source-located direct head children. This preserves authored
DOM-head order even for after-head `meta`, `link`, `style`, or `script` tokens.

When the parsed head has an explicit start tag, `contentStart` is the end of
that tag whether or not an end tag exists. Without an explicit start tag and
with source-located direct head children, `contentStart` is their minimum start
offset. For an empty implicit head, the anchor is, in priority order, the end
of an explicit `<html>` start tag, the end of the document doctype, or offset
zero. An explicit-start/implicit-end head uses the explicit `contentStart` and
the maximum direct-child end offset, falling back to `contentStart` only when
the head is empty.

For an empty implicit head with a safe end lane, `endInsertion.offset` equals
its anchor. This supports closing-only `</body>`/`</html>` input and frameset
documents without placing generated nodes after those tokens.

The minimum source start of the parsed body or frameset (including descendants)
is returned as `firstBodyOrFramesetSourceOffset` and used only as an upper-bound
validation. Neither its end nor EOF is used as a default head insertion point.
All offsets must be in range. When `firstBodyOrFramesetSourceOffset` exists,
every available insertion offset must be no later than that offset.

Every candidate insertion offset is accepted only when parser locations and the
final tokenizer context prove that another head token can be inserted there.
This rule applies to child-derived offsets as well as end-of-source candidates.
Unterminated comments, raw-text, RCDATA, and template contents must not expose
an offset inside their source as safe. If source locations alone do not prove a
candidate, the implementation reparses a copy containing collision-free,
uniquely marked HTML-namespace element probes at that offset. The import-map
lane uses a complete inline `script[type="importmap"]` probe with `{}` content.
The end lane uses one combined sequence covering every allowed generated token
class: `meta`, `link`, `style`, and `script`. Each marker must have the actual
head as its direct parent and a source start equal to the adjusted probe offset.
Comments are not valid probes because their after-head tree-construction
behavior differs from metadata elements. Probe markers are selected locally and
proven absent from the input. They are never included in returned HTML. Failure
marks only the affected lane unavailable.

Probe parses enforce the authored-input caps plus a fixed, test-asserted budget
for the exact synthetic sequence and any bounded text-node split it can cause.
Counters distinguish the collision-free synthetic source range, so the probe's
UTF-8 bytes, attributes, tag code units, tokens, nodes, and `{}` import-map body
do not consume the already-admitted authored limits or participate in authored
import-map classification. An authored document exactly at a cap can therefore
still be probed. Exhausting the declared probe-only overhead makes only that
candidate lane unavailable as `unsafe-insertion-state`; it is not relabeled as
initial input complexity. Unexpected exceptions and an impossible counter
identity still propagate as implementation failures.

The extension validates every parse5 source location before using it. A missing,
non-integer, reversed, or out-of-source location produced while recovering
malformed authored HTML makes the affected lane unavailable; it is never
returned to core as an impossible offset. In particular, an unclosed template
whose reported end lies inside its contents and an abrupt comment whose reported
end exceeds source length must reject the affected lane rather than become a
core contract failure.

Before an element end contributes to the end lane, its source location must
contain its complete start tag and every source-located descendant or template
content extent. A recovered zero-length element range whose start precedes its
complete start-tag end is invalid for this purpose even when a probe inserted at
that offset would become a head child. Unterminated `script`, `style`, `title`,
`noframes`, and scripting-enabled `noscript` elements therefore make the
affected end lane unavailable instead of moving end assets before authored head
content.

The locator receives an already decoded JavaScript string, so it cannot know or
reconstruct the source response's original bytes or transport encoding. It must
not claim to preserve the HTML byte-prescan window from that incomplete input.
Instead, UTF-8 is an explicit output-boundary invariant: every
Veryfront-produced rendered-page HTML response declares
`Content-Type: text/html; charset=utf-8`, generated HTML artifacts are written
as UTF-8, the Veryfront static server sends the same explicit charset, and
deployment documentation requires external static hosts to do so. Existing
authored encoding declarations remain byte-for-byte intact. Rendered-response,
static-file, and documentation tests gate this invariant for malformed lexical
prescan cases whose original byte semantics cannot be reconstructed from a
string.

`importMapPreludeEndOffset` is the maximum of `contentStart`, every trustworthy
direct-head modern `meta[charset]` or legacy metadata encoding declaration's
complete start-tag end, the first source-order direct-head `base[href]`
candidate start-tag end, and every direct-head metadata CSP candidate start-tag
end. This preserves the current after-charset ordering for conforming authored
metadata, resolves relative map entries against the authored base, and subjects
the map to authored metadata CSP. If this required prelude ends after a consumer
that could start module resolution, the import-map lane is unavailable.

`moduleResolutionOrdering.firstConsumerStartOffset` is the minimum trustworthy
source start of any document-tree node that can begin module resolution before a
later parser-inserted import map is processed. It includes HTML-namespace module
scripts, executable classic scripts that can run before a later map, and
actionable `link[rel~="modulepreload"]` elements. Type, `src`, `async`, `defer`,
`nomodule`, `language`, MIME, namespace, and relation-token handling follows the
HTML processing algorithms. Template contents and foreign-namespace elements
are excluded. If a matching consumer lacks a trustworthy source start, ordering
is `unavailable` instead of falsely reporting no prior consumer.

When ordering is known, the import-map candidate is the earliest consumer start
when one exists within the head placement range. Otherwise it is the safe end
boundary when available, or `importMapPreludeEndOffset` when the end lane is
independently unavailable. Every candidate must be no earlier than
`importMapPreludeEndOffset` and must pass the direct-head probe rule. Equality
with the first consumer is safe because slicing at its source start emits the
import map first. If no offset satisfies these constraints, only the import-map
lane is unavailable. These checks are irrelevant when no import map is
requested.

Script-type recognition strips leading and trailing ASCII whitespace and then
uses the HTML Standard's ASCII-case-insensitive matching.
`authoredImportMapState` classifies every HTML-namespace
`script[type="importmap"]` marker in the actual document tree, including the
body. Import-map-looking text, template contents, and foreign-namespace scripts
are not markers. With no marker, the state is `absent`. With one or more markers,
every marker must be an inline, nonempty script with a trustworthy explicit end
tag and a JSON body whose import-map parse result is usable. If all markers meet
that contract, the state is `valid`, `count` is their positive total, and
`lastProcessingEndOffset` is the maximum complete end-tag end offset at which
all of those parser-inserted maps can have been prepared. Multiple valid maps
are supported. This field is a conservative source-order timing fact, not a
claim that CSP allowed registration or that every individual address entry
normalized.

Any external, empty, or unterminated marker makes the document state `invalid`
with reason `unusable-element`. Invalid JSON produces `invalid-json`. A JSON
value that is not an object, or whose final `imports`, `scopes`, or `integrity`
value is present but is not an object, produces `invalid-shape`. Unknown
top-level keys and invalid individual address or integrity entries follow the
HTML processing algorithm: they can be warned about or ignored and do not make
the whole parse result invalid. If any marker is invalid, the aggregate state is
invalid even when another marker is valid. This fail-closed state records clear
author intent without silently replacing a malformed authored map.

Before parsing authored import-map JSON, the extension runs one linear bounded
JSON lexical pass that understands strings and escapes without regular
expressions, recursion, or backtracking. It rejects through the same
private budget sentinel before map 17, per-map UTF-8 text byte 524,289,
aggregate import-map text byte 1,048,577, nesting depth 65, or aggregate
object-member/array-item count 16,385. Member occurrences count before duplicate
JSON keys collapse. That sentinel becomes authored state `invalid` with reason
`input-too-complex`; it does not make an unrelated end-only insertion lane
unavailable. Only admitted text reaches `JSON.parse`; the post-parse shape check
does not retain normalized import-map copies. These limits bound
attacker-controlled CPU and memory independently of the HTML tree budgets.

End-position assets are inserted at `endInsertion.offset`. Insertions at
different offsets are applied from greatest to smallest so earlier offsets
remain stable. When both lanes share an offset, ordering is: generated import
map, generated end assets, then trusted additional end content. Theme
persistence always uses the end lane to preserve current full-document ordering.
The import-map lane accepts exactly one complete inline
`script[type="importmap"]` element with optional surrounding whitespace. The end
lane accepts only framework-generated sequences of complete `meta`, `link`,
`style`, and `script` elements with optional inter-tag whitespace. The internal
API does not accept arbitrary text, comments, templates, or other token classes
whose after-head behavior was not proven by the lane probe. Each planned
fragment is validated against its lane grammar before slicing. Pages static
generation removes its current import-map and basic-style HTML comments rather
than smuggling comment wrappers through either lane.

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

The existing `injectHTMLContent` signature remains source-compatible. It
delegates to the structured API and returns its `html` when the placement
outcome is `rejected`. Its behavior intentionally changes in two documented
ways: standards-valid omitted-head documents receive the requested assets, and
documents above the 8 MiB UTF-8 admission limit retain their non-head
transformations but do not receive head assets. A call with no requested head
insertion does not invoke the locator or parse. These behavioral changes must be
changelogged and included in migration guidance before release.

The structured helper completes placeholder replacement, metadata replacement,
and requested body transformations before head placement. It applies the
bounded UTF-8 admission check and the locator to that exact post-transformation,
pre-head-insertion string, then slices that same string at the returned offsets.
A small template plus large rendered content therefore cannot bypass the 8 MiB
limit. Rejection retains this exact non-head-transformed string.

`src/html` is currently documented as internal and is not a published
`veryfront/html` package subpath. The required parser-only package entry keeps
the helper synchronous and independent of bootstrap or teardown ordering. A
missing or broken parser package is an installation or module-load failure, not
a late unchanged-HTML result.

The no-head-insertion-on-placement-rejection behavior remains an explicit
compatibility boundary, not the production authority. "No head insertion"
means the helper continues placeholder replacements and requested body
transformations, then returns that post-transformation string without adding
framework head assets. It does not mean returning the original template.
Missing or broken parser packaging does not degrade to that result, and no
textual scanner or regular-expression fallback is used.

Both authored full-document production callers,
`src/rendering/orchestrator/html.ts` and
`src/rendering/script-page-handling.ts`, call the structured API. This includes
the script-page path, which bypasses the ordinary rendering pipeline. A
`rejected` outcome becomes `INPUT_VALIDATION_FAILED` with a stable
reason-derived detail that does not include authored source; it cannot report a
stylesheet artifact or return apparently successful HTML with omitted
framework assets. A `not-requested` outcome performs no parse. Framework import
maps, stylesheets, and theme persistence are collected before this single
insertion operation: a generated import map uses `importMap`, while stylesheets
and theme persistence use `atEnd`. The optional fifth argument exists so the
rendering orchestrator can contribute its theme script without performing a
separate parse; fields are concatenated with the function's generated content
before the nonempty check. All additional strings are trusted, complete,
head-compatible framework markup; the API does not accept caller-authored
fragments and does not attempt to parse or repair incomplete tags. Collected
React head handling for framework-owned shells remains outside this authored
document migration.

The script-page handler must inspect and convert the local structured placement
outcome outside its broad user-code render-error catch. It must not pass through
an error merely because its class or slug is `INPUT_VALIDATION_FAILED`, since a
user module can throw that public error itself. User-thrown and unknown
execution failures keep the existing sanitized `RENDER_ERROR` behavior.

Pages static generation is a separate post-render composite insertion operation
and must await `applyHtmlHeadInsertionPlan` once. Its asynchronous plan builds
fallback import-map markup only when `authoredImportMapState.status` is
`absent`, places that markup in the import-map lane, and combines preload links
plus basic client styles in the end lane. It always proves the end lane is
available and, for `absent`, proves the import-map lane is available before
calling the fallback builder. An unavailable required lane therefore fails
without performing avoidable asynchronous import-map work.

When authored state is `valid`, Pages may suppress the fallback only when
`lastProcessingEndOffset` is no later than the first existing module-resolution
consumer, when one exists, and no later than `endInsertion.offset`. Requiring
every authored map to finish by the proven head end makes all of them precede
generated end-lane modulepreloads and the generated module runtime later
inserted before the body close, including builds with no preload links. It also
prevents an early empty map from masking a later authoritative map after a
consumer. Unknown consumer ordering, any late valid map, or authored state
`invalid` fails static generation with a stable source-free validation detail.
Pages never injects a fallback over a malformed or too-late authored marker.
When suppression is safe, the plan does not call the asynchronous fallback
builder and returns only the end lane. Remove the whole-string import-map
detector and literal `</head>` insertion helper from this path. A standards-valid
omitted head is accepted; an unavailable requested lane fails static generation
explicitly. Client-runtime insertion before the body close remains a separate
structural-body placement concern, but its module-consumer ordering is covered
by the conservative head-end requirement.

App Router static generation constructs a framework-owned shell from known
parts and is outside this authored-document parser path. It must not parse a
shell whose head boundaries the framework already owns structurally.

The existing streaming nonce and Studio selector rewriters are separate
consumers with incremental-tokenization requirements. This change removes the
head scanner's false authority but does not declare those streaming consumers
fixed; their script-state behavior remains a required follow-up in the HTML
hardening batch.

## Dependency and performance controls

- Declare exact `npm:parse5@7.3.0` only in
  `extensions/ext-parser-parse5/deno.json`; do not add a root import-map alias or
  a direct import from `src/` or `cli/`.
- Keep `audit-core-deps` unchanged with no exception. Add reverse regression
  tests proving the parser specifier is rejected from every core path.
- Extend the first-party import policy with exactly one production edge from
  `src/html/head-boundary.ts` to
  `@veryfront/ext-parser-parse5/parser-only`. Its reverse tests reject the
  package root, other subpaths, and the parser-only subpath from every other
  `src/` or `cli/` file.
- Add `parse5` to the extension-owned dependency classification. Generated
  root npm metadata must contain `@veryfront/ext-parser-parse5` at the root
  package version and must not declare `parse5` directly; generated extension
  metadata must contain the exact `parse5` version.
- Add the extension to the workspace, extension catalog, compiled-binary
  includes, extension documentation, root npm co-version dependencies, and npm
  pack/install smoke tests. Add an explicit DNT mapping for the `parser-only`
  package subpath so emitted core code never points into workspace extension
  source.
- Add an enforced `verify:extensions` task or an explicit
  `ext-parser-parse5` CI job. With a frozen lock it runs `deno check` on both
  package entries and every test, `deno fmt --check`, `deno lint`, the locator
  conformance suite, and focused extension tests without `--no-check`. Both
  prerelease and release publication jobs must depend on it; verification must
  not rely on root tasks that exclude the `extensions/` tree or on the current
  DNT `typeCheck: false` setting.
- Add a prepublication package-boundary job that runs the DNT mapping,
  compiled-binary inclusion, SBOM ownership, and browser-absence regressions.
  Its npm smoke uses two isolated strict-layout applications. The first declares
  only the packed root tarball and resolves the root's exact co-version extension
  dependency from a local package source into a nested, non-hoisted location;
  it imports the emitted root head path and asserts the resolved extension path.
  The second declares only the packed extension tarball, resolves its exact
  `parse5` dependency, imports `parser-only`, and asserts its resolved paths. If
  the generated extension manifest requires a `veryfront` peer for its normal
  factory, an isolated local registry supplies the packed root as a transitive
  peer without adding it to the application's declared dependencies; the
  parser-only resolved runtime graph must still prove that peer is not loaded.
  Installing root and extension tarballs together as sibling application
  dependencies is not sufficient. Prerelease and release publication jobs must
  depend on this job.
- Inspect packed artifacts, not only metadata or source mappings. The root head
  artifact must retain exactly the external
  `@veryfront/ext-parser-parse5/parser-only` import and the root tarball must
  contain no extension subtree, runtime `parse5` specifier, or vendored
  parse5/entities implementation. The extension tarball alone must declare the
  exact parser version and load it successfully.
- Assert the built parser-only JavaScript has no runtime `veryfront` import. Its
  generated declaration may reference the contract types, and conformance must
  prove the mirrored byte-limit literal equals the contract value.
- Add a compiled-binary runtime test outside the workspace. It launches the
  fresh binary, renders an omitted-head authored document through the production
  path, and verifies parser-backed head placement. Include-list string tests do
  not satisfy this gate.
- Run dependency-boundary, SBOM, package-publication, and browser-entrypoint
  audits. The core boundary is measured by direct external edges from `src/` and
  `cli/`, stopping at first-party extension package boundaries: it must contain
  no third-party specifier or direct `parse5` edge. A separate transitive graph
  proves that `@veryfront/ext-parser-parse5` is the only workspace package that
  declares `parse5` directly, pins it exactly to 7.3.0, and reaches that version
  from `parser-only`. Unrelated extensions may continue to reach parse5
  transitively through their own dependency graphs, such as the MDX/rehype
  boundary; their SBOM ownership remains attributed there. The parser extension
  SBOM and the root package's transitive install graph are expected to contain
  `parse5`; browser bundles must not contain it.
- Define browser absence over the resolved source and built-artifact graphs for
  every `BROWSER_SAFE_EXPORTS` entry plus `index.client` and `react/public`.
  Bundler metafiles or equivalent resolved graphs reject `head-boundary`,
  `ext-parser-parse5`, `parse5`, and its `entities` dependency; maintained path
  lists and substring-only checks are insufficient.
- Parse each document once per composite insertion operation. One isolated
  probe-only parse is permitted per distinct otherwise ambiguous candidate
  boundary. Because the contract has two insertion lanes, a malformed document
  can require at most two additional parses; safe normal documents parse once.
  Probe parses run sequentially after required facts are copied and prior tree
  references are released; the implementation must not retain multiple full
  parse trees concurrently.
- Reject input above `MAX_HTML_HEAD_PARSE_BYTES` using a bounded UTF-8 length
  counter that stops as soon as the limit is exceeded; do not allocate a second
  full encoded copy solely to measure it.
- Add a reproducible extension-owned benchmark with 4 KiB, 256 KiB, 2 MiB, and
  8 MiB explicit, implicit, and template/foreign-content documents. After 10
  warmups, record 30 samples through 2 MiB; for 8 MiB, use 5 warmups and 10
  samples. The extension benchmark may import its owned dependency directly.
  Compare median `applyHtmlHeadInsertions` time with median direct
  `parse5.parse` time using the same parser options and input. The wrapper must
  remain within
  `1.35 * parseMedian + 0.25 ms` through 2 MiB and
  `1.5 * parseMedian + 2 ms` at 8 MiB. These ratio fixtures must use safe
  one-parse documents. Separate adversarial counters must prove no input uses
  more than the initial parse plus one probe per distinct lane candidate.
- Benchmark tag-dense and deeply nested inputs immediately below each complexity
  cap and assert deterministic `input-too-complex` rejection immediately above
  it. Exact at-limit and first-over-limit regressions cover per-tag attribute
  attempts, including duplicates, total attribute attempts, emitted tokens,
  start/end-tag code units, allocated nodes, and open-elements stack depth. Run
  a single-start-tag unique-attribute case in a subprocess at the admitted limit
  and record elapsed CPU plus peak resident memory; run the tag-dense and
  deep-tree cases there as well. A future parse5 update must not pass if any
  tokenizer hook or capped-adapter bound becomes inactive. Repeat
  ambiguous-candidate probes at every exact authored limit to prove their
  synthetic overhead is excluded and bounded independently.
- Benchmark import-map JSON immediately below and reject immediately above the
  per-map bytes, aggregate bytes, map-count, nesting, and aggregate member/item
  caps. Include flat many-key, deeply nested, duplicate-key, and many-map cases
  in a subprocess with elapsed CPU and peak resident memory.
- Do not serialize the parsed tree. All output is produced by slicing and
  concatenating the original string at validated offsets.

## Error and security behavior

Normal malformed HTML is handled by the extension's parse5 recovery. Unexpected
parser exceptions, a missing synthetic document head, and impossible placement
data returned across the first-party interface are implementation or resource
failures and propagate to the sanitized 5xx rendering boundary; they must not be
relabeled as caller input errors. Vendor source locations invalidated during
normal malformed-input recovery are contained inside the extension and make
only the affected lane unavailable. Only `input-too-large`, `input-too-complex`,
and a document state proven unsafe for the requested insertion are
`HtmlHeadPlacementRejection` values and become `INPUT_VALIDATION_FAILED` in
production rendering. Generated insertion content continues to use the existing
escaping and CSP-nonce builders.

No compatibility fallback to textual regular expressions is retained. The
production path either establishes a safe placement or fails closed. The
string helper's no-head-insertion-on-placement-rejection behavior is retained.
Missing or broken parser packaging fails during module loading rather than
producing a silent no-head-insertion case.

## Verification

Implementation begins with failing regressions for:

- explicit and omitted head start/end tags;
- route documents with an entirely implicit empty head;
- comments including abrupt empty-comment endings;
- script escaped and double-escaped states;
- quoted and malformed unquoted attributes;
- head-name lookalikes;
- templates before and inside the head;
- an unclosed `<template><title>x` whose reported child end is inside template
  content;
- an abrupt `<head><!--` comment whose vendor end offset exceeds source length;
- SVG/foreign-content scripts inside templates;
- raw-text and RCDATA elements;
- missing body tags and implicit body nodes;
- head and body import maps, multiple maps, and import-map/module type casing;
- whitespace-surrounded and mixed-case script types that must follow browser
  normalization;
- inline, external, empty, unterminated, invalid-JSON, non-object, and invalid
  `imports`/`scopes`/`integrity` import-map elements;
- invalid individual address entries and unknown top-level import-map keys that
  do not invalidate the whole map, plus duplicate-key last-value behavior;
- live and static-server HTML responses with an explicit UTF-8 transport
  charset, UTF-8 static artifact bytes, and byte-for-byte preservation and
  after-charset ordering of modern and legacy authored encoding declarations;
- base, metadata CSP, parser-blocking classic-script, module-script, and
  modulepreload ordering around the import-map lane;
- valid head and body authored maps before and after those consumers, including
  a late body map that cannot suppress the fallback before generated preloads or
  the generated module runtime;
- multiple authored maps interleaved with a consumer, including an early empty
  valid map that cannot hide a later mapping map;
- unclosed `script`, `style`, `title`, `noframes`, and scripting-enabled
  `noscript` elements whose recovered ranges do not contain their source;
- `<head><style>x` with an unavailable end lane but a separately probed safe
  import-map lane at the prelude boundary;
- after-head metadata where element probes succeed but comment probes would not;
- exact tokenizer, node, open-elements-stack, and import-map JSON admission
  boundaries plus tag-dense malformed input and a single-tag attribute bomb;
- nested-template, foster-parenting, and adoption-agency cases at and above the
  exact open-elements stack limit;
- malformed input for which no stable source placement exists; and
- artifact reporting only when the linked stylesheet parses into the actual
  head.

Each case reparses the resulting document with `scriptingEnabled: true` and
asserts that the generated nodes belong to the actual head, in addition to
checking exact UTF-16 source preservation around the insertion. Include
explicit-start/implicit-end, head-owned nodes after `</head>`, closing-only
body/html tokens, framesets, oversize and over-complex admission, unexpected
parser failure, and zero-insertion/no-parse regressions. Include cases where only
the import-map lane is safe and where only the end lane is safe; requesting one
lane must not be rejected because the other is unavailable.

Split verification by boundary:

- Extension tests exercise parse5 tree construction, source locations, probe
  reparsing, namespace/template/script behavior, and the benchmark.
- Publish a reusable `HTMLHeadLocator` conformance suite from a testing-only
  entry point. It asserts exact expected offsets and independent lane
  availability for every adversarial fixture in this design. The default
  parser-only implementation must pass it; extension consumers that use the
  optional runtime contract can apply the same suite to another provider.
- Core tests exercise a pure placement-capture and validation seam, verify
  insertion policy and exact source preservation, and reject hostile shapes,
  accessors, mutable offsets, out-of-range offsets, and impossible ordering.
- Module-graph tests verify synchronous parser-only construction without
  bootstrap state and prove that zero-insertion calls do not invoke parsing.
  Direct extension-factory and parser-only calls independently prove the shared
  8 MiB admission boundary cannot be bypassed outside core.
- Rendering tests independently exercise both live authored full-document
  callers: `src/rendering/orchestrator/html.ts` and
  `src/rendering/script-page-handling.ts`. Each must convert rejected requested
  placement into `INPUT_VALIDATION_FAILED`; the script-page regression must
  prove that its pipeline bypass cannot skip this handling. A separate script
  page that deliberately throws the public `INPUT_VALIDATION_FAILED` error must
  still be sanitized and wrapped as `RENDER_ERROR`.
- Static-generation tests verify omitted-head documents, head-close and
  import-map lookalikes in comments/scripts/templates, one structural import
  map, multiple valid maps, every invalid authored-map state, late-only maps,
  interleaved maps and consumers, a no-prefetch build with an after-body map,
  composite preload/style/runtime ordering, lane-grammar rejection, absence of
  legacy comment wrappers, and explicit rejection when a requested head lane is
  unavailable. They also prove the fallback builder is not called for a safely
  ordered valid map or after a known rejection, and is called exactly once for
  `absent`. The former missing-head failure expectation changes to success;
  missing structural body handling remains independently tested.
- Packaging tests verify workspace discovery, exact extension dependency,
  parser-only DNT mapping, co-version root dependency, compiled-binary
  inclusion, strict-layout install smoke, SBOM ownership, absence from the core
  direct dependency graph, and absence from browser bundles. CI graph tests
  verify that extension and prepublication package-boundary jobs gate both
  publication paths.

Focused HTML/rendering tests, formatting, lint, typecheck, the specified
benchmark, dependency audits, browser-entrypoint checks, and the repository
publication gate are required before checkpointing.

## Documentation impact

Update the HTML module documentation to state that authored full documents use
standards-compatible head placement, omitted head tags are supported, original
JavaScript string code units are preserved outside framework insertions,
production rendering fails explicitly on unsafe placement, and the string
helper retains its historical post-transformation/no-head-insertion rejection
shape. Add the
`HTMLHeadLocator` contract and `@veryfront/ext-parser-parse5` to extension
catalogs and the support matrix. Add a changelog and migration note for the
newly supported omitted-head placement, the 8 MiB head-insertion admission
limit, and the required parser-only package boundary. Implementation does not
begin until these behavioral and extension-boundary changes are approved with
this design.
