# Standards-aware HTML Head Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace core's textual document-head scanner with a bounded, standards-compatible locator implemented by a first-party parser extension, migrate every authored-full-document consumer to fail closed, and prove the dependency and publication boundaries end to end.

**Architecture:** Core owns only immutable locator/result contracts plus defensive placement validation and original-string slicing. `@veryfront/ext-parser-parse5` alone owns exact `parse5@7.3.0`, tree construction, source-location interpretation, complexity budgets, probe parsing, and import-map classification; `src/html/head-boundary.ts` is the sole core module allowed to synchronously import its `parser-only` entry. Rendering and Pages consumers use one composite insertion operation and convert unsafe caller input into stable source-free validation failures, while packaging checks prove the parser remains server-only and extension-owned.

**Tech Stack:** Deno 2, TypeScript, `npm:parse5@7.3.0`, DNT/npm packaging, Deno compile, GitHub Actions, repository dependency/SBOM/browser-boundary audits.

## Global Constraints

- Treat dependency-free core as a hard acceptance rule: production `src/`/`cli/` code may use first-party modules and runtime built-ins, while third-party implementation code, package declarations, and vendor types belong to a first-party extension. For this change the only approved crossing is the exact first-party parser-only edge below; parse5 and its transitives remain owned, declared, and executed by that extension.
- This parser change adds no direct third-party runtime edge to `src/` or `cli/`; parse5 exists only below a first-party extension manifest. A separate repository-wide dependency-remediation design owns the pre-existing CSS, Redis, WebSocket, S3, YAML, `@std`, React-workspace, opaque-loader, and generated-artifact violations. The currently false-green `lint:core-deps` task is never cited as parser evidence in this plan.
- `parse5` is declared exactly as `npm:parse5@7.3.0` only in `extensions/ext-parser-parse5/deno.json`; the root `deno.json` contains no `parse5` alias or `npm:parse5` literal.
- The only production core edge to the parser extension is `src/html/head-boundary.ts` importing `@veryfront/ext-parser-parse5/parser-only`; every other core path, the package root, and every other package subpath are rejected by regression tests.
- The parser-only emitted JavaScript has no runtime `veryfront` import. Contract imports there are type-only, and its local literal `8_388_608 satisfies MaxHTMLHeadParseBytes` is checked against the core runtime constant in conformance tests.
- The normal extension factory may import Veryfront contracts through its extension peer and provides `HTMLHeadLocator`; configured extension priority never replaces the core locator.
- Parsing is synchronous, server-only, and independent of registry/bootstrap state. Missing or broken parser packaging is a module-load failure; there is no regex, textual-scanner, registry, or unchanged-output fallback.
- Core slices the exact JavaScript string supplied by the caller. All UTF-16 code units outside inserted fragments remain byte-for-byte identical at the string level; parsed trees are never serialized.
- Initial authored input is admitted at at most `8_388_608` UTF-8 bytes with a bounded counter that stops on first overflow and does not allocate a second full encoded copy.
- Exact authored HTML caps are: 256 attribute attempts per start tag, 16,384 total attribute attempts, 131,072 emitted tokens, 65,536 consumed code units per start/end tag, 32,768 allocated nodes, and 1,024 live open elements. The first over-limit operation rejects before further parse work.
- Exact authored import-map caps are: 16 maps, 524,288 UTF-8 text bytes per map, 1,048,576 aggregate UTF-8 text bytes, nesting depth 64, and 16,384 aggregate object-member/array-item occurrences.
- Probe-only synthetic overhead is separately identified, fixed, bounded, and excluded from authored counters. One initial parse plus at most one sequential probe per distinct lane candidate is permitted; multiple full parse trees are not retained concurrently.
- Probe marker discovery performs one bounded linear source scan with a fixed 1,024-entry occupancy bitmap. It never retries whole-source searches; if all marker slots are occupied, the affected lane rejects as `unsafe-insertion-state`.
- Placement results and nested fields are readonly and deeply frozen before plan callbacks. Core captures required own data properties exactly once, rejects accessors and invalid shapes, and validates every offset and ordering invariant before slicing.
- `injectHTMLContent` keeps its existing source signature and post-transformation string return. The structured companion reports `not-requested`, `inserted`, or `rejected`; production rendering never treats a requested rejection as success.
- The import-map lane and end lane are independent. A caller requesting one lane is not rejected because the other is unavailable.
- Output-boundary UTF-8 is explicit: rendered HTML responses and Veryfront static HTML responses use `Content-Type: text/html; charset=utf-8`, generated HTML artifacts are written as UTF-8, and external-host documentation states the same requirement.
- Every production behavior change follows strict red-green-refactor: add a focused failing regression, run it and record the expected failure, implement the smallest behavior, then rerun focused and static-consumer gates.
- Preserve all unrelated dirty CSS/artifact work already present in the reconciliation worktree. Stage exact files only; do not commit unresolved CSS hash migration work with this parser plan. The current three-line lockfile delta was independently reproduced by resolving parse5 alone and contains no Tailwind alias contribution; Task 2 rechecks that provenance from a clean checkout and commits the lock atomically with the extension manifest.
- Tasks 1–8 do not require a CSS checkpoint. Before Task 9 touches the mixed `html-injection` files, either finish and independently verify the CSS/compiler-identity batch in its own commit or implement the parser work in an isolated clean worktree and integrate only a reviewed parser patch after resolving the mixed hunks. Task 9 and Task 10 may not stage whole mixed files from the current dirty tree as parser-only evidence.

---

### Task 1: Add the dependency-free locator contract and parser-edge policy

**Files:**

- Create: `src/extensions/parser/html-head-locator.ts`
- Create: `src/extensions/parser/html-head-locator.test.ts`
- Modify: `src/extensions/parser/index.ts`
- Create: `scripts/lint/audit-parser-extension-boundary.ts`
- Create: `scripts/lint/audit-parser-extension-boundary.test.ts`
- Modify: `deno.json`

**Interfaces:**

- Produces: `HTMLHeadLocatorName`, `MAX_HTML_HEAD_PARSE_BYTES`, `MaxHTMLHeadParseBytes`, `HtmlHeadInsertionPoint`, `HtmlModuleResolutionOrdering`, `AuthoredImportMapState`, `HtmlHeadPlacement`, `HtmlHeadLocationResult`, and `HTMLHeadLocator` exactly as specified in `docs/superpowers/specs/2026-07-29-html-head-boundary-design.md`.
- Produces: asynchronous, syntax-aware `findUnauthorizedParserExtensionImports(files)` returning `{ path, line, specifier }[]`; it allows exactly `src/html/head-boundary.ts` to import `@veryfront/ext-parser-parse5/parser-only` and rejects all other package-root/subpath imports.
- Produces: executable task `lint:parser-extension-boundary`, which AST-parses every `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, and `.cjs` file below `src/` and `cli/` with no test, bench, fixture, generated-file, template, or setup-file exclusion and fails if the scan visits zero files.
- Consumes: no third-party runtime value.

- [ ] **Step 1: Write failing contract and policy tests**

Add a contract test with literal runtime assertions:

```ts
import { assertEquals } from "#veryfront/testing/assert.ts";
import { HTMLHeadLocatorName, MAX_HTML_HEAD_PARSE_BYTES } from "./html-head-locator.ts";

Deno.test("HTML head locator contract owns stable runtime identifiers", () => {
  assertEquals(HTMLHeadLocatorName, "HTMLHeadLocator");
  assertEquals(MAX_HTML_HEAD_PARSE_BYTES, 8_388_608);
});
```

In `audit-parser-extension-boundary.test.ts`, use literal source files whose expected violations are `src/html/other.ts` importing parser-only, `src/html/head-boundary.ts` importing the package root, and `cli/main.ts` dynamically importing parser-only. The same test must accept only the exact owner/specifier pair. Include every TypeScript and JavaScript extension, multiline static imports, re-exports, string-literal and no-substitution-template dynamic imports, unshadowed literal `require(...)`/`require.resolve(...)`, TypeScript import-equals with `externalModuleReference`, type-only imports, tests, benches, fixtures, generated files, and CLI templates.

Add versioned and unversioned `npm:@veryfront/ext-parser-parse5` forms plus relative paths from both `src/` and `cli/` that normalize into `extensions/ext-parser-parse5`; every one is a violation even from the canonical owner. Include dot segments and Windows separators in fixture paths without depending on the host platform. Assert shadowed/local `require`, computed imports/requires, comments, ordinary strings, regular expressions, and interpolated template-literal source examples are ignored. Opaque computed dependency detection remains owned by the separate repository-wide audit.

Exercise the real collector against a temporary `src/` and `cli/` tree. Assert it visits a known nonzero count and reports a seeded forbidden import, preventing the zero-file walker failure present in the broader audit.

- [ ] **Step 2: Run the tests and observe the intended failures**

Run:

```bash
deno test -A --frozen src/extensions/parser/html-head-locator.test.ts scripts/lint/audit-parser-extension-boundary.test.ts
```

Expected: FAIL because the contract module and `findUnauthorizedParserExtensionImports` do not exist.

- [ ] **Step 3: Implement the exact contract and policy scanner**

Create `html-head-locator.ts` with the exact discriminated unions and readonly properties from the approved design. Export the types from `src/extensions/parser/index.ts`; do not add a vendor alias.

In `audit-parser-extension-boundary.ts`, use the existing first-party `@veryfront/ext-parser-babel/parser-only` tooling parser rather than regex extraction. Walk `src/` and `cli/` as separate roots and parse each file once. Inspect import/export declarations, string-literal and no-substitution-template dynamic imports, unshadowed literal CommonJS `require`/`require.resolve`, and TypeScript import-equals external module references. Add:

```ts
const PARSER_EXTENSION_PACKAGE = "@veryfront/ext-parser-parse5";
const PARSER_ONLY_SPECIFIER = `${PARSER_EXTENSION_PACKAGE}/parser-only`;
const PARSER_ONLY_CORE_OWNER = "src/html/head-boundary.ts";
```

Classify a target as the parser extension when it is the bare package/root or subpath, any versioned or unversioned `npm:` form of that package, or a relative specifier whose importer-relative POSIX-normalized target enters `extensions/ext-parser-parse5`. Normalize fixture separators explicitly rather than through host-dependent path behavior. Every classified target is a violation unless the raw specifier is exactly `PARSER_ONLY_SPECIFIER` and the normalized owner is exactly `PARSER_ONLY_CORE_OWNER`; npm and relative spellings are never authorized. Computed imports/requires cannot prove a fixed target and remain outside this narrow reverse-edge policy; the separate repository-wide dependency remediation owns opaque-loader detection.

Wire the scanner to the dedicated executable task without modifying or relying on the broken general core-dependency walker. Add root task `test:scripts:parser-extension-boundary` for its executable-level test and chain that task from `test:scripts`, so the normal script portfolio cannot omit the regression.

- [ ] **Step 4: Verify the contract and policy are green**

Run:

```bash
deno test -A --frozen src/extensions/parser/html-head-locator.test.ts scripts/lint/audit-parser-extension-boundary.test.ts
deno task test:scripts:parser-extension-boundary
deno task lint:parser-extension-boundary
deno check src/extensions/parser/index.ts scripts/lint/audit-parser-extension-boundary.ts
```

Expected: all commands exit 0, the executable reports a nonzero scanned-file count, the policy recognizes exactly one synthetic owner/specifier pair, and the current production graph contains zero parser-extension edges because `src/html/head-boundary.ts` is not added until Task 8.

- [ ] **Step 5: Commit only Task 1 files**

```bash
git add src/extensions/parser/html-head-locator.ts src/extensions/parser/html-head-locator.test.ts src/extensions/parser/index.ts scripts/lint/audit-parser-extension-boundary.ts scripts/lint/audit-parser-extension-boundary.test.ts deno.json
git commit -m "feat: define html head locator boundary"
git push origin codex/module-reconcile-20260723
```

---

### Task 2: Create the parser extension and bounded UTF-8 admission

**Files:**

- Create: `extensions/ext-parser-parse5/deno.json`
- Create: `extensions/ext-parser-parse5/README.md`
- Create: `extensions/ext-parser-parse5/src/index.ts`
- Create: `extensions/ext-parser-parse5/src/parser-only.ts`
- Create: `extensions/ext-parser-parse5/src/utf8-limit.ts`
- Test: `extensions/ext-parser-parse5/src/parser-only.test.ts`
- Test: `extensions/ext-parser-parse5/src/index.test.ts`
- Modify: `deno.json`
- Modify: `deno.lock`

**Interfaces:**

- Produces: `Parse5HTMLHeadLocator implements HTMLHeadLocator` with synchronous `locate(html: string): HtmlHeadLocationResult`.
- Produces: normal extension factory named `ext-parser-parse5`, version `0.1.0`, providing `HTMLHeadLocator`.
- Produces: `utf8LengthWithinLimit(input, limit): { ok: true; bytes: number } | { ok: false }`, scanning UTF-16 once and stopping at the first scalar whose UTF-8 width exceeds the limit.
- Consumes: type-only `HTMLHeadLocator`, `HtmlHeadLocationResult`, and `MaxHTMLHeadParseBytes` from `veryfront/extensions/parser`; vendor runtime only through the extension-local `parse5` import alias.

- [ ] **Step 1: Add failing admission and module-boundary tests**

In `parser-only.test.ts`, test the exact boundary with ASCII and multi-byte input:

```ts
const locator = new Parse5HTMLHeadLocator();
assertEquals(locator.locate("a".repeat(8_388_608)).ok, true);
assertEquals(locator.locate("a".repeat(8_388_609)), {
  ok: false,
  reason: "input-too-large",
});
assertEquals(locator.locate("😀".repeat(2_097_152)).ok, true);
assertEquals(locator.locate("😀".repeat(2_097_152) + "a"), {
  ok: false,
  reason: "input-too-large",
});
```

Exercise `utf8LengthWithinLimit` directly with a table containing BMP text, a valid astral pair, a lone high surrogate, a lone low surrogate, a high/low pair split across successive scanned code units, and mixed BMP/astral/malformed input. For every admitted sample, assert the reported byte count equals `new TextEncoder().encode(sample).byteLength`; for every sample, assert exact-limit acceptance and first-byte-over rejection. Include a high surrogate as the final code unit at the limit and the same prefix followed by its low surrogate so lookahead cannot double-count or skip the pair.

Assert the exact conservative unavailable placement for admitted input and assert that Task 2 has no parse callback or other vendor execution path. Assert the local exported `PARSER_MAX_HTML_HEAD_PARSE_BYTES` equals the core constant. In `index.test.ts`, execute the factory with a lightweight real extension context record and capture the implementation passed to `ctx.provide("HTMLHeadLocator", ...)`. Call that factory-provided locator with exactly 8,388,608 ASCII bytes and first-byte-over input, asserting admitted conservative placement and exact `{ ok: false, reason: "input-too-large" }`; checking only the method shape is insufficient.

- [ ] **Step 2: Run the extension tests and observe missing package failures**

Run:

```bash
deno test -A --no-lock extensions/ext-parser-parse5/src/parser-only.test.ts extensions/ext-parser-parse5/src/index.test.ts
```

Expected: FAIL because the extension files and exports do not exist.

- [ ] **Step 3: Add the extension manifest and minimal locator**

Use this manifest shape:

```json
{
  "name": "@veryfront/ext-parser-parse5",
  "version": "0.1.0",
  "exports": {
    ".": "./src/index.ts",
    "./parser-only": "./src/parser-only.ts"
  },
  "veryfront": {
    "extension": true,
    "contracts": { "provides": ["HTMLHeadLocator"] },
    "capabilities": []
  },
  "imports": {
    "parse5": "npm:parse5@7.3.0",
    "@std/assert": "jsr:@std/assert@1.0.19",
    "@std/testing/bdd": "jsr:@std/testing@1.0.17/bdd",
    "veryfront/extensions": "../../src/extensions/index.ts",
    "veryfront/extensions/parser": "../../src/extensions/parser/index.ts"
  },
  "tasks": {
    "test": "deno test --allow-all --unstable-worker-options src/",
    "check": "deno check src/index.ts src/parser-only.ts src/*.test.ts"
  }
}
```

Add `./extensions/ext-parser-parse5` beside `ext-parser-babel` in the root workspace. In `parser-only.ts`, declare:

```ts
import type {
  HtmlHeadLocationResult,
  HTMLHeadLocator,
  MaxHTMLHeadParseBytes,
} from "veryfront/extensions/parser";

export const PARSER_MAX_HTML_HEAD_PARSE_BYTES = 8_388_608 satisfies MaxHTMLHeadParseBytes;
```

The first green implementation performs only bounded UTF-8 admission and returns an exact conservative placement for admitted input: both insertion lanes and module ordering are unavailable with `unsafe-insertion-state`, `contentStart` and `importMapPreludeEndOffset` are zero, the authored import-map state is invalid with `unusable-element`, and both located-tag flags are false. Assert that literal object in `parser-only.test.ts`. It must not import or execute parse5 yet. This interim result is safe because it authorizes no insertion and performs bounded linear work; Task 3 introduces vendor parsing only together with all tokenizer/tree/open-stack budgets, and Tasks 4 and 5 replace the conservative placement before Task 8 introduces any core consumer import.

- [ ] **Step 4: Reproduce the parser lock patch from a clean checkout**

Stage only the Task 2 extension files and `deno.json`, not the working lock. Create a detached checkout of the post-Task-1 `HEAD`, apply that exact cached patch, and regenerate with Deno 2.7.7. Byte-compare its binary lock diff with the reconciliation worktree. This clean reproduction must show the direct `npm:parse5@7.3.0` specifier plus the two deterministic Browserslist normalizations and no Tailwind contribution or other dependency change.

```bash
git add extensions/ext-parser-parse5 deno.json
git diff --cached --check
deno --version | head -n 1 | rg -q '^deno 2\.7\.7 '
parser_lock_parent="$(mktemp -d)"
parser_lock_worktree="$parser_lock_parent/checkout"
cleanup_parser_lock_worktree() {
  git worktree remove --force "$parser_lock_worktree" >/dev/null 2>&1 || true
  rmdir "$parser_lock_parent" >/dev/null 2>&1 || true
}
trap cleanup_parser_lock_worktree EXIT
git worktree add --detach "$parser_lock_worktree" HEAD
git diff --cached --binary | git -C "$parser_lock_worktree" apply -
(cd "$parser_lock_worktree" && deno install --lockfile-only)
diff -u <(git diff --binary HEAD -- deno.lock) <(git -C "$parser_lock_worktree" diff --binary HEAD -- deno.lock)
cleanup_parser_lock_worktree
trap - EXIT
git add deno.lock
```

- [ ] **Step 5: Verify extension isolation and admission with the frozen lock**

Run:

```bash
deno test --config=extensions/ext-parser-parse5/deno.json -A --frozen extensions/ext-parser-parse5/src/parser-only.test.ts extensions/ext-parser-parse5/src/index.test.ts
deno check --config=extensions/ext-parser-parse5/deno.json --frozen extensions/ext-parser-parse5/src/index.ts extensions/ext-parser-parse5/src/parser-only.ts extensions/ext-parser-parse5/src/parser-only.test.ts extensions/ext-parser-parse5/src/index.test.ts
deno lint extensions/ext-parser-parse5/src
deno fmt --check extensions/ext-parser-parse5 deno.json
```

Expected: all commands exit 0. Inspect `deno info --json extensions/ext-parser-parse5/src/parser-only.ts` and verify the runtime dependency graph contains neither parse5 nor a runtime `veryfront` module. Task 3 adds the parse5 edge together with resource budgets.

- [ ] **Step 6: Commit and push the extension skeleton with its reviewed lock owner**

```bash
git diff --cached --check
git commit -m "feat: add bounded html parser extension"
git push origin codex/module-reconcile-20260723
```

The commit contains only the extension, its workspace registration, and the byte-matched parser lock patch. Do not stage any CSS file.

---

### Task 3: Enforce deterministic tokenizer, tree, and open-stack budgets

**Files:**

- Create: `extensions/ext-parser-parse5/src/budget.ts`
- Create: `extensions/ext-parser-parse5/src/budgeted-tokenizer.ts`
- Create: `extensions/ext-parser-parse5/src/budgeted-tree-adapter.ts`
- Create: `extensions/ext-parser-parse5/src/budgeted-parser.ts`
- Test: `extensions/ext-parser-parse5/src/budgeted-parser.test.ts`
- Modify: `extensions/ext-parser-parse5/src/parser-only.ts`

**Interfaces:**

- Produces: private identity-checked `HTML_PARSE_BUDGET_EXCEEDED` sentinel and `isHTMLParseBudgetExceeded(value)`; neither is exported from the package.
- Produces: `parseWithinBudgets(html, probeAllowance?)` returning one default parse5 document and copied counter facts, or throwing the private sentinel.
- Consumes: parse5's exported `Parser`, `Tokenizer`, `defaultTreeAdapter`, `Token`, and associated types at the exact pinned version.
- Replaces: Task 2's no-vendor conservative locator path with `parseWithinBudgets(html)`; no admitted authored input reaches parse5 before every HTML budget is active.

- [ ] **Step 1: Write literal at-limit and first-over-limit tests**

Build table-driven tests whose expected outcome is hand-derived rather than computed from production constants. Cover:

| Budget                   | Accepted fixture                                                            | Rejected fixture                       |
| ------------------------ | --------------------------------------------------------------------------- | -------------------------------------- |
| per-start-tag attributes | one tag with 256 attempted attributes                                       | same tag with 257 attempted attributes |
| total attributes         | tags totaling 16,384 attempts                                               | same stream starting attempt 16,385    |
| emitted tokens           | input producing exactly 131,072 tokens                                      | input producing token 131,073          |
| tag code units           | one start and one end tag consuming exactly 65,536 code units               | either tag consuming code unit 65,537  |
| nodes                    | tree allocating exactly 32,768 document/fragment/element/text/comment nodes | allocation 32,769                      |
| live open elements       | tree reaching live stack depth 1,024                                        | push making depth 1,025                |

Include duplicate attribute names in the 257-attempt fixture, nested templates, foreign SVG, table foster parenting, and adoption-agency formatting cases. For every first-over fixture assert the public result is exactly `{ ok: false, reason: "input-too-complex" }`; for a deliberately thrown `new Error("vendor failure")`, assert strict error identity propagates.

- [ ] **Step 2: Run the budget tests and observe over-limit cases incorrectly parse**

Run:

```bash
deno test -A --no-lock extensions/ext-parser-parse5/src/budgeted-parser.test.ts
```

Expected: FAIL because the over-limit documents are accepted and `parseWithinBudgets` is absent.

- [ ] **Step 3: Implement tokenizer budgets before parsing continues**

Subclass `Tokenizer`. Override `_createStartTagToken`, `_createEndTagToken`, `_createAttr`, `_consume`, `_advanceBy`, and `prepareToken` to maintain tag-local and total counters. Before calling the superclass operation that begins attempt 257/16,385, emits token 131,073, or consumes tag code unit 65,537, throw the private sentinel. Reset tag-local state only after the current tag is emitted; duplicate attributes count at `_createAttr`, before parse5 deduplicates them.

Subclass `Parser` and replace `this.tokenizer` with the budgeted tokenizer in the constructor, after `super(...)` and before `tokenizer.write(...)` can run. Override `onItemPush` and reject when the post-push `this.openElements.stackTop + 1` exceeds 1,024, before calling `super.onItemPush` or processing another token.

- [ ] **Step 4: Implement a capped delegating tree adapter**

Wrap `defaultTreeAdapter` and increment before each allocation in `createDocument`, `createDocumentFragment`, `createElement`, `createCommentNode`, `createTextNode`, and the allocation branches of `insertText`/`insertTextBefore`. Count template content fragments and implicit elements. Throw before allocation 32,769. Delegate every other method without copying parse5 source and preserve parse5's text-node coalescing behavior.

- [ ] **Step 5: Convert only the private sentinel at the public boundary**

`Parse5HTMLHeadLocator.locate` catches only values for which `isHTMLParseBudgetExceeded` returns true and converts them to `{ ok: false, reason: "input-too-complex" }`. All other values, including lookalike objects and errors with the same message, propagate unchanged.

- [ ] **Step 6: Run hook, boundary, formatting, lint, and type gates**

Run:

```bash
deno test -A --no-lock extensions/ext-parser-parse5/src/budgeted-parser.test.ts extensions/ext-parser-parse5/src/parser-only.test.ts
deno check --no-lock extensions/ext-parser-parse5/src/budgeted-parser.ts extensions/ext-parser-parse5/src/budgeted-parser.test.ts
deno lint extensions/ext-parser-parse5/src
deno fmt --check extensions/ext-parser-parse5/src
```

Expected: all exact-limit fixtures pass, every first-over fixture rejects deterministically, and unexpected exceptions preserve identity.

- [ ] **Step 7: Commit and push the bounded parser**

```bash
git add extensions/ext-parser-parse5/src/budget.ts extensions/ext-parser-parse5/src/budgeted-tokenizer.ts extensions/ext-parser-parse5/src/budgeted-tree-adapter.ts extensions/ext-parser-parse5/src/budgeted-parser.ts extensions/ext-parser-parse5/src/budgeted-parser.test.ts extensions/ext-parser-parse5/src/parser-only.ts extensions/ext-parser-parse5/src/parser-only.test.ts
git commit -m "feat: bound html parser complexity"
git push origin codex/module-reconcile-20260723
```

---

### Task 4: Derive standards-based structural head placement and safe lane probes

**Files:**

- Create: `extensions/ext-parser-parse5/src/source-locations.ts`
- Create: `extensions/ext-parser-parse5/src/head-structure.ts`
- Create: `extensions/ext-parser-parse5/src/insertion-probe.ts`
- Test: `extensions/ext-parser-parse5/src/head-structure.test.ts`
- Test: `extensions/ext-parser-parse5/src/insertion-probe.test.ts`
- Modify: `extensions/ext-parser-parse5/src/parser-only.ts`

**Interfaces:**

- Produces: `locateHeadStructure(html, document, parseProbe)` returning copied, vendor-free structural facts for the actual document `head`, `body`, and `frameset`.
- Produces: independently proven `importMapInsertion` and `endInsertion` lanes; a failed probe changes only its lane to `{ status: "unavailable", reason: "unsafe-insertion-state" }`.
- Consumes: one initial parsed tree; probe calls are sequential, collision-free, and release the prior probe tree before starting another.

- [ ] **Step 1: Add failing literal structural fixtures**

Create a table with the original string, exact UTF-16 offsets, and expected lane status for all of these cases:

- explicit `<head></head>`, explicit-start/implicit-end, omitted start/end, entirely implicit empty head, closing-only `</body></html>`, and frameset documents;
- direct head children after an explicit `</head>` that parse back into the actual head;
- templates before/inside the head, SVG/foreign-content descendants, script escaped/double-escaped states, raw-text/RCDATA, abrupt comments, quoted and malformed unquoted attributes, and head-name lookalikes;
- unclosed `template`, `script`, `style`, `title`, `noframes`, and scripting-enabled `noscript` elements whose vendor locations do not enclose their source;
- a document where only the import-map lane is safe and one where only the end lane is safe.
- dense marker-prefix decoys, candidates 0 through 1,022 selecting the exact final slot, and candidates 0 through 1,023 exhausting the fixed marker space without another source scan.

For each accepted case, insert marker fragments at the returned offsets, reparse with parse5 in the extension test, and assert every marker's direct parent is the actual HTML-namespace head. Also assert the concatenation of all untouched source slices equals the original input exactly, including lone surrogates and astral characters around insertion points.

- [ ] **Step 2: Run the structural tests and observe the conservative unavailable lanes fail**

Run:

```bash
deno test -A --no-lock extensions/ext-parser-parse5/src/head-structure.test.ts extensions/ext-parser-parse5/src/insertion-probe.test.ts
```

Expected: FAIL because Task 2 deliberately exposes no available insertion lane and probes are absent.

- [ ] **Step 3: Implement iterative tree inspection and strict location validation**

Traverse with an explicit stack. Never recurse and never serialize. Identify the actual HTML-namespace `html`, `head`, `body`, and `frameset` elements through the tree adapter. Copy a location only when every required offset is a finite integer within `0..html.length`, start is no later than end, a complete start tag is contained in the element range, and every source-located descendant/template-content extent is contained before an element end contributes to the end lane.

Compute:

- explicit-head `contentStart` from its start-tag end;
- implicit nonempty `contentStart` from the minimum trustworthy direct-head child start;
- empty implicit anchor from explicit `<html>` start-tag end, then doctype end, then zero;
- `firstBodyOrFramesetSourceOffset` as the minimum trustworthy source start in body/frameset subtrees;
- end candidate as the maximum of explicit head end-tag start and trustworthy direct-head child ends, or `contentStart`/implicit anchor for an empty head.

Any missing, reversed, or out-of-source recovery location makes only the lane that relies on it unavailable. A missing synthetic document head and unexpected parse5 failures remain implementation errors.

- [ ] **Step 4: Implement collision-free direct-head probes**

Use a fixed marker shape `vf-head-probe-<decimal>-x` and a single-pass finite-state scan for its non-self-overlapping prefix. Record only complete canonical suffixes 0–1,023 in a fixed `Uint8Array(1024)`, examining at most four suffix code units per prefix match; choose the first clear slot. Prefix decoys, leading-zero forms, overlong numbers, and incomplete suffixes never trigger rescans. If every slot is occupied, mark the affected lane unavailable with `unsafe-insertion-state`. Include the one source scan, bitmap, maximum marker length, and injected marker bytes in the declared fixed probe allowance.

For the import-map lane inject exactly one complete inline `script[type="importmap"]` with `{}`. For the end lane inject one combined `meta`, `link`, `style`, and `script` sequence. Reparse the adjusted source with the separately identified probe allowance, then require every marker to have the actual head as direct parent and a source start equal to the adjusted offset. Never use comment probes.

Copy all needed initial-tree facts before probing, drop the initial tree reference, and run distinct candidate probes sequentially. If both lanes share a candidate, one combined proof may satisfy both only when it contains both exact lane grammars. Probe budget exhaustion returns `unsafe-insertion-state` for that lane; impossible sentinel identity and unexpected exceptions propagate.

- [ ] **Step 5: Verify structural and probe behavior**

Run:

```bash
deno test -A --no-lock extensions/ext-parser-parse5/src/head-structure.test.ts extensions/ext-parser-parse5/src/insertion-probe.test.ts extensions/ext-parser-parse5/src/budgeted-parser.test.ts
deno check --no-lock extensions/ext-parser-parse5/src/head-structure.ts extensions/ext-parser-parse5/src/insertion-probe.ts
deno fmt --check extensions/ext-parser-parse5/src
deno lint extensions/ext-parser-parse5/src
```

Expected: all fixtures reparse with markers in the actual head; malformed recovery locations never escape as impossible core offsets.

- [ ] **Step 6: Commit and push structural placement**

```bash
git add extensions/ext-parser-parse5/src/source-locations.ts extensions/ext-parser-parse5/src/head-structure.ts extensions/ext-parser-parse5/src/insertion-probe.ts extensions/ext-parser-parse5/src/head-structure.test.ts extensions/ext-parser-parse5/src/insertion-probe.test.ts extensions/ext-parser-parse5/src/parser-only.ts
git commit -m "feat: locate structural html head boundaries"
git push origin codex/module-reconcile-20260723
```

---

### Task 5: Classify authored import maps and module-resolution ordering

**Files:**

- Create: `extensions/ext-parser-parse5/src/json-budget.ts`
- Create: `extensions/ext-parser-parse5/src/import-map-state.ts`
- Create: `extensions/ext-parser-parse5/src/module-ordering.ts`
- Test: `extensions/ext-parser-parse5/src/json-budget.test.ts`
- Test: `extensions/ext-parser-parse5/src/import-map-state.test.ts`
- Test: `extensions/ext-parser-parse5/src/module-ordering.test.ts`
- Modify: `extensions/ext-parser-parse5/src/head-structure.ts`
- Modify: `extensions/ext-parser-parse5/src/parser-only.ts`

**Interfaces:**

- Produces: a linear, non-recursive JSON lexical admission pass that returns only admitted text metadata and throws the private authored-import-map budget sentinel.
- Produces: exact `AuthoredImportMapState`, `importMapPreludeEndOffset`, and `HtmlModuleResolutionOrdering` values.
- Consumes: copied actual-tree nodes and trustworthy source facts from Task 4.

- [ ] **Step 1: Write failing import-map classification tests**

Use literal expected states for absent, one valid map, multiple valid maps, body maps, mixed-case and ASCII-whitespace-surrounded types, external `src`, empty, unterminated, invalid JSON, non-object JSON, and invalid final `imports`/`scopes`/`integrity` shapes. Include unknown top-level keys and invalid individual address/integrity entries that remain usable, plus duplicate-key last-value behavior.

At every JSON cap, test exact acceptance and first-over rejection: map 16/17, 524,288/524,289 per-map bytes, 1,048,576/1,048,577 aggregate bytes, depth 64/65, and occurrence 16,384/16,385. Duplicate member occurrences count before `JSON.parse` collapses them. Assert an import-map JSON budget rejection yields authored state `{ status: "invalid", reason: "input-too-complex" }` while leaving an unrelated end-only lane available.

- [ ] **Step 2: Write failing ordering and prelude tests**

Use exact offsets for modern `meta[charset]`, legacy encoding metadata, first direct-head `base[href]`, metadata CSP, parser-blocking executable classic scripts, module scripts, and actionable `link[rel~="modulepreload"]`. Cover ASCII case and whitespace normalization, `src`, `async`, `defer`, `nomodule`, `language`, MIME, namespace, relation-token, template, and foreign-content exclusions. A matching consumer without a trustworthy source start must produce `{ status: "unavailable", reason: "unsafe-insertion-state" }`.

- [ ] **Step 3: Run classification and ordering tests red**

Run:

```bash
deno test -A --no-lock extensions/ext-parser-parse5/src/json-budget.test.ts extensions/ext-parser-parse5/src/import-map-state.test.ts extensions/ext-parser-parse5/src/module-ordering.test.ts
```

Expected: FAIL because authored state is always absent and ordering/prelude facts are not implemented.

- [ ] **Step 4: Implement bounded JSON lexing and authored-state aggregation**

Scan code units once, with explicit string/escape, container, member, and item states. Count UTF-8 width using the same scalar rules as Task 2, count each member/item occurrence before parsing, and reject before the first over-limit operation. Only admitted text reaches `JSON.parse`; do not retain normalized map copies.

Classify only actual document-tree HTML-namespace `script[type="importmap"]` elements, including body markers and excluding templates/foreign namespaces. Every marker must be inline, nonempty, have a trustworthy explicit end tag, and pass JSON/shape validation. Aggregate invalid wins; otherwise return positive count and maximum complete end-tag end as `lastProcessingEndOffset`.

- [ ] **Step 5: Implement prelude and first-consumer ordering**

Compute `importMapPreludeEndOffset` as the maximum of `contentStart`, all trustworthy direct-head encoding declaration start-tag ends, the first direct-head `base[href]` start-tag end, and all direct-head metadata CSP start-tag ends. Compute the minimum source start for every actual-tree consumer that can begin module resolution under HTML processing rules. If known, choose the earliest consumer start within the head placement range; otherwise choose the safe end boundary, or the prelude boundary when the end lane is independently unavailable. Require `prelude <= insertion <= consumer` and prove the candidate with the import-map probe.

- [ ] **Step 6: Verify classification, limits, and ordering**

Run:

```bash
deno test -A --no-lock extensions/ext-parser-parse5/src/json-budget.test.ts extensions/ext-parser-parse5/src/import-map-state.test.ts extensions/ext-parser-parse5/src/module-ordering.test.ts extensions/ext-parser-parse5/src/head-structure.test.ts
deno check --no-lock extensions/ext-parser-parse5/src/import-map-state.ts extensions/ext-parser-parse5/src/module-ordering.ts
deno fmt --check extensions/ext-parser-parse5/src
deno lint extensions/ext-parser-parse5/src
```

Expected: all literal state/offset cases and exact budget boundaries pass.

- [ ] **Step 7: Commit and push import-map semantics**

```bash
git add extensions/ext-parser-parse5/src/json-budget.ts extensions/ext-parser-parse5/src/import-map-state.ts extensions/ext-parser-parse5/src/module-ordering.ts extensions/ext-parser-parse5/src/json-budget.test.ts extensions/ext-parser-parse5/src/import-map-state.test.ts extensions/ext-parser-parse5/src/module-ordering.test.ts extensions/ext-parser-parse5/src/head-structure.ts extensions/ext-parser-parse5/src/parser-only.ts
git commit -m "feat: classify html import map placement"
git push origin codex/module-reconcile-20260723
```

---

### Task 6: Publish and pass the locator conformance suite

**Files:**

- Create: `src/extensions/parser/testing.ts`
- Create: `src/extensions/parser/html-head-locator-conformance.ts`
- Create: `src/extensions/parser/html-head-locator-fixtures.ts`
- Create: `src/extensions/parser/html-head-locator-conformance.test.ts`
- Create: `extensions/ext-parser-parse5/src/conformance.test.ts`
- Modify: `deno.json`

**Interfaces:**

- Produces: testing-only `runHTMLHeadLocatorConformanceSuite(name, createLocator)` exported through `veryfront/extensions/parser/testing`.
- Consumes: only the core locator contract and literal fixtures; the core suite has no parse5 import.

- [ ] **Step 1: Write the failing reusable conformance suite**

Move the approved adversarial cases into immutable fixture records containing literal source, expected result, expected offsets, and optional requested-lane proof data. The suite covers every structural, lexical, namespace, import-map, ordering, recovery-location, exact-limit, and independent-lane case listed in the design's Verification section. Freeze each fixture and assert the locator result uses only contract-owned values.

Add this extension test:

```ts
import { runHTMLHeadLocatorConformanceSuite } from "veryfront/extensions/parser/testing";
import { Parse5HTMLHeadLocator } from "./parser-only.ts";

runHTMLHeadLocatorConformanceSuite(
  "@veryfront/ext-parser-parse5/parser-only",
  () => new Parse5HTMLHeadLocator(),
);
```

- [ ] **Step 2: Run conformance red and record literal mismatches**

Run:

```bash
deno test -A --no-lock extensions/ext-parser-parse5/src/conformance.test.ts
```

Expected: FAIL on any fixture not yet modeled exactly. Record each mismatch in the implementer report; never weaken a hand-derived expected offset to match implementation output.

- [ ] **Step 3: Export the testing-only entry and close every mismatch**

Add `./extensions/parser/testing` to root exports/import mappings, pointing only at `src/extensions/parser/testing.ts`. Keep fixture data and test utilities outside the production parser barrel. Fix the extension implementation until every conformance row passes, preserving the design contract rather than adding case-specific fallbacks.

- [ ] **Step 4: Verify both package entries and conformance**

Run:

```bash
deno test -A --no-lock src/extensions/parser/html-head-locator-conformance.test.ts extensions/ext-parser-parse5/src/conformance.test.ts extensions/ext-parser-parse5/src/*.test.ts
deno check --no-lock src/extensions/parser/testing.ts extensions/ext-parser-parse5/src/index.ts extensions/ext-parser-parse5/src/parser-only.ts extensions/ext-parser-parse5/src/*.test.ts
deno fmt --check src/extensions/parser extensions/ext-parser-parse5
deno lint src/extensions/parser extensions/ext-parser-parse5/src
```

Expected: all extension tests typecheck without `--no-check`; normal factory and parser-only calls independently enforce 8 MiB admission.

- [ ] **Step 5: Commit and push the conformance surface**

```bash
git add src/extensions/parser/testing.ts src/extensions/parser/html-head-locator-conformance.ts src/extensions/parser/html-head-locator-fixtures.ts src/extensions/parser/html-head-locator-conformance.test.ts extensions/ext-parser-parse5/src/conformance.test.ts deno.json
git commit -m "test: publish html locator conformance suite"
git push origin codex/module-reconcile-20260723
```

---

### Task 7: Wire package metadata, binary, and SBOM ownership before core imports

**Files:**

- Modify: `deno.json`
- Modify: `scripts/build/npm-package-metadata.ts`
- Modify: `scripts/build/npm-package-metadata.test.ts`
- Modify: `scripts/build/npm-extension-package-metadata.ts`
- Modify: `scripts/build/npm-extension-package-metadata.test.ts`
- Modify: `scripts/build/compile-binary.ts`
- Modify: `scripts/build/compile-binary.test.ts`
- Modify: `scripts/build/generate-sbom.ts`
- Modify: `scripts/build/generate-sbom.test.ts`

**Interfaces:**

- Produces: root npm dependency `@veryfront/ext-parser-parse5` pinned to the exact root package version before any core source imports its parser-only entry.
- Produces: extension npm dependency `parse5` pinned exactly to `7.3.0`.
- Produces: compiled-binary inclusion of the parser extension source.
- Preserves: root metadata has no direct `parse5` dependency and no bundled extension subtree.
- Defers: the DNT mapping until Task 8 adds the source edge in the same uncommitted worktree; DNT 0.42.3 rejects package mappings whose source specifier is not yet present.

- [ ] **Step 1: Add failing metadata, mapping, inclusion, and packed-root tests**

Extend existing literal package tests to assert:

- workspace discovery includes `ext-parser-parse5`;
- `EXTENSION_OWNED_DEPENDENCIES` classifies `parse5` as extension-owned;
- root generated dependencies contain exact co-version `@veryfront/ext-parser-parse5` but not `parse5`;
- extension generated dependencies contain exact `parse5: "7.3.0"`;
- `DEFAULT_INCLUDES` contains both extension `index.ts` and `parser-only.ts`;
- SBOM attribution marks parse5/entities under the parser extension and root transitive install graph, never as a direct core dependency.

Build the npm packages in a clean temporary output directory and inspect the packed root artifact. Assert the root package declares the exact co-version extension dependency and does not contain an `extensions/ext-parser-parse5` subtree or parse5/entities implementation. This assertion must pass before Task 8 adds the first core parser-only import.

- [ ] **Step 2: Run packaging unit tests red**

Run:

```bash
deno test --config=scripts/test.deno.json --allow-read --allow-write --allow-run scripts/build/npm-package-metadata.test.ts scripts/build/npm-extension-package-metadata.test.ts scripts/build/compile-binary.test.ts scripts/build/generate-sbom.test.ts
```

Expected: FAIL because the extension has no generated-package, DNT, binary, or SBOM ownership wiring.

- [ ] **Step 3: Implement exact package ownership and mapping**

Follow the existing extension-package metadata mechanism, but keep the new package external in the root artifact. Add the co-version dependency at metadata generation, not as a root vendor alias. Add only the two required extension source entries to compiled-binary includes. Do not add the DNT package mapping yet: without Task 8's source edge, DNT rejects that unused mapping.

Task 2 already committed the byte-reproduced parser lock patch with the extension manifest. Task 7 must leave `deno.lock` unchanged; fail if metadata, binary, or SBOM wiring mutates it.

- [ ] **Step 4: Verify generated metadata and dependency ownership**

Run:

```bash
deno test --config=scripts/test.deno.json --frozen --allow-read --allow-write --allow-run scripts/build/npm-package-metadata.test.ts scripts/build/npm-extension-package-metadata.test.ts scripts/build/compile-binary.test.ts scripts/build/generate-sbom.test.ts
deno task build:npm
deno task lint:dependency-boundaries
git diff --exit-code HEAD -- deno.lock
```

Inspect `npm/package.json`, `npm/extensions/ext-parser-parse5/package.json`, and both packed file lists. Expected: the lock remains identical to `HEAD`; the root artifact owns only the first-party co-version dependency; the extension owns exact parse5; and the root artifact neither bundles nor directly declares parse5/entities. The repo-wide `lint:core-deps` gate is intentionally not evidence here until the separate dependency-boundary remediation fixes its zero-file traversal and removes existing non-parser violations.

- [ ] **Step 5: Keep the reviewed metadata uncommitted and continue directly to Task 8**

Do not stage, commit, or push Task 7 alone. DNT cannot accept the external mapping until the first source import exists, while committing that source import without the mapping would allow the root build to inline the extension. Keep the verified Task 7 worktree changes intact and complete Task 8 immediately; Task 8's checkpoint atomically contains package ownership, the source edge, the DNT mapping, and packed-root proof.

---

### Task 8: Build the dependency-free core capture, validation, and insertion policy

**Files:**

- Create: `src/html/head-boundary-validation.ts`
- Create: `src/html/head-boundary.ts`
- Create: `src/html/head-boundary.test.ts`
- Modify: `src/html/index.ts`
- Modify: `scripts/build/build-npm-dnt.ts`
- Modify: `scripts/build/npm-package-metadata.test.ts`

**Interfaces:**

- Produces: internal `locateHtmlHead`, `applyHtmlHeadInsertions`, and `applyHtmlHeadInsertionPlan` with the exact signatures and discriminated results in the approved design.
- Produces: dependency-free `captureAndValidateHtmlHeadLocation(html, value)` used by the production facade and hostile-shape tests.
- Consumes: one synchronous `new Parse5HTMLHeadLocator()` imported only in `src/html/head-boundary.ts` from `@veryfront/ext-parser-parse5/parser-only`.
- Produces: the DNT mapping from workspace source `./extensions/ext-parser-parse5/src/parser-only.ts` to external package `{ name: "@veryfront/ext-parser-parse5", subPath: "parser-only" }` in the same atomic checkpoint as that first source edge.

- [ ] **Step 1: Write failing defensive-capture tests**

Use a pure fake locator-result value and assert rejection of arrays, nulls, missing own fields, inherited fields, accessors, proxies that throw, non-integers, infinities, negative/out-of-range offsets, reversed ranges, impossible body upper bounds, prelude-after-insertion, insertion-after-first-consumer, and invalid authored-map variants. Give each accessor a counter and assert it is observed at most once. Mutate the original fake after capture and prove the returned placement does not change.

Exercise core's independent bounded UTF-8 admission with the same parity table as the extension: BMP text, valid astral pairs, lone high and low surrogates, a pair split across successive scanned code units, mixed BMP/astral/malformed content, an exact-limit terminal high surrogate, and that prefix followed by its low surrogate. Compare every admitted count with `TextEncoder` and assert exact-limit acceptance plus first-byte-over rejection so the two implementations cannot drift on malformed UTF-16.

Add valid cases where only one lane is available. Assert `locateHtmlHead(html, { importMap: true })` ignores an unavailable end lane, and `locateHtmlHead(html, { atEnd: true })` ignores an unavailable import-map lane.

In `npm-package-metadata.test.ts`, add a failing source-order contract requiring `buildExtensionPackages(...)`, then a dedicated build-local first-party-extension install, then `verifyNpmRootImportLifecycle()`. The local install set must be derived from every final root `package.json` dependency named `@veryfront/ext-*`, not copied into a second hard-coded production list. Validate that each dependency has the exact root version, resolves to an emitted extension directory whose manifest has the same name/version, and that the resulting sorted set is exactly the existing four root extensions plus `@veryfront/ext-parser-parse5` in this fixture. Assert one `npm install --ignore-scripts --legacy-peer-deps --no-save --no-package-lock` invocation receives every derived local directory. During that command, route the `@veryfront` scope to a loopback rejection trap and assert it receives zero requests, proving npm never tries to fetch an unpublished first-party package while ordinary third-party resolution remains available. Require the install and trap shutdown to occur only after every extension package exists and before the lifecycle probe, even on command failure; require the lifecycle probe to import both the package root and emitted `./esm/src/html/head-boundary.js`. The build-only install must not rewrite any published exact co-version dependency.

- [ ] **Step 2: Write failing insertion-policy tests**

Assert all of these literal behaviors:

- an all-empty insertion record throws `TypeError` without parsing;
- one locator/capture invocation per synchronous composite call and one per asynchronous plan call;
- vendor parse count no greater than one initial parse plus one sequential probe per distinct requested lane candidate;
- a plan callback receives a deeply frozen placement, runs once, and its thrown/rejected error preserves strict identity;
- no reparsing occurs after the plan returns;
- different offsets apply greatest to smallest;
- a shared offset orders import map, end assets, then trusted additional end content;
- untouched UTF-16 slices are identical;
- import-map grammar accepts one complete inline `script[type="importmap"]` with optional surrounding whitespace and rejects comments, `src`, empty/multiple scripts, or trailing text;
- end grammar accepts complete `meta`, `link`, `style`, and `script` sequences with inter-tag whitespace and rejects templates, comments, text, incomplete tags, and other elements.

- [ ] **Step 3: Run the core tests red**

Run:

```bash
deno test -A --no-lock src/html/head-boundary.test.ts
deno test --config=scripts/test.deno.json --frozen --allow-read scripts/build/npm-package-metadata.test.ts
```

Expected: FAIL because the core boundary modules, exact APIs, and build-local extension install ordering do not exist.

- [ ] **Step 4: Implement bounded admission and single-capture validation**

Repeat the 8 MiB bounded UTF-8 check in core before invoking the locator. Capture every required own data descriptor into null-prototype records; reject getters/setters and unexpected keys. Validate exact union tags, finite integer offsets, `0 <= offset <= html.length`, lane-local ordering, body/frameset upper bounds, and authored-map count/timing. Freeze every nested record and the placement before exposing it to a callback.

In the same implementation step, add the exact parser-only mapping to `build-npm-dnt.ts`. The source import and mapping must enter the worktree together; never run or commit a root npm build with only one side present.

After `buildExtensionPackages(...)` emits every extension and before `verifyNpmRootImportLifecycle()`, derive and validate the complete local directory set from the final root dependency metadata, then run the one no-save/no-lockfile npm install specified by the test. Do not special-case only the parser: that would make npm reconcile the other unpublished root extensions through the public registry. Configure the temporary loopback rejection trap as the install's `@veryfront` registry, assert it observed no request, and close it in `finally`. This build-only install supplies all root-owned first-party packages and their third-party dependencies to `npm/node_modules` for lifecycle verification; it must not alter the final published exact co-version entries. Extend the lifecycle probe to import the emitted head boundary directly as well as the root.

Invalid extension output throws an internal `TypeError` with source-free text; it is never converted to caller input. Only locator results `input-too-large`, `input-too-complex`, and requested-lane `unsafe-insertion-state` become `LocateHtmlHeadResult` rejections.

- [ ] **Step 5: Implement shared capture/commit and strict fragment grammar**

Use one private capture function and one private commit function. The synchronous and asynchronous public functions both call those primitives; neither calls the other. Validate planned fragments before slicing, derive required lanes from nonempty fields, and apply insertion groups in descending offset order. Keep `AdditionalHtmlHeadInsertions` trusted/internal but validate it with the same end-lane grammar.

Leave `HtmlHeadBoundary`, `findHtmlHeadBoundary`, and `insertBeforeHtmlHeadClose` temporarily intact because Tasks 9 and 10 still migrate their live consumers. Do not add a new caller. Task 10 removes those three exports only after `rg` proves that every production import has moved to the structural boundary.

- [ ] **Step 6: Verify core behavior and dependency policy**

Run:

```bash
deno test -A --no-lock src/html/head-boundary.test.ts
deno check --no-lock src/html/head-boundary.ts src/html/index.ts
deno task lint:parser-extension-boundary
deno task lint:dependency-boundaries
deno test --config=scripts/test.deno.json --frozen --allow-read --allow-write --allow-run scripts/build/npm-package-metadata.test.ts scripts/build/npm-extension-package-metadata.test.ts scripts/build/compile-binary.test.ts scripts/build/generate-sbom.test.ts
deno task build:npm
deno fmt --check src/html/head-boundary.ts src/html/head-boundary-validation.ts src/html/head-boundary.test.ts src/html/index.ts
deno lint src/html/head-boundary.ts src/html/head-boundary-validation.ts src/html/head-boundary.test.ts src/html/index.ts
```

Inspect `npm/package.json`, `npm/extensions/ext-parser-parse5/package.json`, and emitted `npm/esm/src/html/head-boundary.js`. Expected: all behavior passes; the dedicated parser-edge audit visits a nonzero source set and authorizes exactly the single first-party parser-only owner/specifier pair; the emitted core module retains the exact external first-party parser-only import; the root package declares the exact co-version extension but not parse5; and no extension/vendor implementation is bundled into root. Do not cite the currently false-green general `lint:core-deps` task as evidence.

- [ ] **Step 7: Commit and push core head placement**

```bash
git add deno.json scripts/build/npm-package-metadata.ts scripts/build/npm-package-metadata.test.ts scripts/build/npm-extension-package-metadata.ts scripts/build/npm-extension-package-metadata.test.ts scripts/build/build-npm-dnt.ts scripts/build/compile-binary.ts scripts/build/compile-binary.test.ts scripts/build/generate-sbom.ts scripts/build/generate-sbom.test.ts src/html/head-boundary-validation.ts src/html/head-boundary.ts src/html/head-boundary.test.ts src/html/index.ts
git diff --cached --check
git commit -m "feat: publish validated html head boundary"
git push origin codex/module-reconcile-20260723
```

---

### Task 9: Add structured HTML injection while preserving the legacy signature

**Files:**

- Modify: `src/html/html-injection.ts`
- Modify: `src/html/html-injection.test.ts`
- Modify: `src/html/index.ts`

**Interfaces:**

- Produces: `HtmlHeadInsertionOutcome`, `InjectHTMLContentWithHeadPlacementResult`, and `injectHTMLContentWithHeadPlacement(...)` exactly as specified.
- Preserves: `injectHTMLContent(template, content, metadata, options): string`.
- Consumes: `applyHtmlHeadInsertions` and optional trusted `AdditionalHtmlHeadInsertions.atEnd`.

- [ ] **Step 1: Replace scanner-oriented tests with failing structured behavior tests**

Keep the useful authored-decoy and lexical fixtures already present in the dirty worktree, but assert structured outcomes rather than textual-scanner internals. Add omitted-head success, exact 8 MiB post-transformation acceptance, first-byte-over rejection, and a small template whose rendered content pushes the final pre-insertion string over the limit. On rejection, assert placeholder, metadata, and body transformations remain while no import-map, stylesheet, preview stylesheet, or additional end markup appears.

Add a zero-request case that replaces all ordinary placeholders but proves the locator is not invoked. Add ordering cases proving generated import map uses the import-map lane and project/preview stylesheet plus trusted additional content use the end lane.

- [ ] **Step 2: Run the focused tests red**

Run:

```bash
deno test -A --no-lock src/html/html-injection.test.ts
```

Expected: FAIL because structured outcomes, omitted-head placement, and bounded post-transformation admission are absent.

- [ ] **Step 3: Implement one post-transformation head operation**

Snapshot metadata/options as today, complete content/title/description/meta/link/script/style/body transformations first, then build at most two nonempty insertion strings. Call the head boundary on that exact string once. Return:

```ts
{ html, headInsertion: { status: "not-requested" } }
{ html, headInsertion: { status: "inserted", placement } }
{ html: transformedWithoutHeadAssets, headInsertion: { status: "rejected", reason } }
```

The legacy helper delegates and returns `.html` for every outcome. It does not invoke parsing when neither generated nor additional head content exists. Remove all calls to the former structural scanner.

Both `html-injection` files currently contain recovered CSS-authority changes mixed with scanner work. Do not stage them until the CSS/compiler-identity batch has its own reviewed checkpoint, or until an isolated parser patch has been reconciled hunk-by-hunk and the staged diff proves it preserves every CSS behavior/test. Documentation for the new public outcome belongs to Task 15 rather than this mixed code checkpoint.

- [ ] **Step 4: Verify legacy compatibility and structured correctness**

Run:

```bash
deno test -A --no-lock src/html/html-injection.test.ts src/html/head-boundary.test.ts
deno check --no-lock src/html/html-injection.ts src/html/index.ts
deno fmt --check src/html/html-injection.ts src/html/html-injection.test.ts src/html/index.ts
deno lint src/html/html-injection.ts src/html/html-injection.test.ts src/html/index.ts
```

Expected: existing callers retain a string, structured callers can distinguish all three outcomes, and omitted heads receive requested assets.

- [ ] **Step 5: Commit only the injection migration**

```bash
git add src/html/html-injection.ts src/html/html-injection.test.ts src/html/index.ts
git diff --cached --check
git commit -m "feat: report html head insertion outcomes"
git push origin codex/module-reconcile-20260723
```

---

### Task 10: Fail closed in both authored-full-document rendering paths

**Files:**

- Modify: `src/rendering/orchestrator/html.ts`
- Modify: `src/rendering/orchestrator/html.test.ts`
- Modify: `src/rendering/script-page-handling.ts`
- Modify: `src/rendering/script-page-handling.test.ts`
- Modify: `src/html/tag-scanner.ts`
- Create: `src/html/tag-scanner.test.ts`

**Interfaces:**

- Consumes: `injectHTMLContentWithHeadPlacement`; theme persistence is trusted `additionalHeadInsertions.atEnd` in the same operation.
- Produces: requested placement rejection as `INPUT_VALIDATION_FAILED` with exact detail `Cannot safely place framework head content: <reason>` and no authored source.
- Preserves: user-code exceptions, including a user-thrown public `INPUT_VALIDATION_FAILED`, are sanitized as `RENDER_ERROR` by the script-page boundary.

- [ ] **Step 1: Write failing orchestrator outcome tests**

For each rejection reason, render a full authored document requesting framework assets and assert strict `INPUT_VALIDATION_FAILED`, exact source-free detail, no successful HTML, and no linked stylesheet artifact. Add a theme-persistence case that counts locator calls and proves import map, stylesheet, and theme script share one insertion operation. Retain and rerun the existing project-CSS promise-ownership regressions; this task must not regress their exact error identity or unhandled-rejection assertions.

- [ ] **Step 2: Write failing script-page boundary tests**

Add one full-document script page whose requested placement rejects and assert `INPUT_VALIDATION_FAILED` escapes as the production input failure. Add a separate user module that deliberately throws `INPUT_VALIDATION_FAILED.create(...)`; assert it is still wrapped/sanitized as `RENDER_ERROR`, proving classification is based on the local structured outcome rather than slug/class matching.

- [ ] **Step 3: Run both consumer suites red**

Run:

```bash
deno test -A --no-lock src/rendering/orchestrator/html.test.ts src/rendering/script-page-handling.test.ts
```

Expected: FAIL because both callers use the legacy unchanged-string path and the script-page catch cannot distinguish local placement rejection.

- [ ] **Step 4: Migrate orchestrator and script-page control flow**

Collect framework import map, stylesheet, and theme markup before calling the structured helper. Convert a local `rejected` outcome immediately to the exact `INPUT_VALIDATION_FAILED` detail; never report a stylesheet artifact for that render. Remove separate head parsing/insertion from theme persistence.

In script pages, keep user module load/render and metadata work inside the broad render-error catch, but return an internal discriminated generated result. Inspect and convert `headInsertion` after leaving that catch. Do not pass through an error because its class, slug, or message resembles an input error.

Treat the five current scanner call sites according to source ownership rather than replacing them mechanically:

- `src/html/html-injection.ts` and the authored-document path around `hasExplicitHeadBoundary` in `src/rendering/orchestrator/html.ts` must use the parser-backed structural boundary and its explicit rejection result.
- Theme persistence must be collected into the same authored-document insertion plan, eliminating its separate `insertBeforeHtmlHeadClose` pass.
- `injectHeadScriptsAfterCharset` and the final `buildCollectedHeadElements` insertion operate on framework-owned shells. Replace their scanner calls with an invariant-checked, structural-by-construction shell helper that receives the generator-owned head slots; do not invoke the authored-document parser for these paths.

Add a focused test for each of those five migrations, including locator call counts of one for the authored composite path and zero for both framework-owned shell paths.

Because `html.ts` contains unrelated dirty CSS/artifact work, review `git diff` before staging and keep all existing CSS tests/semantics intact. This task may be committed only after the CSS batch has its own reviewed checkpoint or after an exact patch audit proves no unresolved CSS migration line is staged.

After both authored-document consumers use the structural APIs, run `rg -n 'findHtmlHeadBoundary|insertBeforeHtmlHeadClose|HtmlHeadBoundary' src -g '*.ts' -g '*.tsx'`. When it reports only declarations/tests, remove exactly those three scanner APIs. Add focused tests for every generic tag-name, attribute, raw-text, and script lexical helper that remains so the cleanup does not erase unrelated scanner behavior.

- [ ] **Step 5: Verify rendering, error identity, and leak behavior**

Run:

```bash
DENO_TESTING=1 VF_DISABLE_LRU_INTERVAL=1 deno test -A --no-lock --trace-leaks src/rendering/orchestrator/html.test.ts src/rendering/script-page-handling.test.ts src/html/tag-scanner.test.ts
deno check --no-lock src/rendering/orchestrator/html.ts src/rendering/script-page-handling.ts
deno fmt --check src/rendering/orchestrator/html.ts src/rendering/orchestrator/html.test.ts src/rendering/script-page-handling.ts src/rendering/script-page-handling.test.ts src/html/tag-scanner.ts src/html/tag-scanner.test.ts
deno lint src/rendering/orchestrator/html.ts src/rendering/orchestrator/html.test.ts src/rendering/script-page-handling.ts src/rendering/script-page-handling.test.ts src/html/tag-scanner.ts src/html/tag-scanner.test.ts
```

Expected: both production paths fail closed only for their own structured rejection, user exceptions remain sanitized, and no unhandled rejection or resource leak is reported.

- [ ] **Step 6: Commit and push the production caller migration**

```bash
git add src/rendering/orchestrator/html.ts src/rendering/orchestrator/html.test.ts src/rendering/script-page-handling.ts src/rendering/script-page-handling.test.ts src/html/tag-scanner.ts src/html/tag-scanner.test.ts
git diff --cached --check
git commit -m "fix: fail closed on unsafe html head placement"
git push origin codex/module-reconcile-20260723
```

---

### Task 11: Replace Pages static-generation textual insertion with one composite plan

**Files:**

- Modify: `src/build/production-build/static-generation.ts`
- Modify: `src/build/production-build/static-generation.test.ts`

**Interfaces:**

- Consumes: `applyHtmlHeadInsertionPlan` exactly once per Pages route.
- Preserves: App Router shells remain structurally generated and do not invoke the authored-document locator.
- Produces: stable source-free SSG failure detail when an authored map is invalid/late or a requested lane is unavailable.

- [ ] **Step 1: Add failing Pages matrix tests**

Cover omitted-head success; head-close and import-map lookalikes in comments/scripts/templates; absent map; one and multiple valid head/body maps; external, empty, unterminated, invalid-JSON, invalid-shape, and over-complex maps; a late-only map; maps interleaved with a classic/module/modulepreload consumer; an early empty valid map followed by a late mapping map; and a no-prefetch build with an after-body map. Assert exact composite ordering of fallback import map, preload links, client style, and later body runtime.

Instrument `buildImportMap` and assert it is called exactly once only for `absent`, never for valid-safe suppression, and never after a known lane/state rejection. Assert omitted head changes from the former failure to success, while a missing structural body close still fails independently. Assert App Router routes invoke the locator zero times.

- [ ] **Step 2: Run static-generation tests red**

Run:

```bash
deno test -A --no-lock src/build/production-build/static-generation.test.ts
```

Expected: FAIL because regex import-map detection, literal `</head>` insertion, and comment wrappers still drive Pages output.

- [ ] **Step 3: Implement the asynchronous placement plan**

Remove `hasImportMapScript` and the head branch of `injectBeforeClosingTag`. Call `applyHtmlHeadInsertionPlan(result.html, async (placement) => ...)` once. Before any async map build, require the end lane. For `authoredImportMapState.status === "absent"`, also require the import-map lane, then build exactly one escaped inline map fragment. For `valid`, suppress fallback only when `lastProcessingEndOffset` is no later than the first existing consumer, when present, and no later than the proven end offset. Reject `invalid`, unknown ordering, and late valid maps.

Return preload links plus basic client styles through `atEnd` without legacy HTML comments. Keep client runtime insertion before the structural body close as the separate existing concern. If the head operation rejects, throw the stable validation failure before writing any route artifact.

- [ ] **Step 4: Verify Pages and App Router behavior**

Run:

```bash
deno test -A --no-lock src/build/production-build/static-generation.test.ts src/build/production-build/client-runtime.test.ts
deno check --no-lock src/build/production-build/static-generation.ts
deno fmt --check src/build/production-build/static-generation.ts src/build/production-build/static-generation.test.ts
deno lint src/build/production-build/static-generation.ts src/build/production-build/static-generation.test.ts
```

Expected: Pages uses one parse/composite operation, fallback work is demand-driven, and App Router remains parser-free.

- [ ] **Step 5: Commit and push static-generation migration**

```bash
git add src/build/production-build/static-generation.ts src/build/production-build/static-generation.test.ts
git commit -m "fix: place static page head assets structurally"
git push origin codex/module-reconcile-20260723
```

---

### Task 12: Enforce UTF-8 at every Veryfront HTML output boundary

**Files:**

- Modify: `src/server/handlers/utils/content-types.ts`
- Modify: `src/server/handlers/utils/content-types.test.ts`
- Modify: `src/server/handlers/request/ssr/ssr-response-builder.test.ts`
- Modify: `src/server/handlers/request/static.handler.test.ts`
- Modify: `src/server/services/rsc/orchestrators/handler.test.ts`
- Modify: `src/server/services/rsc/orchestrators/page-handler.ts`
- Modify: `src/server/services/rsc/orchestrators/page-handler.test.ts`
- Modify: `src/build/production-build/static-generation.test.ts`
- Modify: `docs/guides/deploying.md`

**Interfaces:**

- Characterizes and preserves: exact HTML media type `text/html; charset=utf-8` for live and Veryfront-served static HTML.
- Characterizes and preserves: UTF-8 encoded generated artifact bytes.
- Centralizes: all framework-owned HTML content-type values on `HTTP_CONTENT_TYPES.HTML` without changing wire behavior.
- Preserves: authored encoding declarations and all source code units outside insertion without rewriting.

- [ ] **Step 1: Add transport and byte characterization tests**

For live full-document rendering and static-file serving, assert exact `content-type` rather than substring containment. Generate a static page containing multi-byte characters, read raw bytes, decode with fatal UTF-8, and compare to the generated string. Use malformed lexical-prescan fixtures containing modern and legacy encoding declarations; assert those declarations remain byte-for-byte present and framework import maps follow the proven charset/prelude boundary.

- [ ] **Step 2: Run and record the current green output baseline**

Run the exact changed test files plus:

```bash
deno test -A --no-lock src/server/handlers/utils/content-types.test.ts src/server/handlers/request/ssr/ssr-response-builder.test.ts src/server/handlers/request/static.handler.test.ts src/server/services/rsc/orchestrators/handler.test.ts src/server/services/rsc/orchestrators/page-handler.test.ts src/build/production-build/static-generation.test.ts
```

Expected: all characterization tests pass because the targeted handlers already emit explicit UTF-8 and Deno string writes encode as UTF-8. If any path fails, stop this refactor, record it as a confirmed behavior bug, keep the failing regression, and fix that path before continuing.

- [ ] **Step 3: Centralize the exact HTML content type and document external hosting**

Use the existing `HTTP_CONTENT_TYPES.HTML` value from `src/utils/constants/http.ts` as the authority for `text/html; charset=utf-8`. Reference it from the content-type extension map and the RSC page renderer; SSR and static serving must continue through the extension map rather than duplicate the literal. Ensure adapter string writes encode as UTF-8 and do not transcode authored declarations. Document that external static hosts must serve generated `.html` with the same explicit charset because the locator receives decoded strings and cannot reconstruct original transport bytes.

- [ ] **Step 4: Verify transport behavior**

Run:

```bash
deno test -A --no-lock src/server/handlers/utils/content-types.test.ts src/server/handlers/request/ssr/ssr-response-builder.test.ts src/server/handlers/request/static.handler.test.ts src/server/services/rsc/orchestrators/handler.test.ts src/server/services/rsc/orchestrators/page-handler.test.ts src/build/production-build/static-generation.test.ts
deno fmt --check src/server/handlers/utils/content-types.ts src/server/handlers/utils/content-types.test.ts src/server/handlers/request/ssr/ssr-response-builder.test.ts src/server/handlers/request/static.handler.test.ts src/server/services/rsc/orchestrators/handler.test.ts src/server/services/rsc/orchestrators/page-handler.ts src/server/services/rsc/orchestrators/page-handler.test.ts src/build/production-build/static-generation.test.ts docs/guides/deploying.md
deno lint src/server/handlers/utils/content-types.ts src/server/handlers/utils/content-types.test.ts src/server/handlers/request/ssr/ssr-response-builder.test.ts src/server/handlers/request/static.handler.test.ts src/server/services/rsc/orchestrators/handler.test.ts src/server/services/rsc/orchestrators/page-handler.ts src/server/services/rsc/orchestrators/page-handler.test.ts src/build/production-build/static-generation.test.ts
```

Expected: exact UTF-8 response headers and raw artifact byte tests remain green with no wire or artifact-byte change; only duplicated authority has been removed.

- [ ] **Step 5: Commit and push the output invariant**

```bash
git add src/server/handlers/utils/content-types.ts src/server/handlers/utils/content-types.test.ts src/server/handlers/request/ssr/ssr-response-builder.test.ts src/server/handlers/request/static.handler.test.ts src/server/services/rsc/orchestrators/handler.test.ts src/server/services/rsc/orchestrators/page-handler.ts src/server/services/rsc/orchestrators/page-handler.test.ts src/build/production-build/static-generation.test.ts docs/guides/deploying.md
git diff --cached --check
git commit -m "fix: require utf-8 html output transport"
git push origin codex/module-reconcile-20260723
```

### Task 13: Prove packed-artifact, strict-layout, compiled-binary, and browser boundaries

**Files:**

- Modify: `scripts/test/npm-install-smoke.sh`
- Create: `scripts/test/local-npm-registry.ts`
- Create: `scripts/test/local-npm-registry.test.ts`
- Modify: `scripts/build/npm-package-metadata.test.ts`
- Modify: `scripts/build/browser-safe-exports.mjs`
- Modify: `scripts/build/browser-safe-exports.test.ts`
- Modify: `tests/integration/compiled-binary-e2e.test.ts`
- Create: `scripts/build/html-parser-package-boundary.test.ts`
- Modify: `deno.json`

**Interfaces:**

- Produces: a loopback-only test registry CLI that serves exact local tarballs for `veryfront` and every co-versioned `@veryfront/*` dependency declared by the packed root, always rejects unknown first-party names/versions, and optionally proxies validated read-only scoped or unscoped third-party metadata to one fixed upstream registry without forwarding credentials.
- Produces: two isolated `npm --install-strategy=nested` applications, one whose package manifest names only the root tarball and one whose manifest names only the parser-extension tarball; neither test declares an extra package to make resolution pass.
- Produces: resolved browser source/artifact graph rejection for the exact head-boundary module identities and exact package identities `@veryfront/ext-parser-parse5`, `parse5`, and `entities`.
- Produces: an outside-workspace binary execution that renders omitted-head authored HTML through the production path.

- [ ] **Step 1: Add failing registry, packed-artifact, and exact-identity assertions**

In `local-npm-registry.test.ts`, start the server on `127.0.0.1:0` with synthetic scoped and unscoped tarballs. Assert encoded and unencoded scoped metadata requests return only the configured exact versions and loopback tarball URLs; tarball bytes, SHA-1/SHA-512 metadata, and content lengths are exact; unknown first-party package/version, mutation method, and traversal requests fail closed; duplicate package/version registration is rejected; and `close()` releases the listener.

Use a second loopback server as the configured upstream. Assert unregistered, syntactically valid unscoped and non-Veryfront scoped package metadata GET/HEAD requests are streamed from only that fixed origin with a timeout and response-size cap, while authorization, cookie, npm auth, and forwarding headers are stripped. Include `@deno/shim-deno` and `@types/node` shapes because the generated root graph contains scoped external packages. Reject upstream redirects outside the configured origin, non-registry paths, oversized responses, and all unknown `@veryfront/*` packages without proxying. Exercise the CLI readiness-file protocol in a subprocess and terminate it through the same signal path the smoke script uses. No unit test contacts the public registry.

Build root and extension tarballs, inspect their file lists and emitted JavaScript, and assert:

- root head output retains exactly the external `@veryfront/ext-parser-parse5/parser-only` import;
- root tarball contains no `extensions/ext-parser-parse5` subtree, runtime `parse5` specifier, or vendored parse5/entities implementation;
- extension tarball alone declares exact parse5 and imports parser-only successfully;
- built parser-only JavaScript has no runtime `veryfront` import; declaration-only contract references are allowed.

- [ ] **Step 2: Run the new boundary tests red**

Run:

```bash
deno task build:npm
deno test --config=scripts/test.deno.json --allow-net=127.0.0.1 --allow-read --allow-write --allow-run --allow-env scripts/test/local-npm-registry.test.ts scripts/build/html-parser-package-boundary.test.ts scripts/build/browser-safe-exports.test.ts scripts/build/npm-package-metadata.test.ts
deno task build:npm
bash scripts/test/npm-install-smoke.sh
VERYFRONT_BINARY_FRESH=1 deno test -A tests/integration/compiled-binary-e2e.test.ts
```

Expected: FAIL because the local registry helper, parser artifact assertions, strict nested layout, exact browser-graph classification, and binary fixture do not exist. The second clean `build:npm` is deliberately immediately before the smoke invocation; no smoke may consume stale output.

- [ ] **Step 3: Implement strict-layout and binary tests**

Implement `local-npm-registry.ts` with both an importable `startLocalNpmRegistry(...)` API and a CLI that accepts repeated `--package-json <generated-package.json> --tarball <packed.tgz>` pairs, one optional fixed `--upstream-registry`, and `--ready-file`. Do not build a partial tar parser: validate the declared package name/version and exact tarball path up front, compute the SHA-1 and SHA-512 metadata npm consumes, reject duplicate names/versions and non-file/path-traversal inputs, and let the separate artifact test unpack and inspect contents. The server must bind only loopback on an ephemeral port, atomically publish the URL, serve exact npm-compatible metadata and tarball endpoints, record bounded request diagnostics, enforce the read-only/credential-stripping/bounded upstream policy above, and remove its readiness file during shutdown.

The Bash smoke registers the packed root plus every exact co-versioned first-party dependency, starts the helper with fixed upstream `https://registry.npmjs.org/` and Deno network permission restricted to loopback plus that host, waits at most 10 seconds for readiness, configures the temporary app's default registry to the loopback URL, and always terminates the helper from `trap`. This lets npm auto-resolve the unscoped `veryfront` peer from the exact local tarball while external packages such as parse5 resolve through the fixed upstream metadata path.

Add a root task `test:scripts:html-parser-boundary` that runs `scripts/test/local-npm-registry.test.ts` and `scripts/build/html-parser-package-boundary.test.ts` with frozen resolution and only the required read/write/run/environment plus `--allow-net=127.0.0.1` permissions. Chain that task from `test:scripts` so the normal script portfolio cannot omit the tests without granting network permission to every unrelated script test.

Pack the root and every exact co-versioned `@veryfront/*` dependency named by its generated metadata, and register all of those tarballs. In a fresh root-only app, pass only `veryfront-<version>.tgz` to `npm install --ignore-scripts --strict-peer-deps --install-strategy=nested --no-audit --no-fund`; do not list extension tarballs in that app's manifest or install command. Under Node 18.18.0, import the emitted `veryfront/esm/src/html/head-boundary.js` and assert Node resolves `@veryfront/ext-parser-parse5/parser-only` from `node_modules/veryfront/node_modules/@veryfront/ext-parser-parse5`, with no top-level parser extension created by the fixture.

In a separate extension-only app, pass only the parser-extension tarball with the same strict flags. Assert the app manifest declares only that tarball, npm installs the exact packed root solely to satisfy the required `veryfront` peer, parse5 resolves beneath the extension, and importing parser-only neither evaluates the root runtime nor reaches sibling workspace source. Do not use `--legacy-peer-deps`, `--omit=peer`, or a second application dependency to bypass the published peer contract.

Compile a fresh binary, copy it outside the workspace, launch it against an omitted-head authored page, and assert parser-backed head placement in the response. An include-list assertion alone is not sufficient.

- [ ] **Step 4: Implement exact resolved browser-graph tests**

For every `BROWSER_SAFE_EXPORTS` entry plus `index.client` and `react/public`, generate a bundler metafile or equivalent resolved graph from source and built npm artifacts. Classify each resolved dependency by normalized repository module ID and, for packages, by the nearest package manifest or resolver-supplied package identity. Reject exact module IDs `src/html/head-boundary.ts` and `src/html/head-boundary.js`, exact package/subpath identities rooted at `@veryfront/ext-parser-parse5`, and exact package names `parse5` and `entities`. Add fixtures proving unrelated packages such as `character-entities`, `parse-entities`, and `stringify-entities` do not match. Maintained substring allowlists and `path.includes("entities")` are not acceptable evidence.

- [ ] **Step 5: Verify all artifact boundaries green from fresh output**

Run:

```bash
deno task build:npm
deno test --config=scripts/test.deno.json --frozen --allow-net=127.0.0.1 --allow-read --allow-write --allow-run --allow-env scripts/test/local-npm-registry.test.ts scripts/build/html-parser-package-boundary.test.ts scripts/build/browser-safe-exports.test.ts scripts/build/npm-package-metadata.test.ts
deno task build:npm
bash scripts/test/npm-install-smoke.sh
VERYFRONT_BINARY_FRESH=1 deno test -A tests/integration/compiled-binary-e2e.test.ts
```

Run the complete block twice. Expected: both runs exit 0, registry request logs show only exact local first-party resolutions, the smoke always follows a fresh npm build directly, and full tarball lists/resolved paths prove strict nested ownership. Update DNT, package exports, smoke layout, binary fixture, or graph generation only until those assertions pass; never inline or vendor the parser into core to satisfy installation.

- [ ] **Step 6: Commit and push artifact-boundary gates**

```bash
git add scripts/test/npm-install-smoke.sh scripts/test/local-npm-registry.ts scripts/test/local-npm-registry.test.ts scripts/build/npm-package-metadata.test.ts scripts/build/browser-safe-exports.mjs scripts/build/browser-safe-exports.test.ts scripts/build/html-parser-package-boundary.test.ts tests/integration/compiled-binary-e2e.test.ts deno.json
git commit -m "test: enforce html parser package isolation"
git push origin codex/module-reconcile-20260723
```

---

### Task 14: Add deterministic performance, resource, and publication gates

**Files:**

- Create: `extensions/ext-parser-parse5/bench/head-locator.bench.ts`
- Create: `extensions/ext-parser-parse5/src/admission-subprocess.test.ts`
- Create: `scripts/ci/verify-html-parser-extension.sh`
- Create: `scripts/ci/verify-html-parser-package-boundary.sh`
- Create: `scripts/ci/verify-html-parser-workflow.test.ts`
- Modify: `scripts/test.deno.json`
- Modify: `scripts/deno.lock`
- Modify: `deno.json`
- Modify: `.github/workflows/cicd.yml`

**Interfaces:**

- Produces: reproducible benchmark rows for 4 KiB, 256 KiB, 2 MiB, and 8 MiB explicit, implicit, template, and foreign-content documents.
- Produces: exact root tasks `verify:html-parser` and `verify:html-parser-packaging`, implemented by separate extension/resource and prepublication package-boundary scripts.
- Produces: exact CI job IDs `tests-html-parser-extension` and `tests-html-parser-package-boundary`; both are required by `prerelease.needs` and `release.needs` and are protected by a parsed-workflow graph test.
- Produces: subprocess CPU/RSS evidence for exact-limit and first-over adversarial fixtures.

- [ ] **Step 1: Write failing benchmark, subprocess, script, and workflow contracts**

The benchmark performs 10 warmups and 30 measured samples through 2 MiB; at 8 MiB it performs 5 warmups and 10 samples. Compare median `applyHtmlHeadInsertions` time with direct parse5 parse using identical parser options. Assert at most `1.35 * parseMedian + 0.25 ms` through 2 MiB and `1.5 * parseMedian + 2 ms` at 8 MiB on safe one-parse fixtures. Separately record and assert parse counts no greater than initial parse plus one probe per distinct lane candidate.

Run single-tag attribute, tag-dense, deep-tree, nested-template, foster-parenting, adoption-agency, dense-marker-prefix, marker-slot 1,023/1,024, flat-many-key, deeply nested JSON, duplicate-key, and many-map fixtures in subprocesses. Record elapsed CPU and peak RSS; exact-limit exits 0 and first-over deterministically reports its contract rejection without timeout or unbounded growth.

Create both shell scripts in their final fail-fast shape before invoking either one. `verify-html-parser-extension.sh` owns frozen extension check/lint/format/tests, locator conformance, the syntax-aware parser-edge audit, admission subprocesses, and benchmark threshold mode. `verify-html-parser-package-boundary.sh` owns metadata/DNT/SBOM/browser/artifact tests, then runs `deno task build:npm` on the line immediately before `bash scripts/test/npm-install-smoke.sh`, followed by the fresh outside-workspace binary test. Neither script invokes the false-green general core-dependency audit as dependency evidence.

Both scripts start with `set -euo pipefail`. The extension script runs these exact gates:

```bash
deno task lint:parser-extension-boundary
deno task test:scripts:parser-extension-boundary
deno check --config=extensions/ext-parser-parse5/deno.json --frozen extensions/ext-parser-parse5/src/index.ts extensions/ext-parser-parse5/src/parser-only.ts extensions/ext-parser-parse5/src/*.test.ts
deno fmt --check src/extensions/parser extensions/ext-parser-parse5
deno lint --config=extensions/ext-parser-parse5/deno.json extensions/ext-parser-parse5/src extensions/ext-parser-parse5/bench
deno test --config=extensions/ext-parser-parse5/deno.json --frozen -A extensions/ext-parser-parse5/src/*.test.ts
deno test -A --frozen src/extensions/parser/html-head-locator.test.ts src/extensions/parser/html-head-locator-conformance.test.ts
deno bench --config=extensions/ext-parser-parse5/deno.json --frozen -A extensions/ext-parser-parse5/bench/head-locator.bench.ts -- --assert-thresholds
deno test --config=scripts/test.deno.json --frozen --allow-read scripts/ci/verify-html-parser-workflow.test.ts
```

The package-boundary script runs:

```bash
deno task build:npm
deno test --config=scripts/test.deno.json --frozen --allow-net=127.0.0.1 --allow-read --allow-write --allow-run --allow-env scripts/test/local-npm-registry.test.ts scripts/build/html-parser-package-boundary.test.ts scripts/build/browser-safe-exports.test.ts scripts/build/npm-package-metadata.test.ts scripts/build/npm-extension-package-metadata.test.ts scripts/build/compile-binary.test.ts scripts/build/generate-sbom.test.ts
deno task lint:dependency-boundaries
deno task build:npm
bash scripts/test/npm-install-smoke.sh
VERYFRONT_BINARY_FRESH=1 deno test -A --frozen --filter="compiled binary places framework assets in an omitted authored head" tests/integration/compiled-binary-e2e.test.ts
```

The second `build:npm` is intentionally adjacent to the smoke invocation. Run this script only with Node 18.18.0 on `PATH`, matching the smoke's enforced minimum-runtime contract.

In `verify-html-parser-workflow.test.ts`, parse `.github/workflows/cicd.yml` through tooling-only alias `#std/yaml`, mapped exactly to `jsr:@std/yaml@1.1.0/parse` in `scripts/test.deno.json` during this red-test step. Assert both exact job IDs exist, neither is `continue-on-error`, each invokes its matching exact root task with the standard setup actions, the package job retains Node 18.18.0, and both appear in both publication jobs' `needs` arrays. Reject string/comment matches that are not YAML job edges. Do not update `scripts/deno.lock` until Step 3, so Step 2 intentionally runs this one test without `--frozen`.

- [ ] **Step 2: Run the new gates red**

Run:

```bash
deno test -A --no-lock extensions/ext-parser-parse5/src/admission-subprocess.test.ts
deno bench -A --no-lock extensions/ext-parser-parse5/bench/head-locator.bench.ts
deno test --config=scripts/test.deno.json --no-lock --allow-read scripts/ci/verify-html-parser-workflow.test.ts
bash scripts/ci/verify-html-parser-extension.sh
bash scripts/ci/verify-html-parser-package-boundary.sh
```

Expected: FAIL until resource instrumentation, exact tasks, and both YAML job/publication edges are wired. The scripts already exist at this point, so the red run cannot be an accidental “file not found” result.

- [ ] **Step 3: Implement exact verification tasks and publication dependencies**

With the exact tooling-only `#std/yaml` mapping from Step 1 and Deno 2.7.7, run `deno install --config=scripts/test.deno.json --lockfile-only`, inspect `scripts/deno.lock`, and prove the alias imports under the frozen scripts config. Do not rerun the workflow assertions until after implementing the jobs and task edges they require. No root production manifest or lock owns this test-only parser.

```bash
deno --version | head -n 1 | rg -q '^deno 2\.7\.7 '
deno install --config=scripts/test.deno.json --lockfile-only
git diff -- scripts/deno.lock
deno eval --config=scripts/test.deno.json --frozen 'import "#std/yaml";'
```

Add `verify:html-parser` and `verify:html-parser-packaging` to `deno.json` as exact entry points to the two scripts, and add `scripts/ci/verify-html-parser-workflow.test.ts` to `test:scripts`. Add CI job `tests-html-parser-extension` running `deno task verify:html-parser`. Rename the existing `tests-npm-install-smoke` job ID to `tests-html-parser-package-boundary`, preserve its visible job name initially for branch-protection continuity, retain its Node 24 consumer checks and Node 18.18.0 minimum-runtime setup, and replace its final direct smoke command with `deno task verify:html-parser-packaging`. Add both new IDs to both `prerelease.needs` and `release.needs`, remove the old job ID there, and do not reuse an unrelated job as an undocumented proxy.

Now run the structural workflow assertion with frozen resolution:

```bash
deno test --config=scripts/test.deno.json --frozen --allow-read scripts/ci/verify-html-parser-workflow.test.ts
```

The scripts run extension `deno check` on both entries and all tests without `--no-check`, `deno fmt --check`, `deno lint`, conformance, focused tests, the dedicated parser-extension boundary audit, dependency/DNT/SBOM/browser/package-boundary tests, and benchmark threshold mode under a frozen lock. Add `#std/yaml` only to `scripts/test.deno.json`; it is non-production verification tooling and must not appear in root production imports or generated package metadata.

- [ ] **Step 4: Verify deterministic resource and CI behavior**

Run all commands from Step 2 twice. Expected: both runs exit 0, produce the same admission decisions and parse counts, and remain within the documented thresholds.

- [ ] **Step 5: Commit and push performance/publication gates**

```bash
git add extensions/ext-parser-parse5/bench/head-locator.bench.ts extensions/ext-parser-parse5/src/admission-subprocess.test.ts scripts/ci/verify-html-parser-extension.sh scripts/ci/verify-html-parser-package-boundary.sh scripts/ci/verify-html-parser-workflow.test.ts scripts/test.deno.json scripts/deno.lock deno.json .github/workflows/cicd.yml
git commit -m "ci: gate html parser performance and packaging"
git push origin codex/module-reconcile-20260723
```

---

### Task 15: Update public documentation, migration guidance, generated references, and the hardening ledger

**Files:**

- Modify: `src/html/README.md`
- Modify: `extensions/README.md`
- Modify: `docs/guides/index.md`
- Modify: `docs/guides/extensions.md`
- Modify: `docs/architecture/12-extension-system.md`
- Modify: `docs/architecture/20-support-matrix.md`
- Create: `docs/guides/html-head-placement.md`
- Create: `CHANGELOG.md`
- Modify: `docs/api-reference/veryfront/extensions.md` through the repository generator
- Modify: `tests/docs/guide-contracts.test.ts`
- Modify: `tests/docs/guide-code-examples.test.ts`
- Modify: `.github/MODULE-HARDENING.md`

**Interfaces:**

- Documents: standards-compatible placement, omitted-head support, exact source preservation outside insertions, fail-closed production behavior, 8 MiB admission, UTF-8 transport, parser extension ownership, and the legacy helper's post-transformation/no-head-insertion rejection shape without mixing documentation modes.
- Records: exact focused/broad verification evidence and any residual risk without claiming absolute bug-freedom.

- [ ] **Step 1: Write the migration and support text**

Keep each public document in one Diátaxis mode:

- `docs/guides/html-head-placement.md` and the relevant section of `docs/guides/extensions.md` are goal-oriented how-to guidance for adapting authored documents, handling the 8 MiB/unsafe-placement failures, and configuring external hosts for UTF-8.
- `docs/guides/html-head-placement.md` has frontmatter with nonempty `title`, nonempty `description`, and the currently available unique integer `order: 46`, plus exact section `## Verify it worked` containing observable success checks.
- `docs/guides/index.md` links the new how-to under the existing build/deploy/extend goals. Add the exact guide entry to `GUIDE_CONTRACTS`, asserting its canonical API references, required snippets, and `## Verify it worked` heading; every executable fenced snippet is covered by `guide-code-examples.test.ts`, or use non-executable prose when no runnable contract exists.
- `docs/architecture/12-extension-system.md` is explanation: why the first-party parser extension owns parse5 and why core has one non-overridable parser-only edge.
- `docs/architecture/20-support-matrix.md`, generated API output, and extension catalog entries are neutral reference facts.
- `CHANGELOG.md` is a concise compatibility/migration notice, not a tutorial or architecture essay.
- READMEs retain only a short overview and links to the canonical how-to, explanation, and reference documents.

State that `@veryfront/ext-parser-parse5` is a required co-versioned server dependency supplied by the standard distribution, while parse5 itself never becomes a core dependency. Define “exact source preservation” narrowly and accurately as preservation of every decoded JavaScript UTF-16 code unit outside inserted fragments; it does not reconstruct or claim preservation of original transport bytes that were already decoded. Document that missing parser packaging is an installation failure, not a silent fallback.

- [ ] **Step 2: Regenerate and validate references**

Run:

```bash
deno task docs
deno task docs:validate
deno task generate:manifests:check
deno test --no-check --allow-read tests/docs/guide-contracts.test.ts
deno test --no-check --allow-all tests/docs/guide-code-examples.test.ts
```

Expected: generated extension API/catalog references include `HTMLHeadLocator` and no stale scanner claim remains.

- [ ] **Step 3: Run the full affected verification portfolio**

Run:

```bash
deno task verify:html-parser
deno task verify:html-parser-packaging
deno task verify:quick
deno task test:scripts
deno task lint:parser-extension-boundary
deno task lint:dependency-boundaries
deno task lint:module-boundaries
deno test -A --frozen src/extensions/parser extensions/ext-parser-parse5/src src/html src/rendering/orchestrator/html.test.ts src/rendering/script-page-handling.test.ts src/build/production-build/static-generation.test.ts src/server/handlers/request/static.handler.test.ts
deno task verify
```

Run `verify:html-parser-packaging` with Node 18.18.0 on `PATH`; its script owns both clean npm builds, the immediately following smoke, and the fresh binary fixture. Expected: all commands exit 0. `verify:html-parser` and `verify:html-parser-packaging` are the exact publication gates added in Task 14. The broad `verify` run is regression evidence only: because its existing `lint:core-deps` subtask currently scans zero production files, its green result cannot be cited as proof of the dependency-free-core rule. Retain complete output for both exact parser gates and the broad run in the SDD report.

- [ ] **Step 4: Update the hardening ledger with evidence**

Record the parser boundary, dependency ownership, test counts, packaging paths, benchmark thresholds, and consumer failure behavior. Explicitly supersede/reopen both the current HTML closure and the current Studio closure; do not merely append a residual note beneath their closed claims.

Add two required acceptance-gated follow-ups:

- `src/html/nonce-injection.ts` must preserve HTML script-tokenizer state across every relevant UTF-8/chunk split, including script data, escaped, double-escaped, end-tag-open/name, comment-like, and multi-byte boundaries, without treating script text as markup. Exhaustive split-position tests plus live SSR stream consumer tests are required before HTML can close.
- `src/studio/element-selector-injector.ts` must handle escaped and double-escaped script states without injecting selectors into script text or lookalike markup, while preserving every source code unit outside intended attribute insertions. Adversarial tokenizer fixtures and production Studio render-path tests are required before Studio can close.

This parser work removes the old head scanner's false authority but does not validate either independent rewriter. Revalidate every ledger unit touched by the implementation, and do not mark Rendering, Build, Server, Extensions, or Security closed solely from focused parser tests either.

- [ ] **Step 5: Commit and push documentation and ledger evidence**

```bash
git add src/html/README.md extensions/README.md docs/guides/index.md docs/guides/extensions.md docs/architecture/12-extension-system.md docs/architecture/20-support-matrix.md docs/guides/html-head-placement.md CHANGELOG.md docs/api-reference/veryfront/extensions.md tests/docs/guide-contracts.test.ts tests/docs/guide-code-examples.test.ts .github/MODULE-HARDENING.md
git diff --cached --check
git commit -m "docs: document structural html head placement"
git push origin codex/module-reconcile-20260723
```
