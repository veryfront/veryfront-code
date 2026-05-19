# Veryfront guides

This folder holds the source content for the published Veryfront user guides.

Guides are goal-oriented mini tutorials. Each one helps a reader accomplish a
single concrete task with the Veryfront library or CLI, end to end.

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

Each guide follows this structure:

1. **Goal**: what the reader will achieve.
2. **Prerequisites**: assumptions, required setup, or earlier guides.
3. **Walkthrough**: a short working example or CLI flow.
4. **Expected result**: what the reader should see.
5. **Verify it worked**: the command, request, or check that confirms it.
6. **Next** or **Related**: pointers to the next guide and the matching
   generated reference page.

Guides link to architecture pages only when runtime context helps the reader
make a decision.

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

This checks guide frontmatter, internal links, code-block balance, required
closing sections, and that every guide is listed in [`index.md`](./index.md).
When guide changes depend on public API copy, update source JSDoc and run
`deno task docs` before validation.

Every published guide must also have a contract test in
`tests/docs/guide-contracts.test.ts`. Add or update that test when you add a
guide, change its core workflow, or change its reference links.

Every guide with fenced code examples must have code-example coverage in
`tests/docs/guide-examples.test.ts` or
`tests/docs/guide-code-examples.test.ts`. The coverage guard fails validation
when a guide has runnable examples but no matching test entry.

## Related

- [`docs/reference/`](../reference/) for the public API reference.
- [`docs/architecture/`](../architecture/) for runtime and boundary
  explanations.
