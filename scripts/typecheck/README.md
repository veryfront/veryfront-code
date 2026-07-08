# Consumer typecheck gate

`deno task typecheck:consumer` typechecks the documented `veryfront/ui` and
`veryfront/chat` composition **the way an external app compiles the published
package** — real `tsc --noEmit`, real `@types/react`, against the emitted
`.d.ts` in `npm/`.

## Why this exists (the gap it closes)

`deno task typecheck` runs `deno check`, which type-checks the **source** against
**Deno's** react types. Neither that nor a source-level `tsc` reflects what an npm
consumer's compiler sees. That blind spot shipped a real, severe regression:

- dnt bundled the repo's local `./react/*.ts` deno shims into a
  `npm/esm/react/react.js` module and rewrote every component import to it.
- That shim re-exports react's types via a multi-hop `export { HTMLAttributes, … }
  from …` chain. Through an `import * as React` namespace, that chain **collapses
  `interface Props extends React.HTMLAttributes<…>` to `{}`** in a consumer's
  compilation.
- Result: every component whose props extended `React.HTMLAttributes` (AppShell,
  Button, Card, Alert, … the whole kit) shipped with `children`, `className`,
  `style`, and every event handler **missing** from its public type — invisible
  to `deno check`, so it passed CI and reached consumers.

The fix (in `scripts/build/build-npm-dnt.ts`) maps the local react shims straight
to the bare `react` / `react-dom` npm specifiers, so emitted code does
`import … from "react"` and `React.HTMLAttributes` resolves against the
consumer's own `@types/react`. This gate is the regression guard.

> The plan's original "G1" framing — "React 19 dropped `children` from
> `HTMLAttributes`; re-declare it per interface" — was a **misdiagnosis**. React
> 19's `DOMAttributes` still carries `children`; the loss was a build-shim
> artifact, and it took `className`/handlers with it, so per-interface `children`
> declarations would have been a band-aid over a much larger hole.

## What it checks

- [`fixtures/ui-composition.tsx`](./fixtures/ui-composition.tsx) — AppShell
  compound, Alert/Card leaves, context-reading parts, all via `veryfront/ui`.
- [`fixtures/chat-composition.tsx`](./fixtures/chat-composition.tsx) — batteries
  `<Chat>`, the `<Chat.Root>` compound, `Message`, `ChatSidebar`, via
  `veryfront/chat`.

Add a fixture whenever a new public compound ships; keep them importing the
published specifiers (not relative `src` paths) so they exercise the real
declarations.

## Running

```
deno task typecheck:consumer     # builds npm/ if missing, then tsc
```

Requires the Storybook toolchain (the repo's only `tsc`): `npm --prefix storybook ci`.

## CI

Runs in `verify`. The natural CI home is a job that already has both the built
package and the Storybook toolchain; the npm-smoke job builds the package, so
wiring this alongside it (after `npm --prefix storybook ci`) is the intended
follow-up.
