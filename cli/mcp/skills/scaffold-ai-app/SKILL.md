# Scaffold AI App

Create a Veryfront app with AI capabilities — tools, agents, and knowledge base.

## Steps

1. **Create base project**
   ```bash
   veryfront init <name> --template ai --yes --json
   ```

2. **Install AI integration**
   ```bash
   cd <name>
   veryfront install --with ai --yes --json
   ```

3. **Scaffold AI components** (via MCP)
   Use `vf_scaffold` tool to generate:
   - `app/api/ai/route.ts` — AI API endpoint
   - `lib/tools.ts` — Tool definitions
   - `lib/agents.ts` — Agent configuration

4. **Configure provider**
   Set `ANTHROPIC_API_KEY` (or provider-specific key) in `.env`.

5. **Verify**
   ```bash
   veryfront doctor --json
   veryfront dev
   ```

## Error Recovery

- **Missing API key**: Check `.env` file, ensure provider key is set
- **Tool generation fails**: Use `vf_get_conventions` to check patterns, scaffold manually
- **Provider not found**: Check `src/provider/` for supported providers
