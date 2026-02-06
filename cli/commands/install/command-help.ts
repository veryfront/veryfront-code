import type { CommandHelp } from "../../help/types.ts";

export const installHelp: CommandHelp = {
  name: "install",
  description: "Install AI assistant integrations (Cursor, Claude Code, etc.)",
  usage: "veryfront install [options]",
  options: [
    {
      flag: "--target <tools>",
      description:
        "Comma-separated list of tools (cursor,claude-code,skill,copilot,windsurf,agents,all)",
    },
    {
      flag: "--global",
      description: "Install to home directory instead of project",
    },
    {
      flag: "-f, --force",
      description: "Overwrite existing files",
    },
  ],
  examples: [
    "veryfront install                              # Interactive multi-select",
    "veryfront install --target cursor",
    "veryfront install --target all",
    "veryfront install --target cursor,claude-code --force",
    "veryfront install --global                     # Install to ~/.cursorrules, etc.",
  ],
  notes: [
    "Auto-detects which AI tools are in use and pre-selects them",
    "Supports: Cursor, Claude Code, Agent Skills, GitHub Copilot, Windsurf, Codex/Gemini",
    "SKILL.md follows the open standard from agentskills.io",
  ],
};

export const uninstallHelp: CommandHelp = {
  name: "uninstall",
  description: "Remove AI assistant integrations",
  usage: "veryfront uninstall [options]",
  options: [
    {
      flag: "--target <tools>",
      description:
        "Comma-separated list of tools (cursor,claude-code,skill,copilot,windsurf,agents,all)",
    },
    {
      flag: "--global",
      description: "Remove from home directory instead of project",
    },
  ],
  examples: [
    "veryfront uninstall                            # Interactive multi-select",
    "veryfront uninstall --target cursor",
    "veryfront uninstall --target all",
    "veryfront uninstall --global",
  ],
  notes: [
    "Only shows files that exist in the project",
    "Removes empty parent directories (.claude, .github) after removal",
  ],
};
