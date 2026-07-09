#!/usr/bin/env -S deno run --allow-read
/**
 * Ratchets for the `veryfront/chat` composition overhaul (plan E0).
 *
 * Three anti-patterns, each seeded with today's count as a baseline that may
 * only shrink — the same shape as `check-skipped-tests-baseline`. New violations
 * fail the build; burning one down prints the new total so the baseline can be
 * lowered to lock the win in. Targets drop to 0 as the overhaul lands
 * (feature toggles → E8, passthrough props → E9, forwardRef → E2).
 *
 *   1. forwardRef        — React 19 makes `ref` a regular prop; `forwardRef` is
 *                          legacy ceremony (plan §G2/E2).
 *   2. feature toggles   — `show* / enable* / hide*` boolean props customize
 *                          behaviour with flags instead of composition
 *                          (composition-patterns §1.1; plan §B/E8).
 *   3. passthrough props — `*ClassName` bags, `icons={{}}` maps, `dragProps`
 *                          leak styling/structure through the parent instead of
 *                          per-sub-component slots (plan §E/E9).
 *
 * Scope: chat component source only (`src/react/components/chat`), excluding
 * tests and stories.
 */

const SCAN_ROOT = "src/react/components/chat";

// Lower each baseline when you burn violations down. Raising one means a new
// anti-pattern is being added — compose instead.
// E2 complete: chat no longer uses forwardRef (React 19 `ref` prop). Locked at 0.
export const FORWARDREF_BASELINE = 0;
export const FEATURE_TOGGLE_BASELINE = 29;
export const PASSTHROUGH_BASELINE = 14;

/** `forwardRef` / `React.forwardRef` call sites. */
const FORWARDREF_RE = /\bforwardRef\s*[(<]/g;
/** `show* / enable* / hide*` props typed `boolean` (prop declarations). */
const FEATURE_TOGGLE_RE = /\b(?:show|enable|hide)[A-Z][A-Za-z]*\??:\s*boolean\b/g;
/** `*ClassName` bag props, `icons` bag props, `dragProps`. */
const PASSTHROUGH_RE =
  /(?:^|\s)(?:[a-z][A-Za-z]*ClassName|icons|dragProps)\??:\s/gm;

/** Strip comments + string/template literals so they can't trigger matches. */
function stripCommentsAndStrings(text: string): string {
  let out = text.replace(/\/\*[\s\S]*?\*\//g, "");
  out = out.replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  out = out.replace(/`(?:\\.|[^`])*`/gs, "``");
  out = out.replace(/'(?:\\.|[^'\n])*'/g, "''");
  out = out.replace(/"(?:\\.|[^"\n])*"/g, '""');
  return out;
}

export interface AntipatternCounts {
  forwardRef: number;
  featureToggle: number;
  passthrough: number;
}

export function countAntipatterns(source: string): AntipatternCounts {
  const s = stripCommentsAndStrings(source);
  return {
    forwardRef: s.match(FORWARDREF_RE)?.length ?? 0,
    featureToggle: s.match(FEATURE_TOGGLE_RE)?.length ?? 0,
    passthrough: s.match(PASSTHROUGH_RE)?.length ?? 0,
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

// Per-file LOC ceilings (§0.9 / F-1 "God components"). A file may only shrink
// past its ceiling — lower the number when you split one up. Presentation+logic
// fused in one file is the structural reason the acid test fails; this stops the
// big files from growing back.
const FILE_SIZE_CEILINGS: Record<string, number> = {
  "src/react/components/chat/chat/index.tsx": 371,
  "src/react/components/chat/chat/composition/message.tsx": 978,
  "src/react/components/chat/chat/components/sidebar.tsx": 630,
  "src/react/components/chat/chat/composition/chat-composer.tsx": 650,
  "src/react/components/chat/agent-picker.tsx": 520,
  "src/react/components/chat/chat-actions.tsx": 515,
  "src/react/components/chat/chat/controlled-chat.tsx": 329,
  "src/react/components/chat/chat/app-mode-chat.tsx": 274,
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
    hint: "React 19: take `ref` as a regular prop instead of wrapping in forwardRef",
  },
  {
    label: "feature-toggle booleans",
    key: "featureToggle",
    baseline: FEATURE_TOGGLE_BASELINE,
    hint: "replace show*/enable*/hide* flags with composition or explicit variants",
  },
  {
    label: "passthrough props",
    key: "passthrough",
    baseline: PASSTHROUGH_BASELINE,
    hint: "expose styling/icons per sub-component instead of *ClassName / icons={{}} bags",
  },
];

async function main(): Promise<void> {
  const totals: AntipatternCounts = {
    forwardRef: 0,
    featureToggle: 0,
    passthrough: 0,
  };
  await walk(SCAN_ROOT, async (path) => {
    const c = countAntipatterns(await Deno.readTextFile(path));
    totals.forwardRef += c.forwardRef;
    totals.featureToggle += c.featureToggle;
    totals.passthrough += c.passthrough;
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
