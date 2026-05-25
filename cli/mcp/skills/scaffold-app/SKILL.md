# Scaffold App

Create a new Veryfront application with proper structure and conventions.

## Steps

1. **Discover templates**
   ```bash
   veryfront schema --json | jq '.commands[] | select(.name == "init")'
   ```

2. **Create project**
   ```bash
   veryfront init <name> --template <template> --yes --json
   ```
   Expected: `{ "success": true, "command": "init", "data": { "projectDir": "..." } }`

3. **Verify project health**
   ```bash
   cd <name>
   veryfront doctor --json
   ```
   Expected: all checks pass

4. **Start dev server**
   ```bash
   veryfront dev
   ```
   Verify MCP is available at the printed dev MCP URL. The default URL is
   `http://localhost:3002/mcp`.

## Error Recovery

- **init fails**: Check template name with `veryfront schema --json`, retry with `--force`
- **doctor fails**: Read the check details, fix missing dependencies
- **dev fails**: Run `veryfront clean`, then retry
