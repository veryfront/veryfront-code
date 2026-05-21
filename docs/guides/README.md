# Veryfront guides

This folder holds the source content for the published Veryfront user guides.

Guides help a reader finish one task with the Veryfront library or CLI.

## What belongs here

A page belongs in `docs/guides/` when it:

- Targets one user goal: build, configure, run, deploy, or verify something.
- Walks through a working example or CLI flow the reader can run.
- States the expected result and how to confirm it worked.
- Links to generated API reference pages for full API details instead of
  repeating them.

A page does not belong here when it is:

- A full API catalog. That is generated into
  [`docs/reference/`](../reference/) from source JSDoc.
- A runtime or boundary explanation. That lives in
  [`docs/architecture/`](../architecture/).
- A duplicate of an existing guide with a different framing. Merge it into the
  existing guide instead.

## Page shape

Use this structure:

1. **Goal**: what the reader will achieve.
2. **Prerequisites**: assumptions, required setup, or earlier guides.
3. **Walkthrough**: a short working example or CLI flow.
4. **Expected result**: what the reader should see.
5. **Verify it worked**: the command, request, or check that confirms it.
6. **Next** or **Related**: next guide and matching reference page.

Link to architecture only when runtime context helps the reader choose.

## Copy rules

- Direct language, present tense, active voice.
- Sentence-case headings.
- No first-person product voice.
- Code examples are complete, copyable, and use placeholders for sensitive
  values.

## Validation

Run before committing:

```bash
deno task docs:validate
```

This checks frontmatter, links, code blocks, closing sections, and guide index
coverage. When guide changes depend on public API copy, update source JSDoc and
run `deno task docs` before validation.

Every published guide must have a contract test in
`tests/docs/guide-contracts.test.ts`. Add or update it when you add a guide,
change the core workflow, or change reference links.

Every guide with fenced code examples must have coverage in
`tests/docs/guide-examples.test.ts` or
`tests/docs/guide-code-examples.test.ts`. The coverage guard fails validation
when runnable examples have no matching test entry.

## Related

- [`docs/reference/`](../reference/) for the public API reference.
- [`docs/architecture/`](../architecture/) for runtime and boundary
  explanations.
