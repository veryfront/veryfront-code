# Target file tree (this branch, when the goal is met)

What `feat/ui-chat-to-spec` should contain when done. `✅` exists today, `🔲` to
build, `➕` new file per item. Not exhaustive — the pattern generalises.

## `veryfront/ui` — `src/react/components/ui/`

```
ui/
├── adapter/
│   ├── contract.ts               ✅ types: PopoverParts, DialogParts, MenuParts,
│   │                                TooltipParts, SelectParts 🔲 + ComboboxParts,
│   │                                AccordionParts, ToastParts, SliderParts, …
│   ├── context.tsx               ✅ UIAdapterProvider / useAdapter
│   ├── token-scope.tsx           ✅ useTokenScope
│   ├── builtin/                  ✅ popover, dialog, menu, tooltip, select
│   │   └── …                     🔲 + combobox, accordion, toast, slider, … (or
│   │                                pure-visual skins that need no builtin engine)
│   └── *.conformance.test.tsx    ✅ per-primitive, builtin + swap path
├── <primitive>.tsx               ✅ button, input, card, popover, dialog, drawer,
│                                    dropdown-menu, tooltip, select, command, tabs,
│                                    collapsible, badge, pill, tag, …
│                                 🔲 + separator, toggle, toggle-group, slider,
│                                    accordion, combobox, autocomplete, hover-card,
│                                    context-menu, toast, menubar, number-field, …
├── <primitive>.test.tsx          🔲 per-component conformance (one-node/ref/spread/
│                                    asChild/data-*) — one per primitive
├── coverage.test.tsx             ✅ the deterministic to-spec gate (red→green)
├── index.ts / index.test.ts      ✅ public barrel + frozen export surface
└── boundary.test.ts              ✅ engine-off-core guard
```

## Adapter templates — `cli/templates/ui-adapters/`

```
ui-adapters/
├── base-ui.tsx        ✅ (popover+dialog) 🔲 → 5/5 + new primitives
├── radix.tsx          🔲 full engine
├── react-aria.tsx     🔲 full engine
├── ariakit.tsx        🔲 full engine
├── vaul.tsx           🔲 specialist: Drawer
├── sonner.tsx         🔲 specialist: Toast
├── cmdk.tsx           🔲 specialist: Command / Combobox
└── react-day-picker.tsx  🔲 specialist: Calendar / DatePicker
```

(No Zag/Ark. shadcn is not an adapter.)

## `veryfront/chat` — `src/react/components/chat/`

```
chat/
├── chat/                         ✅ compound engine (composition/, components/,
│                                    contexts/, hooks/, persistence/, utils/)
│   ├── hooks/use-chat-input.ts   ✅ (+ use-stick-to-bottom → useChatScroll superset)
│   ├── composability.contract.test.tsx  ✅ every compound registered
│   ├── collections.contract.test.tsx    ✅
│   └── <component>.test.tsx       🔲 per-component behaviour, all 25
├── coverage.test.tsx             🔲 deterministic gate for chat comps + hooks
├── blackbox-contract.test.tsx    ✅ backward-compat freeze
└── index.ts (→ src/chat/index.ts + index.test.ts)  ✅ public entry + freeze
```

## Stories — `storybook/stories/`

```
stories/
├── ui/<Component>.stories.tsx     🔲 one per veryfront/ui component (many ✅)
└── chat/<Component>.stories.tsx    🔲 one per veryfront/chat component (some ✅)
```

## Docs — `docs/guides/`

```
guides/
├── ui-components.md               ✅ primitives + composition rules + adapters
├── ui-adapters.md                 🔲 one page per engine adapter (Base UI/Radix/…)
├── chat-ui.md                     ✅ (update to L1/L2/L3 + new hooks)
├── chat-hooks.md                  ✅ (useChatInput/useChatScroll/useMessageBranches)
└── components/<name>.md           🔲 optional shadcn-style per-component pages
```

## Reproductions — `veryfront-examples/veryfront-router-testing/`

```
veryfront-router-testing/
├── chat-blackbox/       ✅ L1 (no config)
├── chat-custom-ui/      ✅ L2
├── chat-full-custom/    ✅ L3 (Base UI swap)
├── adapter-interop/     🔲 swap engines via UIAdapterProvider, verify each
├── check-chat-demos.sh  ✅ boot + SSR-render gate for all examples
└── LOCALDEV.md          ✅ (ports table includes the demos)
```

Acceptance: every example boots with **zero client + server errors** against this branch.
