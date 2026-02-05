import type { CommandHelp } from "../../help/types.ts";

export const mcpHelp: CommandHelp = {
  name: "mcp",
  description: "Start MCP server for coding agents",
  usage: "veryfront mcp",
  options: [],
  examples: [
    "veryfront mcp                                  # Start stdio MCP server",
    "deno task start                                # HTTP MCP auto-starts on port 9999",
  ],
  notes: [
    "Used by Claude Code, Cursor, and other AI coding assistants",
    "Two transport modes:",
    "  • HTTP: Auto-starts with 'deno task start' on port 9999",
    "  • stdio: Run 'veryfront mcp' for stdin/stdout communication",
    "",
    "Claude Code setup (~/.claude.json):",
    '  "mcpServers": { "veryfront": { "url": "http://veryfront.me:9999/mcp" } }',
    "",
    "Available tools:",
    "  • vf_list_local_projects  - Discover projects on filesystem",
    "  • vf_list_templates       - Browse project templates",
    "  • vf_list_integrations    - Browse 50+ service integrations",
    "  • vf_create_project       - Create new project from template",
    "  • vf_get_errors           - Real-time compile/runtime errors",
    "  • vf_preview_route        - HTTP response without browser",
    "  • vf_scaffold             - Generate pages/APIs/components/tools",
    "  • vf_list_routes          - Structured route manifest",
    "  • vf_trigger_hmr          - Force browser refresh",
  ],
};
