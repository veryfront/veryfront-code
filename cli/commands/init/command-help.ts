import type { CommandHelp } from "../../help/types.ts";

export const initHelp: CommandHelp = {
  name: "init",
  description: "Initialize a new Veryfront project",
  usage: "veryfront init [project-name] [options]",
  options: [
    {
      flag: "-t, --template <name>",
      description:
        "Project template (minimal | ai-agent | contract-review-agent | docs-agent | agentic-workflow | multi-agent-system | coding-agent | saas-starter)",
    },
    {
      flag: "--integrations <list>",
      description: "Service integrations for chat template (gmail,slack,github,calendar)",
    },
    {
      flag: "--deploy",
      description: "Deploy to cloud after scaffolding (requires auth)",
    },
    {
      flag: "-f, --force",
      description: "Overwrite existing directory",
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
    "veryfront init my-app --template ai-agent",
    "veryfront init my-rag --template docs-agent",
    "veryfront init my-pipeline --template agentic-workflow",
    "veryfront init my-app --deploy              # Create and deploy",
    "veryfront init --config project.json        # From config file",
  ],
  notes: [
    "Run without arguments for interactive wizard",
    "Interactive mode prompts for: location, template, and git initialization",
    "Use --deploy to create, push, and deploy in one step",
    "Config file supports: name, template, integrations, skipInstall, skipEnvPrompt, env",
  ],
};
