/**
 * Help View
 *
 * Renders the keyboard shortcuts and MCP info screen.
 */

import { brand, dim } from "../../ui/colors.ts";
import type { AppState } from "../state.ts";

export function renderHelpView(state: AppState): string {
  const lines = [
    "",
    `  ${brand("Keyboard Shortcuts")}`,
    "",
    `  ${dim("Navigation")}`,
    `    ${brand("↑↓")} ${dim("or")} ${brand("jk")}    Navigate list`,
    `    ${brand("Tab")}         Switch sections`,
    `    ${brand("1-9")}         Quick select item`,
    `    ${brand("Enter")}       Select / Open in browser`,
    `    ${brand("Esc")}         Go back`,
    "",
    `  ${dim("Actions")}`,
    `    ${brand("o")}           Open in browser`,
    `    ${brand("s")}           Open in Studio`,
    `    ${brand("i")}           Open in IDE`,
    `    ${brand("p")}           Pull from remote`,
    `    ${brand("u")}           Push to remote`,
    "",
    `  ${dim("Auth")}`,
    `    ${brand("a")}           Login`,
    `    ${brand("x")}           Logout`,
    "",
    `  ${dim("Views")}`,
    `    ${brand("n")}           New project`,
    `    ${brand("l")}           Toggle logs`,
    `    ${brand("?")}           Help (this screen)`,
    "",
    `  ${dim("Other")}`,
    `    ${brand("q")}           Quit`,
    "",
  ];

  if (state.mcp.enabled) {
    lines.push(`  ${brand("MCP Server")}`);
    lines.push("");
    lines.push(`    ${dim("Add to your")} ${brand("~/.claude/settings.json")}${dim(":")}`);
    lines.push("");
    lines.push(`    ${dim('"mcpServers": {')}`);
    lines.push(`    ${dim('  "veryfront": {')}`);
    lines.push(`    ${dim('    "type": "url",')}`);
    lines.push(`    ${dim(`    "url": "http://veryfront.me:${state.mcp.httpPort}/mcp"`)}`);
    lines.push(`    ${dim("  }")}`);
    lines.push(`    ${dim("}")}`);
    lines.push("");
    lines.push(`    ${brand("m")}  ${dim("Open settings.json in IDE")}`);
    lines.push("");
    lines.push(`    ${dim("Tools:")} vf_list_routes, vf_scaffold, vf_get_errors, vf_get_logs`);
    lines.push("");
  }

  lines.push(`  ${dim("Press")} ${brand("Esc")} ${dim("to go back")}`);
  lines.push("");

  return lines.join("\n");
}
