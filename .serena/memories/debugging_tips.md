# Debugging Tips

## Test Environment (Gotcha)
Tests need these env vars (already in deno.json tasks):
```bash
VF_DISABLE_LRU_INTERVAL=1
SSR_TRANSFORM_PER_PROJECT_LIMIT=0
REVALIDATION_PER_PROJECT_LIMIT=0
```

## Common Gotchas

1. **Logger debug not working**: Set `VERYFRONT_DEBUG=1`
2. **Test isolation failures**: Check env var pollution between tests
3. **SSR transform errors**: Ensure `ctx.filePath` is provided in test context

## Quick Debug
```bash
deno test --allow-all src/path/to/file.test.ts  # Single file
```