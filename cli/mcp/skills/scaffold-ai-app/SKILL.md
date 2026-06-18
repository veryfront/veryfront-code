---
name: scaffold-ai-app
description: Scaffold a Veryfront app with AI tools, agent definitions, and knowledge base.
metadata:
  version: "1.0.0"
---

# Scaffold AI App

Create a Veryfront app with AI capabilities: tools, agents, and project conventions.

## Steps

1. **Create base project**
   ```bash
   veryfront init <name> --template ai-agent --yes --json
   ```

2. **Scaffold AI primitives** (via MCP)
   Use `vf_scaffold` to generate project-root primitives:

   - `agents/<name>.ts` for reusable agent behavior
   - `tools/<name>.ts` for callable capabilities
   - `prompts/<name>.ts` for prompt templates
   - `workflows/<name>.ts` for multi-step coordination

3. **Add an app route**
   Use `vf_scaffold` with `type: "api"` to add a route such as
   `app/api/ag-ui/route.ts`, then wire it to the agent runtime.

4. **Configure inference**
   Set the model provider token required by the project in `.env`.

5. **Verify**
   ```bash
   veryfront doctor --json
   veryfront dev
   ```

## Error Recovery

- **Missing provider token**: Check `.env` file and ensure the expected token is set
- **Tool generation fails**: Use `vf_get_conventions` to check patterns, scaffold manually
- **Provider not found**: Check `src/provider/` for supported providers
