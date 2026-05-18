# Veryfront guides

This folder holds the source content for the published Veryfront user guides.

Guides are goal-oriented mini tutorials. Each one helps a reader accomplish a
single concrete task with the Veryfront library or CLI, end to end.

## What belongs here

A page belongs in `docs/guides/` when it:

- Targets one user goal: build, configure, run, deploy, or verify something.
- Walks through a working example or CLI flow the reader can run.
- States the expected result and how to confirm it worked.
- Links to `docs/reference/*.md` for full API details instead of repeating them.

A page does not belong here when it is:

- A full API catalog. That lives in [`docs/reference/`](../reference/).
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
   reference page.

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

## Related

- [`docs/reference/`](../reference/) for the public API reference.
- [`docs/architecture/`](../architecture/) for runtime and boundary
  explanations.
