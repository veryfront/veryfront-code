---
name: contribute
description: Onboard to veryfront-code architecture, testing, conventions, and PR process.
metadata:
  version: "1.0.0"
---

# Contribute

Onboard to the veryfront-code repository: architecture, testing, conventions, and PR process.

## Steps

1. **Read project documentation**
   - `AGENTS.md`: project overview, architecture, conventions
   - `cli/AGENTS.md`: CLI-specific conventions for adding commands

2. **Understand conventions** (via MCP)
   Use `vf_get_conventions` for coding patterns and style guide.

3. **Explore the schema**
   ```bash
   veryfront schema --json
   ```
   Understand available commands and their categories.

4. **Make changes**
   Follow the patterns in `AGENTS.md`:
   - Hash imports: `#veryfront/` for src, `#cli/` for CLI
   - Error handling: `defineError()` from error registry
   - Arg parsing: Zod + `createArgParser()`
   - New commands: `cli/commands/{name}/` with handler.ts, command.ts, command-help.ts

5. **Run tests**
   ```bash
   veryfront test --json
   ```

6. **Run linter**
   ```bash
   veryfront lint --json
   ```

7. **Format code**
   ```bash
   deno fmt
   ```

## PR Checklist

- [ ] Tests pass (`veryfront test`)
- [ ] Lint clean (`veryfront lint`)
- [ ] Formatted (`deno fmt --check`)
- [ ] No unused imports
- [ ] New commands registered in both `router.ts` and `command-definitions.ts`
