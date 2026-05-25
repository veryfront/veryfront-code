/**
 * Core skills embedded as data for compiled binary support.
 *
 * When running from source, the loader reads from cli/mcp/skills/.
 * When compiled, this module provides the same data without filesystem access.
 */

import type { LoadedSkill } from "./types.ts";

export const CORE_SKILLS: LoadedSkill[] = [
  {
    manifest: {
      name: "scaffold-app",
      version: "1.0.0",
      description: "Scaffold a new Veryfront app with the right structure, config, and conventions",
      requires: {
        cli: ["init", "dev", "doctor"],
        mcp: ["vf_list_templates", "vf_create_project"],
      },
      inputs: {
        name: { type: "string", description: "Project name" },
        template: {
          type: "string",
          default: "minimal",
          description: "Template to use",
        },
      },
    },
    skillMd: `# Scaffold App

Create a new Veryfront application with proper structure and conventions.

## Steps

1. **Discover templates**
   \`\`\`bash
   veryfront schema --json | jq '.commands[] | select(.name == "init")'
   \`\`\`

2. **Create project**
   \`\`\`bash
   veryfront init <name> --template <template> --yes --json
   \`\`\`
   Expected: \`{ "success": true, "command": "init", "data": { "projectDir": "..." } }\`

3. **Verify project health**
   \`\`\`bash
   cd <name>
   veryfront doctor --json
   \`\`\`

4. **Start dev server**
   \`\`\`bash
   veryfront dev
   \`\`\`

## Error Recovery

- **init fails**: Check template name, retry with --force
- **doctor fails**: Fix missing dependencies
- **dev fails**: Run veryfront clean, then retry`,
    directory: "core:scaffold-app",
  },
  {
    manifest: {
      name: "scaffold-ai-app",
      version: "1.0.0",
      description: "Scaffold a Veryfront app with AI tools, agent definitions, and knowledge base",
      requires: {
        cli: ["init", "dev", "doctor", "workflow"],
        mcp: ["vf_list_templates", "vf_create_project", "vf_scaffold"],
      },
      inputs: {
        name: { type: "string", description: "Project name" },
        provider: {
          type: "string",
          default: "anthropic",
          description: "LLM provider to configure",
        },
      },
    },
    skillMd: `# Scaffold AI App

Create a Veryfront app with AI capabilities.

## Steps

1. \`veryfront init <name> --template ai --yes --json\`
2. \`veryfront install --with ai --yes --json\`
3. Use vf_scaffold to generate AI components
4. Configure provider API key in .env
5. \`veryfront doctor --json\` then \`veryfront dev\`

## Error Recovery

- **Missing API key**: Set provider key in .env
- **Tool generation fails**: Use vf_get_conventions, scaffold manually`,
    directory: "core:scaffold-ai-app",
  },
  {
    manifest: {
      name: "deploy-safely",
      version: "1.0.0",
      description: "Build, test, deploy, and verify — with automatic rollback on failure",
      requires: {
        cli: ["build", "test", "deploy"],
        mcp: ["vf_get_errors"],
      },
      inputs: {
        environment: {
          type: "string",
          default: "production",
          description: "Target environment",
        },
        branch: {
          type: "string",
          default: "main",
          description: "Branch to deploy",
        },
      },
    },
    skillMd: `# Deploy Safely

Build, test, deploy, and verify — with rollback on failure.

## Steps

1. \`veryfront build --json\` — abort if success: false
2. \`veryfront test --json\` — abort if any test fails
3. \`veryfront deploy --env <environment> --branch <branch> --yes --json\`
4. Use vf_get_errors to verify no runtime errors after deploy
5. If errors: redeploy previous version

## Error Recovery

- **Build fails**: Check vf_get_errors, fix and retry
- **Tests fail**: Read JSON output, fix failing tests
- **Deploy fails**: Check environment, auth, branch
- **Post-deploy errors**: Redeploy previous release`,
    directory: "core:deploy-safely",
  },
  {
    manifest: {
      name: "debug-build",
      version: "1.0.0",
      description: "Diagnose and fix build failures using structured error output",
      requires: {
        cli: ["build", "doctor"],
        mcp: ["vf_get_errors", "vf_get_debug_context"],
      },
    },
    skillMd: `# Debug Build

Diagnose and fix build failures.

## Steps

1. \`veryfront build --json\` — capture error envelope
2. Use vf_get_errors and vf_get_debug_context for details
3. Common issues: import resolution, type errors, config errors
4. Apply fix, rebuild: \`veryfront build --json\`
5. \`veryfront doctor --json\` to verify health

## Error Recovery

- **Module not found**: Check deno.json imports map
- **Type errors**: Run deno check for diagnostics
- **Config invalid**: Compare against fresh veryfront init`,
    directory: "core:debug-build",
  },
  {
    manifest: {
      name: "debug-runtime",
      version: "1.0.0",
      description: "Diagnose runtime errors by connecting to dev server via MCP",
      requires: {
        cli: ["dev"],
        mcp: ["vf_get_errors", "vf_get_debug_context"],
      },
    },
    skillMd: `# Debug Runtime

Diagnose runtime errors via MCP.

## Steps

1. Ensure \`veryfront dev\` is running (MCP on the dev server port plus 2)
2. Use vf_get_errors for current runtime errors
3. Use vf_get_debug_context for stack traces
4. Read veryfront://logs resource for server logs
5. Identify failing route/component, fix source
6. HMR auto-reloads; use vf_get_errors to confirm fix

## Error Recovery

- **Dev server not running**: Start with veryfront dev
- **MCP not responding**: Check the printed MCP URL, restart
- **Error persists**: veryfront clean, restart dev`,
    directory: "core:debug-runtime",
  },
  {
    manifest: {
      name: "contribute",
      version: "1.0.0",
      description: "Onboard to veryfront-code — architecture, testing, conventions, PR process",
      requires: {
        cli: ["test", "lint", "schema"],
        mcp: ["vf_get_conventions"],
      },
    },
    skillMd: `# Contribute

Onboard to the veryfront-code repository.

## Steps

1. Read AGENTS.md and cli/AGENTS.md for conventions
2. Use vf_get_conventions for coding patterns
3. \`veryfront schema --json\` to understand available commands
4. Follow patterns: hash imports, defineError(), createArgParser()
5. \`veryfront test --json\` to run tests
6. \`veryfront lint --json\` to lint
7. \`deno fmt\` to format

## PR Checklist

- Tests pass (veryfront test)
- Lint clean (veryfront lint)
- Formatted (deno fmt --check)
- Commands registered in router.ts AND command-definitions.ts`,
    directory: "core:contribute",
  },
];
