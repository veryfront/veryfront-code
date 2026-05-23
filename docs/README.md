# Docs maintenance

Use this checklist when changing public behavior, public imports, runtime
boundaries, or docs structure.

## Update rules

- Update the guide page when behavior changes how a user builds with Veryfront.
- Update source JSDoc when a public import, export, option, type, or example
  changes. Do not hand-edit generated API reference pages.
- Update the architecture page when implementation ownership or runtime
  boundaries change.
- Add a new docs page only when it owns a separate concern.
- Keep one file focused on one concern. Link to related pages instead of
  expanding a page into a bundle.

## Source layout

- `getting-started/`: Published onboarding flow.
- `guides/`: Published task guides and decision guides.
- `concepts/`: Published explanation docs for public mental models.
- `api-reference/`: Generated public API reference. The public overview is
  `api-reference/index.md`; do not use `README.md` for public pages.
- `architecture/`: Private Veryfront Code architecture notes. These docs are
  not part of the public docs sync.

## API reference generation

Public API reference pages in `docs/api-reference/veryfront/` are generated from
source JSDoc comments. Source comments own the public reference copy, and the
generator only renders them.

When a public API or its JSDoc changes, run:

```bash
deno task docs
deno task docs:validate
```

Commit the source JSDoc changes and the regenerated reference files together.
If validation reports missing declarations or placeholder wording, improve the
source JSDoc and rerun the generator.

## Validation

Run:

```bash
deno task docs:validate
```

This validates top-level API reference coverage, guide structure, guide imports,
guide ordering, and local Markdown links.

For release artifact checks, build npm output first and then run:

```bash
deno task build:npm
deno task docs:verify-npm
```
