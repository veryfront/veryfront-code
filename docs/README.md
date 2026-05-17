# Docs maintenance

Use this checklist when changing public behavior, public imports, runtime
boundaries, or docs structure.

## Update rules

- Update the guide page when behavior changes how a user builds with Veryfront.
- Update the reference page when a public import, export, option, type, or
  example changes.
- Update the architecture page when implementation ownership or runtime
  boundaries change.
- Add a new docs page only when it owns a separate concern.
- Keep one file focused on one concern. Link to related pages instead of
  expanding a page into a bundle.

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
