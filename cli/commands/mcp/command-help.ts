import type { CommandHelp } from "../../help/types.ts";
import { DEFAULT_DEV_MCP_PORT } from "../../shared/constants.ts";

export const mcpHelp: CommandHelp = {
  name: "mcp",
  category: "ai",
  description: "Start MCP server for coding agents",
  usage: "veryfront mcp",
  options: [],
  examples: [
    "veryfront mcp                                  # Start stdio MCP server",
    `veryfront dev                                  # HTTP MCP on --port + 2 (default ${DEFAULT_DEV_MCP_PORT})`,
  ],
  notes: [
    "Used by Claude Code, Cursor, and other AI coding assistants",
    "Two transport modes:",
    `  • HTTP: Auto-starts with 'veryfront dev' (--port + 2, default ${DEFAULT_DEV_MCP_PORT})`,
    "  • stdio: Run 'veryfront mcp' for stdin/stdout communication",
    "The CLI MCP server is development-only. Production start does not expose vf_* tools.",
    "",
    "Claude Code setup (~/.claude.json):",
    `  "mcpServers": { "veryfront": { "url": "http://veryfront.me:${DEFAULT_DEV_MCP_PORT}/mcp" } }`,
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
