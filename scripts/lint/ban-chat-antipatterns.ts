#!/usr/bin/env -S deno run --allow-read
/**
 * Structural ratchets for the current `veryfront/chat` composition contract.
 *
 * New violations fail the build. When a non-zero baseline shrinks, lower it in
 * the same change to lock the improvement in.
 *
 *   1. forwardRef        — React 19 accepts `ref` as a regular prop.
 *   2. feature toggles   — `show* / enable* / hide*` booleans select structure
 *                          instead of letting callers compose it.
 *   3. passthrough props — `*ClassName` bags, `icons={{}}` maps, and `dragProps`
 *                          leak leaf styling through a parent component.
 *   4. inline context    — inline provider objects change identity on every
 *                          render.
 *
 * Scope: chat component source only (`src/react/components/chat`), excluding
 * tests and stories.
 *
 * Where the rules come from: these are RFC 29's hard rules, mechanised.
 * See veryfront/veryfront-issue-inbox#739 — rule 1 ("No `xxxClassName` /
 * `xxxProps` bags. Ever."), rule 7 ("Style state via `data-*`, not props"),
 * the resolved decision banning `icon` slot props, and "React 19: ref as a
 * prop". Change a baseline here only alongside the tracked design decision.
 */

import { stripCommentsAndStrings } from "./ratchet.ts";

const SCAN_ROOT = "src/react/components/chat";

// Lower each baseline when you burn violations down. Raising one means a new
// anti-pattern is being added — compose instead.
// Chat uses the React 19 `ref` prop directly. Locked at 0.
export const FORWARDREF_BASELINE = 0;
export const FEATURE_TOGGLE_BASELINE = 0;
export const PASSTHROUGH_BASELINE = 0;
// Provider values must have stable identities. Locked at 0.
export const INLINE_CONTEXT_BASELINE = 0;

/** `forwardRef` / `React.forwardRef` call sites. */
const FORWARDREF_RE = /\bforwardRef\s*[(<]/g;
/** `show* / enable* / hide*` props typed `boolean` (prop declarations). */
const FEATURE_TOGGLE_RE =
  /\b(?:show|enable|hide)[A-Z][A-Za-z]*\??:\s*boolean\b/g;
/** `*ClassName` bag props, `icons` bag props, `dragProps`. */
const PASSTHROUGH_RE =
  /(?:^|\s)(?:[a-z][A-Za-z]*ClassName|icons|dragProps)\??:\s/gm;
/** Inline `Provider value={{…}}` — a fresh object every render (F-3). */
const INLINE_CONTEXT_RE = /\.Provider\s+value=\{\{/g;

export interface AntipatternCounts {
  forwardRef: number;
  featureToggle: number;
  passthrough: number;
  inlineContext: number;
}

export function countAntipatterns(source: string): AntipatternCounts {
  const s = stripCommentsAndStrings(source);
  return {
    forwardRef: s.match(FORWARDREF_RE)?.length ?? 0,
    featureToggle: s.match(FEATURE_TOGGLE_RE)?.length ?? 0,
    passthrough: s.match(PASSTHROUGH_RE)?.length ?? 0,
    inlineContext: s.match(INLINE_CONTEXT_RE)?.length ?? 0,
  };
}

function isSource(path: string): boolean {
  if (!path.endsWith(".ts") && !path.endsWith(".tsx")) return false;
  if (path.endsWith(".test.ts") || path.endsWith(".test.tsx")) return false;
  if (path.endsWith(".stories.tsx")) return false;
  return true;
}

async function walk(
  dir: string,
  onFile: (path: string) => Promise<void>,
): Promise<void> {
  let entries: AsyncIterable<Deno.DirEntry>;
  try {
    entries = Deno.readDir(dir);
  } catch (_) {
    return;
  }
  for await (const ent of entries) {
    if (ent.name === "node_modules") continue;
    const full = `${dir}/${ent.name}`;
    if (ent.isDirectory) await walk(full, onFile);
    else if (ent.isFile && isSource(full)) await onFile(full);
  }
}

// Per-file LOC ceilings keep large chat components from growing further. Lower
// a ceiling when its file shrinks so the improvement cannot silently regress.
const FILE_SIZE_CEILINGS: Record<string, number> = {
  // Chat preset implementation lives in chat/chat-preset.tsx. This barrel grew
  // only for the explicit conversation-persistence contracts exported here.
  "src/react/components/chat/chat/index.tsx": 279,
  // Message.Sources extracted to composition/message-sources.tsx.
  "src/react/components/chat/chat/composition/message.tsx": 793,
  // Includes the ChatSidebar.Item compound (Item.Title/.Menu/.Rename/.Delete).
  // Split responsibilities before adding more behavior to this file.
  "src/react/components/chat/chat/components/sidebar.tsx": 685,
  // Composer state and native action leaves live in focused sibling modules.
  "src/react/components/chat/chat/composition/chat-composer.tsx": 389,
  "src/react/components/chat/chat/composition/chat-input-actions.tsx": 159,
  "src/react/components/chat/agent-picker.tsx": 429,
  "src/react/components/chat/chat-actions.tsx": 203,
  "src/react/components/chat/chat/controlled-chat.tsx": 242,
  "src/react/components/chat/chat/app-mode-chat.tsx": 177,
  // Chat core: message construction and provider-conversion, split along its
  // real seams (part-field-access, message-part-parsing, tool-replay
  // reconciliation). Not React components, so this map does not subject them
  // to the antipattern ratchets above — it only pins their size.
  "src/chat/conversation.ts": 557,
  "src/chat/message-prep.ts": 2016,
  "src/chat/tool-replay-reconciliation.ts": 291,
  "src/chat/message-part-parsing.ts": 264,
  "src/chat/part-field-access.ts": 65,
  "src/chat/provider-input-types.ts": 34,
  "src/chat/provider-message-conversion.ts": 447,
};

function checkFileSizes(): boolean {
  let failed = false;
  for (const [path, ceiling] of Object.entries(FILE_SIZE_CEILINGS)) {
    let loc: number;
    try {
      // Count newlines (matches `wc -l`).
      loc = (Deno.readTextFileSync(path).match(/\n/g) ?? []).length;
    } catch (_) {
      continue; // file moved/renamed — will surface via other gates
    }
    if (loc > ceiling) {
      failed = true;
      console.error(
        `✖ ${path}: ${loc} LOC exceeds ceiling ${ceiling} — split it, don't grow it.`,
      );
    } else if (loc < ceiling) {
      console.log(
        `✓ ${path}: ${loc} LOC (ceiling ${ceiling}). Lower the ceiling to lock it in.`,
      );
    }
  }
  return !failed;
}

interface Ratchet {
  label: string;
  key: keyof AntipatternCounts;
  baseline: number;
  hint: string;
}

const RATCHETS: Ratchet[] = [
  {
    label: "forwardRef",
    key: "forwardRef",
    baseline: FORWARDREF_BASELINE,
    hint:
      "React 19: take `ref` as a regular prop instead of wrapping in forwardRef",
  },
  {
    label: "feature-toggle booleans",
    key: "featureToggle",
    baseline: FEATURE_TOGGLE_BASELINE,
    hint:
      "replace show*/enable*/hide* flags with composition or explicit variants",
  },
  {
    label: "passthrough props",
    key: "passthrough",
    baseline: PASSTHROUGH_BASELINE,
    hint:
      "expose styling/icons per sub-component instead of *ClassName / icons={{}} bags",
  },
  {
    label: "inline context values",
    key: "inlineContext",
    baseline: INLINE_CONTEXT_BASELINE,
    hint:
      "memoize the context value (useMemo): inline value={{...}} re-renders all consumers",
  },
];

async function main(): Promise<void> {
  const totals: AntipatternCounts = {
    forwardRef: 0,
    featureToggle: 0,
    passthrough: 0,
    inlineContext: 0,
  };
  await walk(SCAN_ROOT, async (path) => {
    const c = countAntipatterns(await Deno.readTextFile(path));
    totals.forwardRef += c.forwardRef;
    totals.featureToggle += c.featureToggle;
    totals.passthrough += c.passthrough;
    totals.inlineContext += c.inlineContext;
  });

  let failed = false;
  for (const r of RATCHETS) {
    const count = totals[r.key];
    if (count > r.baseline) {
      failed = true;
      console.error(
        `✖ chat ${r.label}: ${count} exceeds baseline ${r.baseline} — ${r.hint}.`,
      );
    } else if (count < r.baseline) {
      console.log(
        `✓ chat ${r.label}: reduced to ${count} (baseline ${r.baseline}). ` +
          `Lower the baseline in ban-chat-antipatterns.ts to lock it in.`,
      );
    } else {
      console.log(`✓ chat ${r.label}: ${count}/${r.baseline}.`);
    }
  }

  if (!checkFileSizes()) failed = true;

  if (failed) Deno.exit(1);
}

if (import.meta.main) {
  await main();
}
