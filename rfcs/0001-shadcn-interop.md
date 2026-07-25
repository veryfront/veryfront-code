# RFC: Seamless shadcn/ui interop in Veryfront Code

**Status:** Draft · **Author:** Matt Boon · **Date:** 2026-07-25
**Scope:** Veryfront Code apps consuming shadcn/ui components
**TL;DR:** shadcn/ui already _runs_ on Veryfront today: same React 19, same Tailwind v4, and the import pipeline handles shadcn's browser dependencies through esm.sh with React dedupe. SSR keeps npm dependencies native, so projects must install or import-map the copied packages before SSR can resolve them. What's missing for **seamless** is tooling + a few sharp edges: no `shadcn` CLI target, dependency installation and version-pinning guidance, a `cn`/tailwind-merge correctness question, and registry/docs. This RFC verifies what works and proposes the gap-closers.

> **Update: end-to-end proof (external testbed):** built a 19-component test app rendering the **real** npm packages (Radix dialog/select/popover/dropdown/tooltip, cmdk, react-hook-form+zod, @tanstack/react-table, input-otp, sonner, recharts, embla, vaul, react-resizable-panels, next-themes, react-day-picker) and ran an SSR + Playwright hydration/interaction suite with **19/19 pass** (portals mount to `document.body`, forms validate, charts paint, toasts fire, theme toggles). Repro suite: [veryfront-router-testing#4]. This evidence is outside this repository; in-repo evidence below is limited to committed runtime code and configuration. Two issues surfaced: (1) sonner **500'd SSR**, a framework bug fixed in [veryfront-code#3098] (SSR DOM stub missing `documentElement.getAttribute`); (2) react-resizable-panels needed version pinning, not a framework bug but the version-floating caveat (P2) in practice. Tier A/B are proven in that external testbed, not by committed fixtures in this repository.

---

## 1. Summary

Veryfront Code is a Deno + TypeScript + React full-stack framework. Its rendering pipeline pins **React 19.2.4** and its CSS is **Tailwind CSS v4.2.2**, driven CSS-first (`@import "tailwindcss"`, `@theme {}`, `@custom-variant`, `@plugin`). That is exactly the substrate the **latest** shadcn/ui targets (React 19, Tailwind v4, CSS-variable theming). So the question isn't _can it run_ - it's _how seamless is the authoring flow_.

**Verdict:** Interop is **real and mostly automatic at runtime**, but **not yet turnkey** at the tooling/DX layer.

| Layer                                                | State                                            |
| ---------------------------------------------------- | ------------------------------------------------ |
| React version                                        | ✅ 19.2.4 (matches latest shadcn)                |
| Tailwind version                                     | ✅ v4.2.2, CSS-first (matches latest shadcn)     |
| `@radix-ui/*`, `cva`, `clsx`, `lucide-react` imports | ✅ auto-resolve via esm.sh with React dedupe     |
| `@/…` path aliases                                   | ✅ resolve to project root by default            |
| Tailwind `@theme` / CSS-var theming / `@plugin`      | ✅ supported                                     |
| `@plugin "tailwindcss-animate"`                      | ✅ **verified** - emits keyframes + `animate-in` |
| `@import "tw-animate-css"` (current shadcn)          | ❌ **verified no-op** - silently dropped         |
| `npx shadcn init/add` CLI                            | ❌ no Deno/Veryfront target                      |
| Version pinning                                      | ⚠️ shadcn emits unversioned imports → warnings   |
| `cn` = `twMerge(clsx())` semantics                   | ⚠️ works, but a v4 config-awareness caveat       |
| Component registry / docs                            | ❌ none for Veryfront                            |

---

## 2. What actually works today (verified)

### 2.1 Runtime dependency resolution - **verified against the real pipeline**

I ran Veryfront's own `bareStrategy` (`src/transforms/import-rewriter/strategies/bare-strategy.ts`), the code path the dev/build pipeline uses, against the verbatim import block that `npx shadcn@latest add button` writes (`button.tsx` + `lib/utils.ts`). Result:

**Browser target:**

```
react                        -> (react-strategy → pinned 19.2.4 shim)
@radix-ui/react-slot         -> https://esm.sh/@radix-ui/react-slot?external=react,react-dom&target=es2022
class-variance-authority     -> https://esm.sh/class-variance-authority?external=react,react-dom&target=es2022
clsx                         -> https://esm.sh/clsx?external=react,react-dom&target=es2022
tailwind-merge               -> https://esm.sh/tailwind-merge?external=react,react-dom&target=es2022
lucide-react                 -> https://esm.sh/lucide-react?external=react,react-dom&target=es2022
@/lib/utils                  -> (alias-strategy → project-root relative)
```

**SSR target:** every npm package returns `null` from `bareStrategy`, so the specifier is left native. That is intentional, but it is not self-sufficient: SSR resolution depends on the copied package being installed or mapped in the app runtime. A shadcn preset, starter, or `veryfront ui add` flow must add the packages to `package.json` or `deno.json` imports, for example `"@radix-ui/react-slot": "npm:@radix-ui/react-slot@1.1.1"`, before claiming SSR works. The current Deno scaffold writes a thin `deno.json` with tasks only (`cli/commands/init/deno-config-generator.ts`), so it does not add these dependency mappings automatically.

The critical browser detail: **`external=react,react-dom` is applied uniformly.** That dedupes React to Veryfront's single copy, so Radix's hooks/context/refs work across the boundary. This is the thing that usually breaks React libs behind a CDN. It is handled for browser esm.sh rewrites.

### 2.2 Committed Veryfront code already proves the runtime pieces

The previously referenced production app files are not part of this repository. The committed evidence is narrower and should be treated that way:

- React is pinned by `react/deno.json` to React **19.2.4** and related `react-dom` entrypoints.
- Tailwind is pinned by `extensions/ext-css-tailwind/deno.json` to **tailwindcss@4.2.2**.
- Browser bare dependencies are rewritten by `src/transforms/import-rewriter/strategies/bare-strategy.ts` to esm.sh with `external=react,react-dom`.
- SSR import-map resolution is implemented by `src/transforms/import-rewriter/strategies/import-map-strategy.ts`, but only for `target === "ssr"`.
- In-framework overlays use real `react-dom` portals in `src/react/components/ui/{floating,tooltip}.tsx`, proving the committed portal mechanism that Radix-style components rely on.

### 2.3 Tailwind setup - **yes, it's as expected, simple and logical**

`extensions/ext-css-tailwind` is a thin, clean adapter over Tailwind v4's official `compile()` JS API:

- `@import "tailwindcss"`, `@theme { --color-* }`, `@custom-variant dark (&:is([data-theme="dark"] *))`, and `@plugin "@tailwindcss/typography"` fit the committed Tailwind v4 adapter.
- `@plugin` bundles load at runtime from esm.sh via `globalThis` shims so plugin code binds to the same Tailwind copy. Verified: `@plugin "tailwindcss-animate"` emits `@keyframes enter/exit` + `animate-in` (§3 P2b). Note the asymmetry: `@plugin` fetches from esm.sh, but stylesheet `@import` of anything other than `"tailwindcss"` is dropped (P2b).
- Class candidates are scanned at render time and `build(candidates)` emits CSS.

There's no `tailwind.config.js` and no PostCSS chain. It is the v4 CSS-first model, which is precisely what current shadcn expects. Nothing surprising here.

---

## 3. Missing pieces for _seamless_

### P1 - No `shadcn` CLI target (biggest DX gap)

`npx shadcn@latest init` / `add` detects a Node project via `package.json` + `tsconfig` `paths` + `components.json` + a `tailwind.config`. A Veryfront app is Deno-first (`deno.json`, `veryfront.config.ts`), so the CLI won't detect or write correctly. Today you copy component source by hand.
**Fix options:**

- (a) A `components.json` preset + docs so `shadcn add` writes into `components/ui` with `@/` aliases (Veryfront already honors `@/` and `components/`). The CLI mostly just writes files. With the right `components.json` (`"aliases": { "components": "@/components", "utils": "@/lib/utils" }`, `"tailwind": { "css": "globals.css" }`) it can target a Veryfront app.
- (b) A first-party `veryfront ui add <component>` wrapper, or a Veryfront **registry** (`registry.json`) so `shadcn add @veryfront/button` pulls Veryfront-tuned variants.

### P2 - Unversioned imports warn (reproducibility)

Every shadcn import is unversioned (`@radix-ui/react-slot`, not `@x.y.z`). `bareStrategy` resolves them but logs _"Unversioned import may cause reproducibility issues"_ per specifier, and esm.sh floats to latest.
**Fix:** ship two coordinated steps:

1. Browser reproducibility: rewrite copied source imports to explicit versions, for example `@radix-ui/react-slot@1.1.1`, or add a browser-aware pinning strategy that runs before `bareStrategy` rewrites the specifier. A plain import-map block does not silence the browser warning or pin the browser esm.sh URL because `bareStrategy` handles bare browser imports before `ImportMapStrategy`, and `ImportMapStrategy.matches()` only runs for `target === "ssr"`.
2. SSR resolution: add the same dependency set to the app runtime through `package.json` or `deno.json` imports, for example `"@radix-ui/react-slot": "npm:@radix-ui/react-slot@1.1.1"`. This is what lets native SSR imports resolve.

### P3 - `cn` / tailwind-merge correctness caveat

shadcn's canonical `cn` is `twMerge(clsx(inputs))`. `tailwind-merge` **does resolve** (§2.1), so it works out of the box. But two caveats worth documenting:

- Core deliberately **avoids** tailwind-merge (policy: no deps in core; `src/react/components/ui/*` hand-roll a clsx-only `cn`). Because their `cn` doesn't merge, they encode conflict-avoidance by hand (e.g. `label.tsx`: font-weight only in the variant, never the base; `tabs.tsx`: override base utilities with the `!`/`px-8!` suffix). **App code doesn't inherit that constraint**. Apps can and should use real `twMerge`.
- With Tailwind v4's CSS-first `@theme`, `tailwind-merge` needs a version that understands v4 (**tailwind-merge ≥ v3**) and, for non-standard token groups, `extendTailwindMerge`. Standard shadcn tokens (`bg-primary`, `text-*`, spacing) fall in known groups and merge fine; bespoke tokens may need config.
  **Fix:** document the recommended `cn` (real `twMerge`, pinned to a v4-compatible version) and note when `extendTailwindMerge` is needed. Optionally ship `veryfront/ui/cn` as the blessed helper.

### P4 - No Veryfront-specific docs / registry / examples

There's no "Using shadcn/ui with Veryfront" page, no starter, no registry. The knowledge (esm.sh dedupe, `@/` aliases, `@theme` theming, `@plugin` animate) is all implicit.
**Fix:** a docs page + a `create-veryfront-app --template shadcn` starter with `globals.css` (`@theme` tokens + `@custom-variant dark`), `lib/utils.ts`, and 3-4 seed components.

### P2b - `@import "tw-animate-css"` is silently dropped (current-shadcn breakage) - **verified**

Latest shadcn ships animations via `@import "tw-animate-css"` in `globals.css` (it dropped the `tailwindcss-animate` plugin). I compiled both paths through the real release CSS pipeline (`createCompileProjectCss` → `generateTailwindCSS`, esm.sh loaders active):

| Stylesheet                      | `@keyframes enter/exit` | `.animate-in` | CSS size             |
| ------------------------------- | ----------------------- | ------------- | -------------------- |
| `@plugin "tailwindcss-animate"` | ✅ yes                  | ✅ yes        | 4635 B               |
| `@import "tw-animate-css"`      | ❌ no                   | ❌ no         | 3551 B (== baseline) |
| baseline (no animate)           | ❌ no                   | ❌ no         | 3551 B               |

**Root cause:** `src/html/styles-builder/tailwind-compiler-cache.ts` `loadStylesheet` resolves **only** `@import "tailwindcss"`; every other `@import` id logs _"Unknown stylesheet import"_ and returns **empty content**. So `@import "tw-animate-css"` and any relative/package CSS `@import` in an app's `globals.css` are no-ops. `@plugin` works because it goes through `loadModule` → the esm.sh plugin loader.
**Impact:** a shadcn `globals.css` copied verbatim compiles without error but ships **zero animation CSS**. Dialogs/popovers/dropdowns render without their enter/exit transitions, and any other `@import`-ed CSS vanishes.
**Fix options:** (a) teach `loadStylesheet` to resolve package/remote `@import` via the same esm.sh path the plugin loader uses (fixes `tw-animate-css` and relative CSS imports generally; preferred); or (b) short-term, have the Veryfront shadcn preset/starter rewrite `@import "tw-animate-css"` → `@plugin "tailwindcss-animate"`, which is verified working. Lock the outcome with the integration test above.

---

## 3B. Complex & niche components - coverage matrix

The button is the easy case. This section covers shadcn's hard components: the ones with portals, DOM measurement, extra third-party deps, or SSR hazards. **Import resolution is verified universal only with the installation requirement above**: browser deps rewrite to esm.sh (`external=react,react-dom`, React deduped), and SSR deps stay native for Deno or Node to resolve from installed packages/import mappings. What resolution does _not_ prove is runtime SSR/hydration correctness, so each row is graded on that.

**Load-bearing runtime fact (committed):** the framework's own UI primitives use **real `react-dom` `createPortal`** (`src/react/components/ui/{floating,tooltip}.tsx`). So the portal → SSR → hydrate mechanism, the backbone of Dialog/Popover/Select/Tooltip/DropdownMenu/Toast, is represented in committed code. Modern Radix guards DOM access in effects, so real Radix packages are _expected_ to inherit this; the 19-component external testbed is the evidence for end-to-end npm package rendering.

### Tier A - resolves + portal/headless pattern proven → expected to work

| Component                                                                                                                                         | Extra deps                                      | Why low-risk                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------- |
| Dialog, Alert Dialog, Sheet                                                                                                                       | `@radix-ui/react-dialog`                        | portal pattern proven in-framework              |
| Popover, Dropdown/Context Menu, Menubar, Hover Card, Tooltip, Select, Navigation Menu                                                             | `@radix-ui/react-*`                             | portal + floating; SSR-safe (effect-guarded)    |
| Accordion, Collapsible, Tabs, Toggle(Group), Radio Group, Checkbox, Switch, Slider, Progress, Avatar, Aspect Ratio, Separator, Scroll Area, Label | `@radix-ui/react-*`                             | no portal; pure controlled primitives           |
| Command / Combobox                                                                                                                                | `cmdk`                                          | client, self-contained context (+Dialog portal) |
| Form                                                                                                                                              | `react-hook-form`, `@hookform/resolvers`, `zod` | headless client logic, own context              |
| Data Table                                                                                                                                        | `@tanstack/react-table`                         | fully headless                                  |
| Input OTP                                                                                                                                         | `input-otp`                                     | controlled client input                         |
| Toast                                                                                                                                             | `@radix-ui/react-toast` **or** `sonner`         | portal; sonner self-injects styles at runtime   |

### Tier B - resolves, but DOM-measuring / client-dimension → SSR renders empty, hydration + layout risk. **Needs render-testbed verification; recommend a client-only guard.**

| Component | Dep                      | Hazard                                                                            |
| --------- | ------------------------ | --------------------------------------------------------------------------------- |
| Chart     | `recharts`               | d3 + `ResizeObserver` + SVG; needs `ResponsiveContainer`, notoriously SSR-awkward |
| Carousel  | `embla-carousel-react`   | measures track width in an effect                                                 |
| Drawer    | `vaul`                   | measures viewport, transforms, snap points                                        |
| Resizable | `react-resizable-panels` | measures panel sizes                                                              |

### Tier C - resolves, but framework-integration friction (not a resolution bug)

| Component              | Dep                            | Friction                                                                                                                                                                                                                     |
| ---------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Theme toggle           | `next-themes`                  | overlaps Veryfront's own `data-theme` + dark-flash handling. shadcn's `dark:` maps to `@custom-variant dark (&:is([data-theme="dark"] *))`; prefer Veryfront-native theming over `next-themes` and skip its `<html>` script. |
| Date Picker / Calendar | `react-day-picker`, `date-fns` | pure client. Caveat: older versions `import "react-day-picker/dist/style.css"` include a **package CSS import** (see cross-cutting #2). shadcn v4's calendar restyles via Tailwind and drops that import → fine.             |

### Cross-cutting caveats (apply across tiers)

1. **Portals**: mechanism exists in committed framework code; the external testbed covers real npm Radix under SSR/hydration.
2. **Package CSS imports** (`import "pkg/x.css"`): the SSR CSS-import collector (`src/modules/react-loader/css-import-collector.ts`) tracks **local** project CSS; resolving/injecting a _package's_ CSS from esm.sh is unverified. Libs that ship required CSS (some carousels, sonner variants, old react-day-picker) may render unstyled. Related to P2b (only `@import "tailwindcss"` is resolved). Most shadcn components sidestep this by restyling with Tailwind.
3. **Version floating** (P2): unpinned browser esm.sh imports can pull **two** copies of the same lib → duplicate React context (e.g. two `react-hook-form`/`cmdk` instances), which silently breaks. Browser dedupe requires explicit source versions or a browser-aware pinning rewrite. SSR dedupe requires the same packages in `package.json` or `deno.json` imports so native resolution uses one installed copy.
4. **SSR module-eval / DOM-read during render**: SSR imports the package natively in Deno and renders it against Veryfront's DOM stub; a lib reading `window`/`document` at module top-level _or during render_ can throw. **Confirmed real:** sonner reads `document.documentElement.getAttribute` during render → 500, because the SSR stub gave `documentElement`/`body` no `getAttribute`. **Fixed** in [veryfront-code#3098] (full element stub). This is the class of bug to watch; the fix covers the common `getAttribute`/`setAttribute` case.

**Verification: external testbed:** a 19-component suite renders the real packages through `veryfront-examples/veryfront-router-testing` (Method 1) with SSR + Playwright hydration/interaction → **19/19 pass** ([veryfront-router-testing#4]). Tier A/B are proven in that testbed, not by committed fixtures in this repository. Only caveat: version-floating (P2) bit react-resizable-panels (v4 renamed exports); pin third-party deps.

[veryfront-code#3098]: https://github.com/veryfront/veryfront-code/pull/3098
[veryfront-router-testing#4]: https://github.com/mattboon/veryfront-router-testing/pull/4

---

## 4. Proposed "seamless" design

1. **`components.json` preset** (`aliases → @/`, `css → globals.css`, `rsc: true`, `tsx: true`) committed to the shadcn starter so `npx shadcn add <x>` writes correctly into a Veryfront app.
2. **Pin-on-add codemod**: after `shadcn add`, rewrite browser-facing bare deps to explicit versions or run a browser-aware pinning strategy before `bareStrategy`; also add matching package entries to `package.json` or `deno.json` imports for SSR. Kills P2, gives reproducible builds, and keeps SSR native resolution working.
3. **Blessed `cn`** exported from `veryfront/ui` (real `twMerge`, pinned v4-compatible), referenced by the starter's `lib/utils.ts`.
4. **Veryfront registry** (`registry.json`) so `shadcn add @veryfront/button` pulls variants already tuned to the `@theme` token vocabulary.
5. **Docs page + starter template** covering the esm.sh dedupe model, `@/` aliases, `@theme` theming, dark variant, and animate plugin.
6. **Integration test** locking in: canonical shadcn `button.tsx` + `card.tsx` + a Radix `dialog.tsx` compile, hydrate, and emit the right CSS candidates.

**Effort:** P1+P2 (preset + pin codemod) are the high-leverage 80/20. They turn "copy source by hand" into "`shadcn add` just works." P3-P5 are docs/registry polish.

---

## 5. Answers to the direct questions

- **Does Veryfront interop with shadcn?** Yes, with the dependency caveat: browser imports auto-resolve with React dedupe, while SSR needs the copied npm packages installed or mapped.
- **Is the Tailwind setup as expected, simple, logical?** Yes: a thin adapter over Tailwind v4's official `compile()`, pure CSS-first (`@theme`/`@custom-variant`/`@plugin`), no PostCSS/config cruft.
- **Do we support the latest Tailwind, i.e. the latest shadcn?** Yes: Tailwind **4.2.2** + React **19.2.4**, the exact target of current shadcn.
- **Do the complex/niche components work (Dialog, Select, Command, Form, Chart, Carousel, Drawer, Data Table, OTP, Toast…)?** Browser deps resolve and the portal→SSR→hydrate mechanism they depend on is represented in committed framework code (`createPortal` in `src/react/components/ui/{floating,tooltip}.tsx`). The 19-component external testbed reports full SSR + hydration coverage. Full matrix in §3B.
- **So what's missing for _seamless_?** Tooling: a `shadcn` CLI target/preset, browser-aware version pinning, SSR dependency installation/import-map entries, a documented `cn`, and a registry/docs, plus the P2b `@import` fix. See §3.

---

## Appendix A - Evidence

- React pin: `react/deno.json` → `react@19.2.4`
- Tailwind pin: `extensions/ext-css-tailwind/deno.json` → `tailwindcss@4.2.2`; adapter: `extensions/ext-css-tailwind/src/index.ts` (`compile()` + plugin shims)
- Browser auto-resolution: `src/transforms/import-rewriter/strategies/bare-strategy.ts` (+ verified run, §2.1)
- SSR import-map strategy: `src/transforms/import-rewriter/strategies/import-map-strategy.ts` (matches only `target === "ssr"`)
- Deno scaffold limitation: `cli/commands/init/deno-config-generator.ts` writes tasks and `nodeModulesDir`, not shadcn dependency mappings
- `@/` alias: `src/transforms/import-rewriter/strategies/alias-strategy.ts`
- Portal mechanism: `src/react/components/ui/{floating,tooltip}.tsx`
- Core's clsx-only `cn` rationale: `src/react/components/ui/{label,tabs}.tsx`, `src/utils/clsx.ts`
- Animate compile (P2b): `createCompileProjectCss` (`src/release-assets/css-compile.ts`) → `generateTailwindCSS`; `loadStylesheet`/`loadModule` split in `src/html/styles-builder/tailwind-compiler-cache.ts` (only `@import "tailwindcss"` resolved; other `@import` → empty)

## Appendix B - Verification method (reproducible)

- **Import resolution (§2.1):** drove `bareStrategy.rewrite()` over the verbatim import block of `npx shadcn@latest add button` (`button.tsx` + `lib/utils.ts`), browser + SSR targets. Browser rewrites to esm.sh and warns on unversioned deps; SSR leaves package specifiers native.
- **SSR dependency requirement (§2.1/P2):** checked `ImportMapStrategy.matches()` and `cli/commands/init/deno-config-generator.ts`. Import maps are SSR-only in this path, and the scaffold does not create shadcn dependency mappings.
- **Animate (P2b):** compiled three stylesheets: `@plugin "tailwindcss-animate"`, `@import "tw-animate-css"`, and a baseline, through `createCompileProjectCss` with the shadcn animate candidates (`animate-in`, `fade-in-0`, `zoom-in-95`, …) and diffed the emitted CSS.
- These in-repo checks ran against the local `veryfront-code` checkout with the `ext-css-tailwind` CSSProcessor active. The full 19-component render/hydration result is external evidence at [veryfront-router-testing#4], not a committed fixture in this repository.
