---
name: debug-build
description: Diagnose and fix build failures using structured error output.
metadata:
  version: "1.0.0"
---

# Debug Build

Diagnose and fix build failures using structured error output.

## Steps

1. **Reproduce the failure**
   ```bash
   veryfront build --json
   ```
   Capture the error envelope.

2. **Get error context** (via MCP)
   Use `vf_get_errors` to get all current errors.
   Use `vf_get_debug_context` for additional context.

3. **Analyze errors**
   Common build error patterns:
   - Import resolution: missing module, wrong hash import path
   - Type errors: check `deno check` output
   - Config errors: verify `deno.json` and `veryfront.json`

4. **Fix and verify**
   Apply the fix, then rebuild:
   ```bash
   veryfront build --json
   ```

5. **Run health check**
   ```bash
   veryfront doctor --json
   ```

## Error Recovery

- **Module not found**: Check `deno.json` imports map, verify file exists
- **Type errors**: Run `deno check src/index.ts` for detailed diagnostics
- **Config invalid**: Compare against a working `deno.json` from a fresh `veryfront init`
