# Implementation progress — chat composition overhaul

Tracker for the execution branch (`mattboon/chat-e0-g1-tsc-gate`, off
`mattboon/veryfront-ui-namespace`). Companion to the plan/START-HERE on the
`mattboon/chat-composition-plan` branch. Tick items as they land; record the
commit.

## E0 — Enablement & gates
- [x] **Consumer `tsc` gate + the real G1 fix.** `deno task typecheck:consumer`
      typechecks documented `veryfront/ui`/`veryfront/chat` composition against
      the built `.d.ts` as an npm consumer compiles it. Root-caused + fixed the
      actual bug (dnt react-shim collapsed every `extends React.HTMLAttributes`
      component's props to `{}` for consumers — `children`/`className`/handlers
      all stripped; invisible to `deno check`). Fix in `build-npm-dnt.ts` maps
      react to the bare npm peer; build-time guard `assertConsumerReactImport`.
      *(supersedes the plan's per-interface "declare children" band-aid.)*
- [x] **Ratchet lints** — `deno task lint:chat-ratchets`
      (`scripts/lint/ban-chat-antipatterns.ts`) seeds baselines: forwardRef 29,
      feature-toggle booleans 29, passthrough props 14. Fails on any new
      violation; only shrinks. Wired into `verify` + CI lint job.
- [x] **K0 collections house-rule doc** — `docs/plans/K0-collections-house-rule.md`
      (4-tier pattern, grounded in the `Sources` exemplar).
- [x] **Composability contract — acid-test leaf-override probe** added to
      `composability.contract.test.tsx` (Sources exemplar).
- [ ] **Storybook three-tier harness assertion** — folds into E7 (tracking).

## E0.5 — Characterization safety net
- [ ] Characterization tests over the god file + untested components (must
      precede E1/E3).

## E2 — React 19 forwardRef codemod (safe, mechanical; burns the forwardRef ratchet → 0)
- [ ] In progress.

## E1 / E3 / E4 / E5 / E6 — context spine, state glue, depth
- [ ] Pending (gated behind E0.5 safety net + spec review per Q5).

## E7 — Storybook three-tier coverage
- [ ] Pending (folds per component).

## E8 / E9 / E10 / E11 — BREAKING batch + codemod + migration
- [ ] Pending. Additive replacements + deprecations land first; removals batch
      last. Do NOT execute destructive removals until replacement gates hit
      baseline 0 and the safety net is proven.
