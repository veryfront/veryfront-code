# Module Boundaries

```bash
deno task check:circular  # Verify no circular deps
```

- Import from `#veryfront/<module>`, not internal files
- New modules need alias in `deno.json` imports

**Details**: See `src/README.md` for module hierarchy.