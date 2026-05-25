# Debug Runtime

Diagnose runtime errors by connecting to the dev server via MCP.

## Steps

1. **Ensure dev server is running**
   ```bash
   veryfront dev
   ```
   MCP is available on the dev server port plus 2. The default URL is
   `http://localhost:3002/mcp`.

2. **Check for errors** (via MCP)
   Use `vf_get_errors` to get current runtime errors.

3. **Get debug context** (via MCP)
   Use `vf_get_debug_context` for stack traces and request context.

4. **Read server logs** (via MCP resource)
   Read `veryfront://logs` for recent server log entries.

5. **Trace the issue**
   - Identify the failing route or component from error context
   - Read the source file
   - Check for common runtime issues: missing env vars, API failures, data fetch errors

6. **Fix and verify**
   Apply the fix. HMR will auto-reload.
   Use `vf_get_errors` to confirm the error is resolved.

## Error Recovery

- **Dev server not running**: Start with `veryfront dev`
- **MCP not responding**: Check the printed MCP URL, restart dev server
- **Error persists after fix**: Clear cache with `veryfront clean`, restart dev
