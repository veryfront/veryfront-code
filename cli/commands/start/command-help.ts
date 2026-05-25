import type { CommandHelp } from "../../help/types.ts";

export const startHelp: CommandHelp = {
  name: "start",
  category: "project",
  description: "Start the production dashboard and proxy server",
  usage: "veryfront start [options]",
  options: [
    {
      flag: "-p, --port <number>",
      description: "Port to run on",
      default: "8080",
    },
    {
      flag: "--project <path>",
      description: "Path to a Veryfront project directory (single-project mode)",
    },
    {
      flag: "--headless, --no-tui",
      description: "Run without terminal UI (for coding agents)",
    },
  ],
  examples: [
    "veryfront start",
    "veryfront start --port 9000",
    "veryfront start --project ./my-app",
    "veryfront start --headless",
  ],
  notes: [
    "Veryfront supports two modes:",
    "",
    "  Single project — run inside a project directory, or use --project <path>.",
    "  A project is any folder with an app/, pages/, or components/ directory.",
    "",
    "  Workspace — run from a parent directory containing a projects/ folder.",
    "  Each subfolder in projects/ that has app/, pages/, or components/ is",
    "  auto-discovered and served. A project picker UI is shown at the root URL.",
    "",
    "  Workspace layout:",
    "    my-workspace/",
    "      projects/",
    "        site-a/        # auto-discovered",
    "          app/",
    "        site-b/        # auto-discovered",
    "          app/",
  ],
};
