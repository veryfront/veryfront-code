# HTML nonce transform contract design

**Status:** Draft for written review

**Scope:** The dependency-free nonce rewriter used by buffered HTML, streamed
HTML, SSR, and bounded static-response transformation.

**Related designs:**

- `2026-07-29-html-head-boundary-design.md`
- `2026-08-01-server-static-runtime-hardening-design.md`

**Normative lexical reference:** [HTML Standard tokenizer](https://html.spec.whatwg.org/multipage/parsing.html#tokenization)

## Context

The current buffered and streaming nonce rewriters implement different lexical
algorithms. Both can mistake script text for markup, their malformed-markup
behavior differs, and adversarial incomplete input can cause repeated prefix
scans. Static HTML also decodes, rewrites, and re-encodes without bounding the
final representation.

The broader server hardening design already requires one linear scanner, a
two-pass byte transform, an exact final-body limit, and classified temporary
failures. This document makes the remaining contracts explicit before Task 5
changes production code.

## Goals

- Use one incremental lexical state machine for buffered and streamed nonce
  rewriting.
- Preserve source text code-unit-for-code-unit except for intended `nonce`
  attribute insertion or replacement, and preserve admitted source bytes
  exactly when the bounded API performs no transformation.
- Never treat comments, declarations, HTML text-element content, foreign
  CDATA, or script-data content as markup.
- Bound scanner work, retained ambiguous input, nonce input, and final output.
- Give Task 6 an identity-safe predicate for known transform failures without
  hiding programmer faults.
- Keep `src/` free of third-party parser dependencies.

## Non-goals

- This is not a general HTML parser, tree builder, sanitizer, or structural
  document editor.
- It does not determine head or body boundaries.
- It does not normalize malformed HTML or reproduce every tree-construction
  side effect. It implements only the tokenizer subset needed to distinguish
  eligible opening tags from text.
- It does not change static cache or ETag policy. Task 6 owns that integration.
- It does not repair the Studio selector rewriter. That remains a separate
  acceptance gate.

## One scanner and one lexical contract

`src/html/nonce-lexical-scanner.ts` owns the only nonce-rewriter scanner. The
buffered string helper, streaming helper, and bounded byte transform all drive
fresh instances of this scanner. No caller reparses a completed tag with regex
or whole-tag search helpers after the scanner has consumed it.

The scanner emits unchanged source spans and replacement spans through a
callback. It retains lexical state plus only the undecided suffix required by
the next input chunk. It never retains an array of edits or a complete comment,
script body, or style body.

The tokenizer subset includes:

- data, tag-open, end-tag-open, tag-name, and quote-aware start-tag and
  malformed end-tag attribute states;
- comment start, comment start dash, comment, comment less-than sign, comment
  less-than sign bang/dash/dash-dash, comment end dash, comment end, and
  comment end bang behavior, including `<!-->`, `<!--->`, and `--!>`;
- markup-declaration, DOCTYPE, bogus-comment, processing-instruction-like, and
  CDATA recognition so declaration text cannot expose nonce candidates;
- RCDATA, RCDATA less-than sign, RCDATA end tag open, and RCDATA end tag name
  for `title` and `textarea`;
- RAWTEXT, RAWTEXT less-than sign, RAWTEXT end tag open, and RAWTEXT end tag
  name for `style`, `xmp`, `iframe`, `noembed`, `noframes`, and
  scripting-enabled `noscript`;
- PLAINTEXT for `plaintext`, which consumes the remainder of the source; and
- script data, script data less-than sign, script data end tag open, script
  data end tag name, script data escape start, script data escape start dash,
  script data escaped, script data escaped dash, script data escaped dash
  dash, script data escaped less-than sign, script data escaped end tag open,
  script data escaped end tag name, script data double escape start, script
  data double escaped, script data double escaped dash, script data double
  escaped dash dash, script data double escaped less-than sign, and script
  data double escape end.

An opening tag begins only when an ASCII alpha character immediately follows
`<`, matching HTML tag-open behavior. For example, `< script>` remains text. A
syntactic self-closing flag on a non-void text element, such as `<script/>`,
does not suppress entry into its text state because HTML tree construction
does not acknowledge that flag for the element.

The server targets normal browser scripting mode. The scanner therefore treats
`noscript` as RAWTEXT. It conservatively enters the named RCDATA, RAWTEXT,
script-data, or PLAINTEXT state whenever it emits a lexical start tag with that
name, even if malformed surrounding markup could make a browser ignore or
relocate the token. This can withhold a nonce from later ambiguous markup, but
it cannot turn text into an executable element.

An exact `<![CDATA[` opener is preserved through `]]>` as opaque text in
foreign SVG or MathML content. The scanner applies the same conservative rule
in HTML namespace input rather than implementing namespace tree construction;
this may withhold later insertions in malformed markup but never inserts into
CDATA-looking text. Genuine SVG or MathML `script` and `style` start tags
remain eligible, then enter the same conservative script-data or RAWTEXT
state. Foreign-content and integration-point fixtures pin these choices.

An appropriate end tag requires a matching ASCII-case-insensitive tag name and
an admitted boundary character. End-of-chunk is never treated as an HTML
boundary. At final flush, incomplete markup is emitted unchanged.

The existing attribute behavior remains stable:

- only `script` and `style` opening tags are eligible;
- `data-nonce` and nonce-like attribute values are not `nonce` attributes;
- an existing `nonce` attribute is replaced with one quoted escaped value; and
- otherwise one quoted escaped `nonce` attribute is inserted at the established
  attribute insertion point.

## Progress and retention bounds

`maximumNonceScannerTransitions(n)` accepts only a non-negative safe integer
for which `2 * n + 1` is also safe, and returns exactly that result. Each
scanner pass owns a fresh counter.

Every scanner-loop iteration is charged before work. The production-used
primitive
`chargeNonceScannerStep(used, cumulativeInputCodeUnits)` increments the counter
or raises a classified transform failure when the exact ceiling is exceeded.
Each successful iteration must consume one previously unconsumed UTF-16 code
unit or complete one state or emission transition. A direct `n = 0` test
exercises the no-progress ceiling without a test-only mutation hook.

The scanner retains at most
`MAX_NONCE_SCANNER_PENDING_CODE_UNITS = 1_048_576` UTF-16 code units for one
undecided opening-tag lexeme. The exact limit is admitted and one additional
code unit fails. Comments, script bodies, and style bodies are emitted
incrementally and retain only lexical state and the longest possible delimiter
prefix, so their total length is not constrained by the pending-lexeme cap.

Stream accounting rejects cumulative input-length overflow before addition.
No retained prefix is rescanned when another chunk arrives.

## Nonce input contract

The dependency-free leaf module
`src/security/http/csp-nonce-policy.ts` owns both the resource bound and the
CSP `base64-value` syntax decision:

```ts
export const MAX_CSP_NONCE_CODE_UNITS = 4_096;
```

Studio aliases its existing nonce limit to this authority so the numeric
decision is not duplicated. A stricter surface-specific cap, such as the
built-in CSP middleware's existing 256-code-unit cap, remains valid and is not
weakened by this framework-wide resource ceiling. That middleware calls the
shared syntax validator with its stricter cap instead of retaining a duplicate
regular expression.

The nonce-rewriter APIs use these semantics:

- `undefined` means no requested nonce transformation;
- `""` explicitly disables nonce transformation;
- a non-empty nonce must be a string, contain no NUL code unit, and contain at
  most 4,096 UTF-16 code units; and
- invalid custom nonce input is a synchronous, unclassified programmer or
  configuration error.

Validation happens before HTML escaping or stream acquisition. The string and
stream helpers preserve their existing identity/no-consumption behavior when
the nonce is absent or explicitly disabled. The bounded byte API still fatally
validates and copies the UTF-8 source when no nonce is present because it is a
static-response admission boundary.

The low-level HTML helpers keep accepting non-ASCII nonce strings within this
resource contract so escaping and byte accounting remain general and
deterministic. A CSP-producing public entry point has the stricter security
contract: a non-empty custom nonce must match CSP `base64-value` syntax,
`^[A-Za-z0-9+/_-]+={0,2}$`. `ResponseBuilder` and the response-security
module's `buildCSP`, `serializeCSPDirectives`, and `applySecurityHeaders`
validate before either header interpolation or HTML use. Empty string remains
the explicit nonce-disabled value and causes the default CSP to omit a nonce
source rather than emit an invalid `'nonce-'` source.

For configured CSP text, disabled nonce handling is exact. An environment CSP,
user CSP header, or configured directive without `{NONCE}` is preserved
unchanged. If the selected value contains `{NONCE}` while the nonce is
disabled, response construction rejects it as a configuration error rather
than preserving the marker or substituting an empty value. A non-empty valid
nonce replaces every marker. Focused tests cover all three configuration
sources and the default policy.

This is an intentional breaking correction for invalid public custom nonce
values. Generated nonces already satisfy the syntax. Task 5 updates public
source comments and focused security tests. The final documentation Task 13
regenerates API references and records release guidance after source contracts
freeze. Direct HTML-rewriter tests still use a non-ASCII nonce to prove exact
UTF-8 accounting, but a CSP response builder rejects that value.

The scanner receives one already escaped nonce. Escaping preserves the current
five-replacement HTML attribute contract. The scanner uses an internal
single-pass escaper or module-load-captured string intrinsics rather than live
`String.prototype.replace`. Byte accounting uses the actual UTF-8 length of
replacement spans and never assumes an ASCII-only nonce.

## Classified failure identity

The HTML module owns a private transform-failure factory backed by a module
private `WeakSet<object>`. It exports only:

```ts
export function isHtmlNonceTransformFailure(value: unknown): boolean;
```

Names, messages, `instanceof`, copied properties, proxies, and lookalike
objects do not satisfy the predicate.

Known failures from otherwise valid arguments are classified:

- fatal UTF-8 decoding;
- scanner transition exhaustion;
- pending-lexeme overflow;
- cumulative input-length overflow; and
- admitted final-representation byte overflow.

Argument validation remains unclassified, including an invalid byte limit,
invalid nonce, or non-genuine source byte view. Exceptions from caller-provided
emission callbacks, an impossible count difference, invalid native encoder
progress, a second-pass write mismatch, and other unexpected programmer or
runtime invariant faults also remain unclassified.

Task 6 converts only predicate-positive failures into
`StaticAssetUnavailableError("nonce-transform", ...)`. Every other exception
continues to the normal sanitized 500 boundary.

## Bounded byte transformation

The internal static-response API remains:

```ts
export function transformHtmlNonceWithinLimit(
  source: Uint8Array,
  nonce: string | undefined,
  maximumBytes: number,
): Uint8Array;
```

The hostile-intrinsic contract is exact rather than open-ended. The module
captures or avoids every live surface in this table before tests mutate it:

| Surface              | Required stable authority                                                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Encoding             | `TextDecoder`, `TextDecoder.prototype.decode`, `TextEncoder`, `TextEncoder.prototype.encode`, and `TextEncoder.prototype.encodeInto`                                            |
| Bytes and buffers    | `Uint8Array`, `ArrayBuffer`, typed-array tag/buffer/offset/length accessors, `ArrayBuffer` byte-length/resizable accessors, and `SharedArrayBuffer` identification when present |
| Calls and validation | `Reflect.apply`, required descriptor/prototype inspection, and safe-integer validation                                                                                          |
| Strings and escaping | every `String.prototype` operation used by scanning, slicing, case folding, searching, or escaping                                                                              |
| Failure identity     | `Error`, `WeakSet`, `WeakSet.prototype.add`, and `WeakSet.prototype.has`                                                                                                        |
| Streaming            | `ReadableStream`, `ReadableStream.prototype.getReader`, and the reader read/cancel/release methods used by the helper                                                           |

The tests poison that exact list, ambient byte constructors, species, and
source-view properties after module initialization. The design does not claim
resistance to arbitrary mutation of unrelated language intrinsics.

Before the classified transform region, the API validates:

- a genuine fixed `Uint8Array` source rather than a proxy, spoofed view,
  detached view, `SharedArrayBuffer` view, or resizable-buffer view;
- a non-negative safe-integer `maximumBytes`; and
- the nonce input contract above.

Cross-realm genuine fixed views, subclasses with genuine Uint8Array internal
slots, and fixed-buffer subviews are admitted without reading their overridable
properties. The transform copies only the admitted view range. All invalid
argument shapes fail synchronously and remain unclassified.

It fatally decodes UTF-8 exactly once with BOM preservation enabled. When no
nonce is requested, it returns one tight copy of the exact admitted source
bytes after UTF-8 validation and size admission; it does not re-encode them.
With a nonce, pass one drives a fresh scanner and encodes emitted spans into
bounded scratch storage only. It accumulates the exact output size with
subtraction-safe checks and rejects before allocating the result when the
maximum would be exceeded. The decoder uses `ignoreBOM: true`, so an initial
UTF-8 BOM remains U+FEFF during transformation and re-encodes to the same three
bytes.

Pass two drives another fresh scanner into one exact-size fixed
`ArrayBuffer`. It uses captured `encodeInto` semantics, rejects zero progress
for non-empty input, and verifies that counted spans, consumed source,
encoded bytes, and final offsets agree exactly. The returned `Uint8Array` has
byte offset zero and retains no growth capacity or source buffer.

## Streaming lifecycle

With an active nonce, the stream helper uses a fatal, BOM-preserving
incremental decoder and the same scanner. It emits available transformed
output without reading ahead after backpressure becomes visible and preserves
UTF-8 sequences split at any byte boundary. An absent or explicitly disabled
nonce returns the original stream object without acquiring a reader or
validating its bytes; only the bounded byte API is an unconditional UTF-8
admission boundary.

Downstream cancellation forwards the exact reason upstream once, releases the
reader lock, and resolves its own cancellation promptly without awaiting an
upstream cancellation promise that can stall forever. Scanner or decoder
failure reports the primary error downstream immediately, starts one
best-effort upstream cancellation, and releases the reader lock under the same
nonblocking rule. Rejection or non-settlement of cleanup is observed without
an unhandled rejection and never replaces or delays the primary transform
failure.

## Test and acceptance matrix

For valid UTF-8 and an active nonce, the scanner, string helper, stream helper,
bounded byte API, and SSR consumer must agree on transformed source content.
Byte-only failure expectations are stated separately: the string helper cannot
observe malformed UTF-8, the inactive stream path intentionally passes bytes
through untouched, the active stream path fails fatally, and the bounded byte
API fails fatally with or without a nonce.

Task 5 is not complete until the relevant APIs satisfy:

- ordinary comparison text, quoted `>`, a nonce-looking tag inside a quoted
  malformed end-tag attribute, incomplete tags, existing nonce forms,
  mixed-case tags, `< script>`, `<script/>`, and `<script / >`;
- every exact script-data state listed above;
- RCDATA, every RAWTEXT element, PLAINTEXT, mixed-case appropriate end tags,
  and lookalike end tags;
- normal, abrupt, bogus, declaration, processing-instruction-like,
  foreign-CDATA, and EOF-in-comment endings;
- every UTF-16 split for scanner fixtures and every UTF-8 byte split for stream
  fixtures, including 2-byte, 3-byte, and 4-byte sequences beside delimiters;
- the exact transition and pending-input boundaries;
- prompt incremental emission, cancellation, reader-lock release, and
  backpressure;
- malformed UTF-8 under the per-API behavior above;
- a leading UTF-8 BOM with and without a nonce;
- exact final byte limit and one byte over;
- a non-ASCII nonce and a longer replaced nonce that shrinks the output;
- admitted cross-realm, subclassed, and fixed-buffer subviews, plus rejected
  spoofed, proxied, detached, shared, and resizable views;
- poisoned globals and prototypes after module initialization;
- classified cumulative-length overflow; and
- correct distinction between classified input/resource failures and
  unclassified programmer or invariant faults.

The adversarial script, UTF-8 split, cancellation, and prompt-output fixtures
also run through `buildSSRResponse`, the production streaming consumer. Task 6
adds the bounded static-handler integration and cache-policy assertions.

## Dependency and rollout constraints

- Add no third-party dependency, parser package, vendor type, or fallback
  implementation to core.
- Keep the scanner internal rather than claiming a general public HTML-parser
  contract.
- Add failing characterization tests before replacing either existing
  algorithm.
- Land the scanner and bounded transform before Task 6 consumes the byte API.
- This contract explicitly supersedes Task 5's earlier instruction to preserve
  the nonfatal decoder and transform-failure cleanup behavior. Successful
  output and downstream cancellation semantics remain compatible; malformed
  UTF-8 and transform-failure cleanup become fail-closed as specified here.
- Preserve the four pre-existing dirty static-handler/service recovery files
  until their incompatible read-admission work is deliberately reconciled.

The written implementation plan must expand Task 5 beyond its original four
HTML files. It must include the security-owned nonce policy and tests,
ResponseBuilder and exported CSP-builder validation, the Studio limit alias and
generated bridge artifact when changed, SSR production-consumer tests, and
public source comments. Task 13 retains generated API-reference and release
documentation ownership. No implementation may begin until the reviewed
written plan contains those changes and exact staging paths.

This design document is ignored by the repository's broad
`docs/superpowers/` rule. The design checkpoint itself must force-add this file
together with the tracked parent design so the parent never links to an absent
contract. Task 5's later source commit does not need to restage an unchanged
design checkpoint.
