/**
 * `veryfront/ui` COVERAGE MANIFEST — the deterministic "to spec" gate.
 *
 * This suite is intentionally RED until the library is complete. Each component
 * in `UI_COMPONENTS` must, to be "to spec":
 *   1. be exported from `veryfront/ui`
 *   2. have a Storybook story (`storybook/stories/ui/<Name>.stories.tsx`)
 *   3. be documented **in its component** — its Storybook story carries a
 *      `DocsPage` (`DocsHero` + `DocsPropsTable`), colocated with the code. The
 *      root guide (`docs/guides/ui-components.md`) is a thin overview that LINKS
 *      to Storybook; it must never become a per-component / per-variant catalog
 *      (enforced by the guardrail test at the bottom of this file).
 *   4. have a test — its name referenced by some `*.test.tsx` under `ui/` (its own
 *      conformance test or the shared conformance/characterization suite)
 *   5. document every prop with JSDoc — each field of its `*Props` interface(s)
 *      carries a JSDoc comment (the `DocsPropsTable` and IDE hovers read these)
 *   6. if interactive, be covered by the adapter contract (a key on the builtin
 *      adapter) so it can be swapped to Base UI / Radix / React Aria / Ariakit
 *
 * And every `cva` variant must be demonstrated in the component's own story.
 *
 * `status: "planned"` rows are gaps we are building toward — their `exists` check
 * fails until the primitive lands. Flip to `"shipped"` when you add it.
 *
 * Per-component behaviour (one-node / forwardRef / asChild / className merge /
 * `{...props}` spread) is proven in each primitive's own `*.test.tsx` and the
 * shared conformance harness; this file is the cross-cutting inventory gate.
 *
 * DOCS PRINCIPLE (do not regress): component docs live IN THE COMPONENT (its
 * story's `DocsPage` + source JSDoc). Never satisfy a docs/variant gate by
 * dumping names or variant tables into the root markdown guide.
 */
import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import * as ui from "veryfront/ui";
import { builtinAdapter } from "./adapter/builtin/index.ts";
import { Badge } from "./badge.tsx";
import { Button } from "./button.tsx";
import { Card } from "./card.tsx";
import { Input } from "./input.tsx";

const STORIES_DIR = new URL("../../../../storybook/stories/ui/", import.meta.url).pathname;
const UI_GUIDE = new URL("../../../../docs/guides/ui-components.md", import.meta.url).pathname;

type Kind = "visual" | "form" | "overlay" | "structure";
interface UiComponent {
  /** Top-level export name. */
  name: string;
  kind: Kind;
  /** Needs behavioural mechanics → must be adapter-covered. */
  interactive: boolean;
  /** Adapter key on `UIAdapter`, if adapter-routed today. */
  adapterKey?: keyof typeof builtinAdapter;
  status: "shipped" | "planned";
}

/** The target surface — shipped + planned. Add rows as the survey warrants. */
export const UI_COMPONENTS: UiComponent[] = [
  // visual / layout
  { name: "Button", kind: "visual", interactive: false, status: "shipped" },
  { name: "IconButton", kind: "visual", interactive: false, status: "shipped" },
  { name: "Card", kind: "visual", interactive: false, status: "shipped" },
  { name: "Badge", kind: "visual", interactive: false, status: "shipped" },
  { name: "Pill", kind: "visual", interactive: false, status: "shipped" },
  { name: "Tag", kind: "visual", interactive: false, status: "shipped" },
  { name: "Avatar", kind: "visual", interactive: false, status: "shipped" },
  { name: "Alert", kind: "visual", interactive: false, status: "shipped" },
  { name: "Status", kind: "visual", interactive: false, status: "shipped" },
  { name: "List", kind: "visual", interactive: false, status: "shipped" },
  { name: "Skeleton", kind: "visual", interactive: false, status: "shipped" },
  { name: "Shimmer", kind: "visual", interactive: false, status: "shipped" },
  { name: "ProgressBar", kind: "visual", interactive: false, status: "shipped" },
  { name: "ScrollFade", kind: "visual", interactive: false, status: "shipped" },
  { name: "FileType", kind: "visual", interactive: false, status: "shipped" },
  { name: "CodeBlock", kind: "visual", interactive: false, status: "shipped" },
  // form
  { name: "Input", kind: "form", interactive: false, status: "shipped" },
  { name: "Textarea", kind: "form", interactive: false, status: "shipped" },
  { name: "Label", kind: "form", interactive: false, status: "shipped" },
  { name: "Checkbox", kind: "form", interactive: false, status: "shipped" },
  { name: "Radio", kind: "form", interactive: false, status: "shipped" },
  { name: "Switch", kind: "form", interactive: false, status: "shipped" },
  // overlay / floating (adapter-routed)
  { name: "Popover", kind: "overlay", interactive: true, adapterKey: "popover", status: "shipped" },
  { name: "Dialog", kind: "overlay", interactive: true, adapterKey: "dialog", status: "shipped" },
  {
    name: "DropdownMenu",
    kind: "overlay",
    interactive: true,
    adapterKey: "menu",
    status: "shipped",
  },
  { name: "Tooltip", kind: "overlay", interactive: true, adapterKey: "tooltip", status: "shipped" },
  { name: "Select", kind: "overlay", interactive: true, adapterKey: "select", status: "shipped" },
  { name: "Drawer", kind: "overlay", interactive: true, status: "shipped" },
  { name: "Command", kind: "overlay", interactive: true, status: "shipped" },
  // structure
  { name: "Tabs", kind: "structure", interactive: true, status: "shipped" },
  { name: "Collapsible", kind: "structure", interactive: true, status: "shipped" },
  { name: "AppShell", kind: "structure", interactive: false, status: "shipped" },
  // theming
  { name: "ColorModeToggle", kind: "visual", interactive: false, status: "shipped" },

  // ---- PLANNED (gaps vs Base UI / Radix / shadcn) — RED until built ----
  { name: "Separator", kind: "visual", interactive: false, status: "shipped" },
  { name: "Toggle", kind: "form", interactive: false, status: "shipped" },
  { name: "ToggleGroup", kind: "form", interactive: true, status: "shipped" },
  { name: "Slider", kind: "form", interactive: true, status: "shipped" },
  { name: "Accordion", kind: "structure", interactive: true, status: "shipped" },
  {
    name: "Combobox",
    kind: "overlay",
    interactive: true,
    adapterKey: "combobox",
    status: "shipped",
  },
  { name: "Autocomplete", kind: "overlay", interactive: true, status: "planned" },
  { name: "HoverCard", kind: "overlay", interactive: true, status: "shipped" },
  { name: "ContextMenu", kind: "overlay", interactive: true, status: "shipped" },
  { name: "Toast", kind: "overlay", interactive: true, status: "shipped" },
  { name: "Menubar", kind: "overlay", interactive: true, status: "shipped" },
  { name: "NumberField", kind: "form", interactive: false, status: "shipped" },
  { name: "AspectRatio", kind: "visual", interactive: false, status: "shipped" },
];

let storyFiles: string[] = [];
try {
  storyFiles = [...Deno.readDirSync(STORIES_DIR)].map((e) => e.name);
} catch { /* dir missing → all story checks fail, which is the point */ }
let guideText = "";
try {
  guideText = Deno.readTextFileSync(UI_GUIDE);
} catch { /* guide missing → all doc checks fail */ }

// All `*.test.tsx` source under the ui tree EXCEPT this manifest — because this
// file lists every component name as a string literal, so including it would make
// the "has a test" check pass trivially for everything. A component "has a test"
// when its name is referenced by some OTHER test file (its own `*.test.tsx` or a
// shared conformance/characterization suite).
function collectTestSources(dir: string): string {
  let out = "";
  for (const e of Deno.readDirSync(dir)) {
    const p = `${dir}${e.name}`;
    if (e.isDirectory) {
      out += collectTestSources(`${p}/`);
    } else if (e.isFile && e.name.endsWith(".test.tsx") && e.name !== "coverage.test.tsx") {
      try {
        out += "\n" + Deno.readTextFileSync(p);
      } catch { /* unreadable → skip */ }
    }
  }
  return out;
}
const UI_TEST_SRC = collectTestSources(new URL(".", import.meta.url).pathname);

describe("veryfront/ui coverage — to-spec gate", () => {
  for (const c of UI_COMPONENTS) {
    it(`${c.name}: exported from veryfront/ui`, () => {
      assert(
        c.name in ui && (ui as Record<string, unknown>)[c.name] != null,
        `${c.name} (${c.status}) is not exported from veryfront/ui`,
      );
    });

    it(`${c.name}: has a Storybook story`, () => {
      assert(
        storyFiles.includes(`${c.name}.stories.tsx`),
        `missing storybook/stories/ui/${c.name}.stories.tsx`,
      );
    });

    it(`${c.name}: is documented in its story (colocated DocsPage)`, () => {
      let story = "";
      try {
        story = Deno.readTextFileSync(`${STORIES_DIR}${c.name}.stories.tsx`);
      } catch { /* no story → fails below, which is the point */ }
      assert(
        /DocsHero|DocsPropsTable|DocsPage/.test(story),
        `${c.name} has no colocated docs — its Storybook story must carry a DocsPage ` +
          `(DocsHero + DocsPropsTable). Component docs live in the story, not the root guide.`,
      );
    });

    it(`${c.name}: has a test`, () => {
      assert(
        new RegExp(`\\b${c.name}\\b`).test(UI_TEST_SRC),
        `${c.name} (${c.status}) is not referenced by any ui *.test.tsx — needs its ` +
          `own conformance test (or coverage in a shared conformance/characterization suite)`,
      );
    });

    if (c.interactive && c.adapterKey) {
      it(`${c.name}: covered by the adapter contract (swappable engine)`, () => {
        assert(
          (c.adapterKey as string) in builtinAdapter,
          `${c.name} has no "${String(c.adapterKey)}" key on the builtin adapter`,
        );
      });
    }
  }
});

// ---------------------------------------------------------------------------
// Every `cva` VARIANT is demonstrated in the component's OWN story.
// The source of truth is each component's own `cva({ variants: {...} })` block; we
// extract every `<group>: { <value>: ... }` and assert each `<value>` token is
// shown in its Storybook story (`<Name>.stories.tsx`) — which, per the one-Story-
// per-variant convention, genuinely renders it. Docs live in the story, so the
// story IS the variant reference; we do NOT grep the root guide for variant tokens
// (see the guardrail below). RED until every variant is demonstrated.
// ---------------------------------------------------------------------------
const UI_DIR_PATH = new URL(".", import.meta.url).pathname;
const kebab = (s: string) =>
  s.replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();

/** Pull `{group,value}` pairs from a `cva({ variants: {...} })` block. */
export function extractVariants(src: string): Array<{ group: string; value: string }> {
  const out: Array<{ group: string; value: string }> = [];
  // The real block only — `defaultVariants`/`compoundVariants` use a capital V.
  const m = /(?<![A-Za-z])variants\s*:\s*\{/.exec(src);
  if (!m) return out;
  const lines = src.slice(m.index + m[0].length).split("\n");
  let depth = 1; // we are inside `variants: {`
  let group: string | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    const stripped = line.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
    if (depth === 1) {
      const g = /^([A-Za-z_][\w-]*)\s*:\s*\{/.exec(stripped);
      if (g && g[1]) group = g[1];
    } else if (depth === 2 && group) {
      const v = /^(?:"([\w-]+)"|'([\w-]+)'|([A-Za-z_][\w-]*))\s*:/.exec(line);
      const value = v && (v[1] ?? v[2] ?? v[3]);
      if (value) out.push({ group, value });
    }
    depth += (stripped.match(/\{/g)?.length ?? 0) - (stripped.match(/\}/g)?.length ?? 0);
    if (depth <= 0) break;
  }
  return out;
}

describe("veryfront/ui: every cva variant is covered (story · docs · test)", () => {
  for (const c of UI_COMPONENTS) {
    if (c.status !== "shipped") continue; // planned rows fail the `exists` gate already
    const srcPath = `${UI_DIR_PATH}${kebab(c.name)}.tsx`;
    let src = "";
    try {
      src = Deno.readTextFileSync(srcPath);
    } catch {
      continue; // component defined elsewhere → variant gate not applicable here
    }
    const variants = extractVariants(src);
    if (variants.length === 0) continue; // no cva variants → nothing to cover

    it(`${c.name}: all ${variants.length} variants demonstrated in its story`, () => {
      let story = "";
      try {
        story = Deno.readTextFileSync(`${STORIES_DIR}${c.name}.stories.tsx`);
      } catch { /* no story → every variant misses, which is the point */ }
      const misses: string[] = [];
      for (const { group, value } of variants) {
        if (!new RegExp(`\\b${value}\\b`).test(story)) misses.push(`${group}="${value}"`);
      }
      assert(
        misses.length === 0,
        `${c.name} variants not demonstrated in storybook/stories/ui/${c.name}.stories.tsx:\n  ` +
          `${
            misses.join("\n  ")
          }\n(show each variant in the story — that is where variants are documented)`,
      );
    });
  }
});

// ---------------------------------------------------------------------------
// Every prop is documented with JSDoc. Each field of a component's `*Props`
// interface(s) carries a JSDoc comment — these feed the story's `DocsPropsTable`
// and IDE hovers. `ref` (React 19 boilerplate) is exempt. This is a loop quality
// gate: props without JSDoc are undocumented API.
// ---------------------------------------------------------------------------
/** Names of `*Props` fields (top level of the interface body) missing JSDoc. */
export function propsMissingJsdoc(src: string): string[] {
  const lines = src.split("\n");
  const offenders: string[] = [];
  let depth = 0; // brace depth inside a `*Props` interface body (0 = outside)
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const trimmed = raw.trim();
    if (depth === 0) {
      if (/(?:export\s+)?interface\s+\w*Props\b[^{]*\{/.test(raw)) {
        depth = 1;
      }
      continue;
    }
    const opens = raw.match(/\{/g)?.length ?? 0;
    const closes = raw.match(/\}/g)?.length ?? 0;
    // A direct field of the interface sits at depth 1 before this line's braces.
    if (
      depth === 1 &&
      /^(?:readonly\s+)?["']?[A-Za-z_$][\w$-]*["']?\s*\??\s*:/.test(trimmed) &&
      !trimmed.startsWith("//") && !trimmed.startsWith("*")
    ) {
      const field = trimmed.match(/^(?:readonly\s+)?["']?([A-Za-z_$][\w$-]*)["']?/)?.[1] ?? "";
      // `ref` and `className` are universal, self-explanatory boilerplate.
      if (field && field !== "ref" && field !== "className") {
        const prev = (lines[i - 1] ?? "").trim();
        const hasJsdoc = prev.endsWith("*/") || prev.startsWith("/**");
        if (!hasJsdoc) offenders.push(field);
      }
    }
    depth += opens - closes;
    if (depth <= 0) depth = 0;
  }
  return offenders;
}

describe("veryfront/ui: every prop is documented with JSDoc", () => {
  for (const c of UI_COMPONENTS) {
    if (c.status !== "shipped") continue;
    const srcPath = `${UI_DIR_PATH}${kebab(c.name)}.tsx`;
    let src = "";
    try {
      src = Deno.readTextFileSync(srcPath);
    } catch {
      continue; // component defined elsewhere → checked with its own file
    }
    if (!/interface\s+\w*Props\b/.test(src)) continue; // props typed inline elsewhere

    it(`${c.name}: *Props fields all carry JSDoc`, () => {
      const missing = propsMissingJsdoc(src);
      assert(
        missing.length === 0,
        `${kebab(c.name)}.tsx has props without JSDoc: ${missing.join(", ")} — ` +
          `every public prop needs a /** … */ (feeds DocsPropsTable + IDE hovers)`,
      );
    });
  }
});

// ---------------------------------------------------------------------------
// GUARDRAIL — the root guide stays a thin overview. Component + variant docs
// live in the component's story (DocsPage) and source JSDoc. This test fails if
// the guide starts re-listing internal cva variant tokens (a per-variant
// catalog), inverting the old incentive that produced doc slop. Do not weaken.
// ---------------------------------------------------------------------------
describe("veryfront/ui: the UI guide stays a thin overview (docs live in components)", () => {
  it("names no internal cva variant tokens — variant docs belong in the story", () => {
    const tokens = new Set<string>();
    for (const c of UI_COMPONENTS) {
      if (c.status !== "shipped") continue;
      let src = "";
      try {
        src = Deno.readTextFileSync(`${UI_DIR_PATH}${kebab(c.name)}.tsx`);
      } catch {
        continue;
      }
      // Distinctive compound tokens (hyphenated) — these never occur in prose,
      // so their presence means someone pasted a variant catalog into the guide.
      for (const { value } of extractVariants(src)) {
        if (value.includes("-")) tokens.add(value);
      }
    }
    const offenders = [...tokens].filter((t) => new RegExp(`\\b${t}\\b`).test(guideText));
    assert(
      offenders.length === 0,
      `docs/guides/ui-components.md lists cva variant tokens (${offenders.join(", ")}). ` +
        `Variant docs belong in each component's Storybook story (DocsPropsTable), not the root ` +
        `guide — keep the guide a thin overview that links to Storybook.`,
    );
  });
});

// ---------------------------------------------------------------------------
// Composition rule: NO `xxxClassName` / `xxxProps` bags (RFC 2980 rule 1).
// One `className` per node; sub-pieces are composed, not configured via bags.
// Scans the ui source for prop-FIELD declarations named `<x>ClassName` or
// `<x>Props` (allowing the single `className` field and `*Props` interface names).
// ---------------------------------------------------------------------------
describe("veryfront/ui: no xxxClassName / xxxProps prop bags", () => {
  const UI_DIR = new URL(".", import.meta.url).pathname;
  // A prop field like `  iconClassName?: string` or `  contentProps?: …` — but
  // NOT `className?:` and NOT interface/type declarations (`interface XProps {`).
  const BAG = /^\s*(\w*ClassName|\w+Props)\s*[?]?\s*:/;
  const files = [...Deno.readDirSync(UI_DIR)]
    .filter((e) => e.isFile && e.name.endsWith(".tsx") && !/\.test\.tsx$/.test(e.name));

  for (const f of files) {
    it(`${f.name}: has no prop bags`, () => {
      const src = Deno.readTextFileSync(`${UI_DIR}${f.name}`);
      const offenders = src.split("\n")
        .map((line, i) => ({ line: line.trim(), n: i + 1 }))
        .filter(({ line }) =>
          BAG.test(line) &&
          !/^className\s*[?]?\s*:/.test(line) && // the one allowed className field
          !/^(interface|type|export)\b/.test(line) // not a type/interface name
        )
        .map(({ line, n }) => `${f.name}:${n}  ${line}`);
      assert(offenders.length === 0, `prop bags found:\n  ${offenders.join("\n  ")}`);
    });
  }
});

// ---------------------------------------------------------------------------
// Composition rules by rendering: a leaf renders ONE node, forwards `ref` to it,
// and spreads arbitrary `{...props}` (data-*) onto it. Proven here for a curated
// set of standalone leaves; every primitive also has its own *.test.tsx.
// ---------------------------------------------------------------------------
function installDom(dom: JSDOM): () => void {
  const w = dom.window;
  const prev = {
    document: globalThis.document,
    window: globalThis.window,
    navigator: globalThis.navigator,
    HTMLElement: globalThis.HTMLElement,
    Node: globalThis.Node,
  };
  Object.assign(globalThis, {
    document: w.document,
    window: w,
    navigator: w.navigator,
    HTMLElement: w.HTMLElement,
    Node: w.Node,
  });
  return () => {
    Object.assign(globalThis, prev);
    dom.window.close();
  };
}

// deno-lint-ignore no-explicit-any
const LEAVES: Array<{ name: string; Comp: any; el: string }> = [
  { name: "Button", Comp: Button, el: "button" },
  { name: "Badge", Comp: Badge, el: "span" },
  { name: "Input", Comp: Input, el: "input" },
  { name: "Card", Comp: Card, el: "div" },
];

describe("veryfront/ui: leaf composition (one node · ref · {...props})", () => {
  for (const { name, Comp } of LEAVES) {
    it(`${name}: renders one node, forwards ref, spreads data-*`, () => {
      const dom = new JSDOM(`<!doctype html><html><body><div id="root"></div></body></html>`);
      const restore = installDom(dom);
      const host = dom.window.document.getElementById("root")!;
      const ref = React.createRef<HTMLElement>();
      try {
        const root = createRoot(host);
        // No children: `Input` is a void element and react-dom throws if given any.
        flushSync(() =>
          root.render(
            React.createElement(Comp, { ref, "data-probe": "x", className: "vf-probe" }),
          )
        );
        assert(host.children.length === 1, `${name} must render exactly one root node`);
        const node = host.children[0] as HTMLElement;
        assert(
          node.getAttribute("data-probe") === "x",
          `${name} must spread {...props} (data-probe)`,
        );
        assert(node.className.includes("vf-probe"), `${name} must merge className`);
        assert(ref.current === node, `${name} must forward ref to its node`);
        root.unmount();
      } finally {
        restore();
      }
    });
  }
});
