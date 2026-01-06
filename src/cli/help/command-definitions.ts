/**
 * CLI command definitions and documentation
 * @module
 */

import type { CommandRegistry } from "./types.ts";

/**
 * Complete registry of all available CLI commands with their help information
 */
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
      "veryfront build --preset embedded  # writes dist/embedded/*",
      "veryfront build --include /docs --exclude /api",
      "veryfront build --dry-run",
    ],
  },
  serve: {
    name: "serve",
    description: "Start production server",
    usage: "veryfront serve [options]",
    options: [
      {
        flag: "-p, --port <number>",
        description: "Port to run on",
        default: "3000",
      },
      {
        flag: "--hostname <host>",
        description: "Hostname to bind to",
        default: "0.0.0.0",
      },
    ],
    examples: [
      "veryfront serve",
      "veryfront serve --port 8080",
      "VERYFRONT_USE_REDIS_CACHE=1 veryfront serve",
    ],
  },
  doctor: {
    name: "doctor",
    description: "Check system requirements and project health",
    usage: "veryfront doctor [options]",
    options: [
      {
        flag: "-s, --strict",
        description: "Treat warnings as errors",
      },
    ],
    examples: ["veryfront doctor", "veryfront doctor --strict"],
  },
  clean: {
    name: "clean",
    description: "Clean build artifacts and caches",
    usage: "veryfront clean [options]",
    options: [
      {
        flag: "--cache",
        description: "Clean cache only",
      },
      {
        flag: "--build",
        description: "Clean build output only",
      },
      {
        flag: "--all",
        description: "Clean everything (node_modules, .deno, .veryfront)",
      },
      {
        flag: "-f, --force",
        description: "Skip confirmation prompts",
      },
    ],
    examples: [
      "veryfront clean",
      "veryfront clean --cache",
      "veryfront clean --all",
      "veryfront clean --all --force",
    ],
    notes: ["The --all option requires confirmation unless --force is used"],
  },
  routes: {
    name: "routes",
    description: "List all discovered routes in your application",
    usage: "veryfront routes [options]",
    options: [
      {
        flag: "-j, --json",
        description: "Output as JSON",
      },
    ],
    examples: ["veryfront routes", "veryfront routes --json"],
  },
  lock: {
    name: "lock",
    description: "Manage remote import lockfile for reproducible builds",
    usage: "veryfront lock [options]",
    options: [
      {
        flag: "-l, --list",
        description: "List all locked imports",
      },
      {
        flag: "-u, --update",
        description: "Update all locked imports to latest versions",
      },
      {
        flag: "--verify",
        description: "Verify integrity of locked imports",
      },
      {
        flag: "--clear",
        description: "Clear the lockfile",
      },
      {
        flag: "-f, --force",
        description: "Skip confirmation prompts",
      },
    ],
    examples: [
      "veryfront lock                # List locked imports",
      "veryfront lock --list",
      "veryfront lock --verify       # Check integrity",
      "veryfront lock --update       # Refresh all entries",
      "veryfront lock --clear        # Remove lockfile",
    ],
    notes: [
      "The lockfile (veryfront.lock) is created automatically during 'veryfront dev'",
      "Remote imports from esm.sh are locked with URL and integrity hash",
      "Commit veryfront.lock to version control for reproducible builds",
    ],
  },
  "analyze-chunks": {
    name: "analyze-chunks",
    description: "Analyze bundle chunks and sizes",
    usage: "veryfront analyze-chunks [options]",
    options: [
      {
        flag: "-o, --output <file>",
        description: "Output analysis to file",
      },
    ],
    examples: [
      "veryfront analyze-chunks",
      "veryfront analyze-chunks --output bundle-analysis.json",
    ],
  },
  generate: {
    name: "generate",
    description: "Generate code scaffolds",
    usage: "veryfront generate <type> [name]",
    options: [],
    examples: [
      "veryfront generate page about",
      "veryfront generate layout admin",
      "veryfront generate api users/[id]",
      "veryfront generate provider auth",
      "veryfront generate integration             # Interactive wizard",
      "veryfront generate integration twilio      # With name preset",
    ],
    notes: [
      "Types: page, layout, provider, api, integration",
      "Integration type launches interactive wizard if name not provided",
    ],
  },
  pull: {
    name: "pull",
    description: "Download project content from Veryfront remote",
    usage: "veryfront pull [options]",
    options: [
      {
        flag: "-d, --dir <path>",
        description: "Target directory (default: current directory)",
      },
      {
        flag: "-b, --branch <name>",
        description: "Branch to pull from (default: main)",
      },
      {
        flag: "--types <list>",
        description: "Entity types to include (page,component,function,virtualFile)",
      },
      {
        flag: "-f, --force",
        description: "Force overwrite without confirmation",
      },
      {
        flag: "--dry-run",
        description: "Show what would be written without writing",
      },
    ],
    examples: [
      "veryfront pull",
      "veryfront pull --dir ./my-project",
      "veryfront pull --branch feature-header",
      "veryfront pull --types page,component",
      "veryfront pull --dry-run",
      "veryfront pull --force",
    ],
    notes: [
      "Requires VERYFRONT_API_TOKEN env var or .veryfrontrc config",
      "Project slug is inferred from package.json name or directory",
    ],
  },
  push: {
    name: "push",
    description: "Create a branch and upload local content to Veryfront",
    usage: "veryfront push [options]",
    options: [
      {
        flag: "-d, --dir <path>",
        description: "Source directory (default: current directory)",
      },
      {
        flag: "-b, --branch <name>",
        description: "Branch name to create (default: cli/push-<timestamp>)",
      },
      {
        flag: "--types <list>",
        description: "Entity types to include (page,component,function,virtualFile)",
      },
      {
        flag: "-f, --force",
        description: "Push without confirmation",
      },
      {
        flag: "--dry-run",
        description: "Show what would be uploaded without uploading",
      },
    ],
    examples: [
      "veryfront push",
      "veryfront push --dir ./my-project",
      "veryfront push --branch feature-header",
      "veryfront push --types page,component",
      "veryfront push --dry-run",
    ],
    notes: [
      "Requires VERYFRONT_API_TOKEN env var or .veryfrontrc config",
      "Creates a new branch for each push - merge in Studio",
      "Scans app/ for pages, components/ for components, functions/ for functions",
    ],
  },
};
