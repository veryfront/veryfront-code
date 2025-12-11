
import type { CommandRegistry } from "./types.ts";

export const COMMANDS: CommandRegistry = {
  init: {
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
  },
  dev: {
    name: "dev",
    description: "Start development server with hot module replacement",
    usage: "veryfront dev [options]",
    options: [
      {
        flag: "-p, --port <number>",
        description: "Port to run on",
        default: "3000",
      },
      {
        flag: "--no-hmr",
        description: "Disable hot module replacement",
      },
      {
        flag: "--open",
        description: "Open browser automatically",
      },
    ],
    examples: [
      "veryfront dev",
      "veryfront dev --port 8080",
      "veryfront dev --open",
      "veryfront dev --no-hmr",
    ],
  },
  build: {
    name: "build",
    description: "Build your application for production",
    usage: "veryfront build [options]",
    options: [
      {
        flag: "-o, --output <dir>",
        description: "Output directory",
        default: ".veryfront/output",
      },
      {
        flag: "--no-compress",
        description: "Disable compression",
      },
      {
        flag: "--no-split",
        description: "Disable code splitting",
      },
      {
        flag: "--no-ssg",
        description: "Disable static generation",
      },
      {
        flag: "--include <paths>",
        description: "Include specific paths in SSG",
      },
      {
        flag: "--exclude <paths>",
        description: "Exclude paths from SSG",
      },
      {
        flag: "--dry-run",
        description: "Preview what will be built",
      },
      {
        flag: "--preset <name>",
        description: "Select build preset (e.g. embedded)",
      },
    ],
    examples: [
      "veryfront build",
      "veryfront build --output dist",
      "veryfront build --no-ssg",
      "veryfront build --preset embedded  # writes dist/embedded