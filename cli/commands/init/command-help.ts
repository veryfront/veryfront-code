import type { CommandHelp } from "../../help/types.ts";

export const initHelp: CommandHelp = {
  name: "init",
  description: "Initialize a new Veryfront project",
  usage: "veryfront init [project-name] [options]",
  options: [
    {
      flag: "-t, --template <name>",
      description: "Project template (ai | app | blog | docs | minimal)",
      default: "ai",
    },
    {
      flag: "--integrations <list>",
      description: "Service integrations for AI template (gmail,slack,github,calendar)",
    },
    {
      flag: "-c, --config <file>",
      description: "JSON config file for programmatic scaffolding",
    },
    {
      flag: "--skip-install",
      description: "Skip automatic dependency installation",
    },
    {
      flag: "--skip-env-prompt",
      description: "Skip environment variable prompts",
    },
  ],
  examples: [
    "veryfront init                              # Interactive wizard",
    "veryfront init my-app",
    "veryfront init my-agent --template ai --integrations gmail,slack",
    "veryfront init my-blog --template blog",
    "veryfront init my-docs --template docs",
    "veryfront init --config project.json       # From config file",
  ],
  notes: [
    "Run without arguments for interactive wizard",
    "Using --integrations implies --template ai",
    "Config file supports: name, template, integrations, skipInstall, skipEnvPrompt, env",
    "Use env object to pre-fill credentials: { env: { GOOGLE_CLIENT_ID: '...', ... } }",
  ],
};
