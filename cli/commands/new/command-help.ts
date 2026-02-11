import type { CommandHelp } from "../../help/types.ts";

export const newHelp: CommandHelp = {
  name: "new",
  description: "Create, preview, and deploy a new project in one command",
  usage: "veryfront new <name> [options]",
  options: [
    {
      flag: "-t, --template <name>",
      description:
        "Project template (chat | rag | multi-agent | workflow | coding-agent | saas | minimal)",
      default: "chat",
    },
    {
      flag: "-p, --port <number>",
      description: "Dev server port",
      default: "3000",
    },
    {
      flag: "--deploy",
      description: "Deploy to cloud after scaffolding (requires auth)",
    },
    {
      flag: "--no-open",
      description: "Don't open browser automatically",
    },
    {
      flag: "-f, --force",
      description: "Overwrite existing directory",
    },
  ],
  examples: [
    "veryfront new my-agent",
    "veryfront new my-rag -t rag",
    "veryfront new my-app --deploy",
    "veryfront new my-app --port 8080",
  ],
  notes: [
    "Lightning-fast project creation for pro coders",
    "Creates project, starts dev server, and deploys with one command",
    "Press Enter to deploy after preview, Ctrl+C to exit",
    "Uses chat template by default with placeholder env values",
  ],
};
