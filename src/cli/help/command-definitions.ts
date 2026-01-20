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
  studio: {
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
    description: "Download project files from Veryfront remote",
    usage: "veryfront pull [options]",
    options: [
      {
        flag: "--projects <slugs>",
        description: "Comma-separated list of project slugs to pull",
      },
      {
        flag: "-d, --dir <path>",
        description: "Target directory (default: current directory)",
      },
      {
        flag: "-b, --branch <name>",
        description: "Branch to pull from (default: main)",
      },
      {
        flag: "--env <name>",
        description: "Environment to pull from (e.g., production, staging)",
      },
      {
        flag: "--release <version>",
        description: "Release version to pull from (e.g., v1.2.0)",
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
      "veryfront pull --env production",
      "veryfront pull --release v1.2.0",
      "veryfront pull --projects project-a,project-b,project-c",
      "veryfront pull --projects my-app --dir ./apps",
      "veryfront pull --dry-run",
      "veryfront pull --force",
    ],
    notes: [
      "Requires VERYFRONT_API_TOKEN env var or .veryfrontrc config",
      "Project slug is inferred from package.json name or directory",
      "With --projects, each project is pulled into a subdirectory named after the slug",
      'Projects list can also be specified in .veryfrontrc: { "projects": ["slug1", "slug2"] }',
      "Priority order: --env > --release > --branch > main",
    ],
  },
  push: {
    name: "push",
    description: "Create a branch and upload local files to Veryfront",
    usage: "veryfront push [options]",
    options: [
      {
        flag: "-d, --dir <path>",
        description: "Source directory (default: current directory)",
      },
      {
        flag: "-b, --branch <name>",
        description: "Branch name (default: cli/push-<timestamp>, use 'main' for direct push)",
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
      "veryfront push --branch main             # Push directly to main",
      "veryfront push --dry-run",
    ],
    notes: [
      "Requires VERYFRONT_API_TOKEN env var or .veryfrontrc config",
      "Creates a new branch for each push - merge in Studio",
      "Use --branch=main to push directly without creating a branch",
      "Uploads all files using their relative paths",
    ],
  },
  merge: {
    name: "merge",
    description: "Merge a branch into main (or another branch)",
    usage: "veryfront merge <branch> [options]",
    options: [
      {
        flag: "--into <branch>",
        description: "Target branch to merge into (default: main)",
      },
      {
        flag: "-f, --force",
        description: "Merge without confirmation",
      },
      {
        flag: "--dry-run",
        description: "Preview merge without executing",
      },
    ],
    examples: [
      "veryfront merge feature-login",
      "veryfront merge hotfix --into staging",
      "veryfront merge feature-header --dry-run",
    ],
    notes: [
      "Requires VERYFRONT_API_TOKEN env var or .veryfrontrc config",
      "Use --dry-run to preview which files would be merged",
      "Conflicts are reported but must be resolved in Studio",
    ],
  },
  deploy: {
    name: "deploy",
    description: "Create a release and deploy to an environment",
    usage: "veryfront deploy [options]",
    options: [
      {
        flag: "-b, --branch <name>",
        description: "Branch to release from (default: main)",
      },
      {
        flag: "--env <name>",
        description: "Environment to deploy to (default: production)",
      },
      {
        flag: "--release-name <name>",
        description: "Custom release name (auto-generated if omitted)",
      },
      {
        flag: "-f, --force",
        description: "Deploy without confirmation",
      },
      {
        flag: "--dry-run",
        description: "Preview without executing",
      },
    ],
    examples: [
      "veryfront deploy",
      "veryfront deploy --env staging",
      "veryfront deploy --branch feature-x --env preview",
      "veryfront deploy --release-name v1.2.0",
      "veryfront deploy --dry-run",
    ],
    notes: [
      "Requires VERYFRONT_API_TOKEN env var or .veryfrontrc config",
      "Creates a new release from the specified branch",
      "Deploys the release to the target environment",
    ],
  },
  up: {
    name: "up",
    description: "Deploy your app with one command (login, create, push, deploy)",
    usage: "veryfront up [options]",
    options: [
      {
        flag: "-f, --force",
        description: "Skip interactive prompts",
      },
      {
        flag: "--dry-run",
        description: "Preview without executing",
      },
    ],
    examples: [
      "veryfront up",
      "veryfront up --dry-run",
      "veryfront up --force",
    ],
    notes: [
      "This is the default command when running 'veryfront' without arguments",
      "Automatically handles: authentication, project creation, push, and deploy",
      "Opens browser for login if not authenticated",
      "Creates a new project if code exists but no .veryfrontrc",
    ],
  },
  new: {
    name: "new",
    description: "Create, preview, and deploy a new project in one command",
    usage: "veryfront new <name> [options]",
    options: [
      {
        flag: "-t, --template <name>",
        description: "Project template (ai | app | blog | docs | minimal)",
        default: "ai",
      },
      {
        flag: "-p, --port <number>",
        description: "Dev server port",
        default: "3000",
      },
      {
        flag: "--skip-deploy",
        description: "Just scaffold, don't start server or deploy",
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
      "veryfront new my-blog -t blog",
      "veryfront new my-app --skip-deploy",
      "veryfront new my-app --port 8080",
    ],
    notes: [
      "Lightning-fast project creation for pro coders",
      "Creates project, starts dev server, and deploys with one command",
      "Press Enter to deploy after preview, Ctrl+C to exit",
      "Uses AI template by default with placeholder env values",
    ],
  },
  login: {
    name: "login",
    description: "Authenticate with Veryfront",
    usage: "veryfront login [options]",
    options: [
      {
        flag: "--google",
        description: "Login with Google OAuth",
      },
      {
        flag: "--github",
        description: "Login with GitHub OAuth",
      },
      {
        flag: "--microsoft",
        description: "Login with Microsoft OAuth",
      },
      {
        flag: "--token",
        description: "Enter API token manually",
      },
    ],
    examples: [
      "veryfront login",
      "veryfront login --google",
      "veryfront login --github",
      "veryfront login --microsoft",
      "veryfront login --token",
    ],
    notes: [
      "Without options, prompts for authentication method",
      "OAuth methods open browser for authentication",
      "Token is stored in ~/.config/veryfront/token",
    ],
  },
  logout: {
    name: "logout",
    description: "Clear stored authentication credentials",
    usage: "veryfront logout",
    options: [],
    examples: ["veryfront logout"],
    notes: [
      "Removes token from ~/.config/veryfront/token",
      "Does not affect VERYFRONT_API_TOKEN environment variable",
    ],
  },
  whoami: {
    name: "whoami",
    description: "Show current authenticated user",
    usage: "veryfront whoami",
    options: [],
    examples: ["veryfront whoami"],
    notes: [
      "Shows email and name of authenticated user",
      "Checks both environment variable and stored token",
    ],
  },
  install: {
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
  },
  uninstall: {
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
  },
  demo: {
    name: "demo",
    description: "Interactive guided tour of Veryfront CLI",
    usage: "veryfront demo [project-name] [options]",
    options: [
      { flag: "--auto", description: "Auto-advance through steps after 3 seconds" },
      {
        flag: "--login <method>",
        description: "Pre-select login method (google, github, microsoft, token)",
      },
    ],
    examples: [
      "veryfront demo                                 # Uses unique 'demo-{random}' name",
      "veryfront demo my-first-app                   # Specify project name",
      "veryfront demo --auto --login google          # Auto mode with Google login",
    ],
    notes: [
      "Walks through login, project creation, dev server, and deployment",
      "Press Enter to continue through each step",
      "Press Ctrl+C to exit at any time",
      "All commands execute for real - creates an actual project and deploys it",
      "Use --auto for automated demos or recordings",
    ],
  },
  mcp: {
    name: "mcp",
    description: "Start MCP server for coding agents",
    usage: "veryfront mcp",
    options: [],
    examples: [
      "veryfront mcp                                  # Start stdio MCP server",
      "deno task start                                # HTTP MCP auto-starts on port 9999",
    ],
    notes: [
      "Used by Claude Code, Cursor, and other AI coding assistants",
      "Two transport modes:",
      "  • HTTP: Auto-starts with 'deno task start' on port 9999",
      "  • stdio: Run 'veryfront mcp' for stdin/stdout communication",
      "",
      "Claude Code setup (~/.claude.json):",
      '  "mcpServers": { "veryfront": { "url": "http://localhost:9999" } }',
      "",
      "Available tools:",
      "  • vf_list_local_projects  - Discover projects on filesystem",
      "  • vf_list_templates       - Browse project templates",
      "  • vf_list_integrations    - Browse 50+ service integrations",
      "  • vf_create_project       - Create new project from template",
      "  • vf_get_errors           - Real-time compile/runtime errors",
      "  • vf_preview_route        - HTTP response without browser",
      "  • vf_scaffold             - Generate pages/APIs/components/tools",
      "  • vf_list_routes          - Structured route manifest",
      "  • vf_trigger_hmr          - Force browser refresh",
    ],
  },
  issues: {
    name: "issues",
    description: "GitHub-compatible file-based issue tracking",
    usage: "veryfront issues <subcommand> [options]",
    options: [
      {
        flag: "--title <string>",
        description: "Issue title (for create)",
      },
      {
        flag: "--type, -t <type>",
        description: "Type: issue, plan, milestone (default: issue)",
      },
      {
        flag: "--state <state>",
        description: "State: open, closed",
      },
      {
        flag: "--labels <list>",
        description: "Comma-separated labels (e.g., bug,priority:high)",
      },
      {
        flag: "--milestone <name>",
        description: "Milestone name",
      },
      {
        flag: "--assignee <user>",
        description: "Assignee username",
      },
      {
        flag: "--json",
        description: "Output as JSON",
      },
    ],
    examples: [
      "veryfront issues create --title 'Fix login bug' --labels bug,priority:high",
      "veryfront issues create --title 'Auth spec' --type plan",
      "veryfront issues list",
      "veryfront issues list --state open --labels bug",
      "veryfront issues view ISSUE-xxx",
      "veryfront issues edit ISSUE-xxx --state closed",
      "veryfront issues edit ISSUE-xxx --delete",
      "veryfront issues sync                 # Bi-directional GitHub sync",
      "veryfront issues sync pull            # Pull from GitHub",
      "veryfront issues sync push            # Push to GitHub",
    ],
    notes: [
      "GitHub-native structure:",
      "  • state: open | closed (like GitHub)",
      "  • labels: flexible tagging (bug, priority:high, status:blocked)",
      "  • Types stored as labels (type:issue, type:plan, type:milestone)",
      "",
      "Commands:",
      "  • create          - Create new issue",
      "  • list            - List issues by state",
      "  • view <id>       - View issue details",
      "  • edit <id>       - Edit or delete issue (--delete flag)",
      "  • sync [mode]     - Sync with GitHub Issues (pull, push, or bi-directional)",
      "",
      "GitHub sync:",
      "  • export GITHUB_OWNER=org GITHUB_REPO=repo GITHUB_TOKEN=ghp_xxx",
      "  • veryfront issues sync        # Full bi-directional sync",
      "  • veryfront issues sync pull   # Import from GitHub",
      "  • veryfront issues sync push   # Export to GitHub",
      "",
      "File format:",
      "  ---",
      "  id: ISSUE-xxx",
      "  title: Fix login bug",
      "  state: open",
      "  labels: [bug, priority:high]",
      "  assignees: [username]",
      "  ---",
      "  # Description",
      "  Content here...",
    ],
  },
  sdlc: {
    name: "sdlc",
    description: "Manage SDLC resources (legacy, use 'issues' instead)",
    usage: "veryfront sdlc <subcommand> [options]",
    options: [
      {
        flag: "--title <string>",
        description: "Resource title (for create)",
      },
      {
        flag: "--status <status>",
        description: "Status: todo, in_progress, blocked, in_review, done, cancelled",
      },
      {
        flag: "--priority <level>",
        description: "Priority: low, medium, high, critical",
      },
      {
        flag: "--milestone <id>",
        description: "Milestone ID",
      },
      {
        flag: "--assignee <name>",
        description: "Assignee name",
      },
      {
        flag: "--kind <type>",
        description: "Issue kind: bug, feature, enhancement, documentation",
      },
      {
        flag: "--json",
        description: "Output as JSON",
      },
    ],
    examples: [
      "veryfront sdlc create task --title 'Implement JWT auth' --priority high",
      "veryfront sdlc list task",
      "veryfront sdlc list issue --status in_progress",
      "veryfront sdlc show TASK-001",
      "veryfront sdlc update TASK-001 --status done",
      "veryfront sdlc delete TASK-001",
      "veryfront sdlc stats",
      "veryfront sdlc discover",
    ],
    notes: [
      "Resources stored as markdown + YAML frontmatter in issues/ (flat structure)",
      "Each issue is a single .md file with frontmatter metadata",
      "Subcommands:",
      "  • create <type>     - Create new resource (task, issue, plan, milestone, rfc)",
      "  • list [type]       - List resources (optionally filter by type)",
      "  • show <id>         - Show resource details",
      "  • update <id>       - Update resource metadata",
      "  • delete <id>       - Delete resource",
      "  • stats             - Show statistics",
      "  • discover          - Discover all resources",
      "",
      "All resources are git-friendly and AI-native",
      "Moving/editing files updates frontmatter automatically",
      "Use --json flag for programmatic access",
    ],
  },
};
