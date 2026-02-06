import type { CommandHelp } from "../../help/types.ts";

export const studioHelp: CommandHelp = {
  name: "studio",
  description: "Open Veryfront Studio in browser",
  usage: "veryfront studio [project] [options]",
  options: [
    {
      flag: "-b, --branch <name>",
      description: "Branch name to select",
    },
    {
      flag: "-f, --file <path>",
      description: "File path to open",
    },
  ],
  examples: [
    "veryfront studio",
    "veryfront studio --branch main",
    "veryfront studio myproject",
    "veryfront studio myproject --branch main --file /pages/index.mdx",
  ],
  notes: [
    "Project is auto-detected from veryfront.config.ts, package.json, or directory name",
  ],
};
