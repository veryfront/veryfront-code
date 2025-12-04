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
        description:
          "Project template (pages-router | app-router | app-router-api | rsc-demo | blog | docs | app | minimal | ai)",
        default: "app-router",
      },
      {
        flag: "--app-router",
        description: "Use App Router (default)",
      },
      {
        flag: "--pages-router",
        description: "Use Pages Router",
      },
      {
        flag: "--cache-backend <type>",
        description: "Set render cache backend (memory | filesystem | kv | redis)",
        default: "memory",
      },
      {
        flag: "--skip-install",
        description: "Skip automatic dependency installation",
      },
      {
        flag: "--use-npm",
        description: "Use npm as the package manager",
      },
      {
        flag: "--use-yarn",
        description: "Use yarn as the package manager",
      },
      {
        flag: "--use-pnpm",
        description: "Use pnpm as the package manager",
      },
      {
        flag: "--use-bun",
        description: "Use bun as the package manager",
      },
    ],
    examples: [
      "veryfront init my-app",
      "veryfront init my-blog --template blog",
      "veryfront init my-docs --template docs",
      "veryfront init enterprise-app --template app",
      "veryfront init my-minimal-app --template minimal",
      "veryfront init my-ai-app --template ai",
      "veryfront init my-app --skip-install",
      "veryfront init my-app --use-pnpm",
    ],
    notes: [
      "Use --cache-backend to set render cache (memory | filesystem | kv | redis) during scaffolding",
      "Configure cache.render later in veryfront.config.js if you need to change it",
      "Set REDIS_URL for redis cache, cache.render.kvPath for Deno KV",
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
        default: "3002",
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
      "veryfront dev --port 3000",
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
        description: "Clean everything",
      },
    ],
    examples: ["veryfront clean", "veryfront clean --cache", "veryfront clean --all"],
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
    usage: "veryfront generate <type> <name>",
    options: [],
    examples: [
      "veryfront generate page about",
      "veryfront generate layout admin",
      "veryfront generate api users/[id]",
      "veryfront generate provider auth",
    ],
  },
};
