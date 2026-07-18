/**
 * Core skills embedded as data for compiled binary support.
 *
 * When running from source, the loader reads from cli/mcp/skills/.
 * When compiled, this module provides the same data without filesystem access.
 */

import type { LoadedSkill } from "./types.ts";

export const CORE_SKILLS: LoadedSkill[] = [
  {
    metadata: {
      name: "scaffold-app",
      description: "Scaffold a new Veryfront app with the right structure, config, and conventions",
      metadata: { version: "1.0.0" },
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
    metadata: {
      name: "scaffold-ai-app",
      description: "Scaffold a Veryfront app with AI tools, agent definitions, and knowledge base",
      metadata: { version: "1.0.0" },
    },
    skillMd: `# Scaffold AI App

Create a Veryfront app with AI capabilities.

## Steps

1. \`veryfront init <name> --template ai-agent --yes --json\`
2. Use vf_scaffold to generate agents, tools, prompts, and workflows
3. Add an app route such as app/api/ag-ui/route.ts
4. Configure the provider token in .env
5. \`veryfront doctor --json\` then \`veryfront dev\`

## Error Recovery

- **Missing provider token**: Set the expected provider token in .env
- **Tool generation fails**: Use vf_get_conventions, scaffold manually`,
    directory: "core:scaffold-ai-app",
  },
  {
    metadata: {
      name: "deploy-safely",
      description: "Build, test, push, deploy, and verify with rollback through Git on failure",
      metadata: { version: "1.0.0" },
    },
    skillMd: `# Deploy Safely

Build and test the reviewed Git source, then push it to Veryfront before creating a release and deployment. If verification fails, revert the Git commit and run the normal delivery sequence again.

## Steps

1. \`veryfront build --json\`, abort if success is false
2. \`veryfront test --json\`, abort if any test fails
3. \`veryfront push --branch <branch> --yes\`, abort if any upload fails
4. \`veryfront deploy --env <environment> --branch <branch> --yes --json\`
5. Record the project, environment, release, deployment, and commit IDs
6. Use vf_get_errors to verify no runtime errors after deploy
7. If errors: run \`git revert <bad-commit>\` and \`git push origin <branch>\`, then let CI run steps 3 and 4 or repeat them manually

## Error Recovery

- **Build fails**: Check vf_get_errors, fix and retry
- **Tests fail**: Read the JSON output, fix failing tests
- **Push fails**: Fix the upload failure and rerun Push before Deploy
- **Deploy fails**: Check environment, auth, branch
- **Post-deploy errors**: Revert the failing Git commit, push the revert, then run the normal Push and Deploy sequence`,
    directory: "core:deploy-safely",
  },
  {
    metadata: {
      name: "debug-build",
      description: "Diagnose and fix build failures using structured error output",
      metadata: { version: "1.0.0" },
    },
    skillMd: `# Debug Build

Diagnose and fix build failures.

## Steps

1. \`veryfront build --json\`, capture error envelope
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
    metadata: {
      name: "debug-runtime",
      description: "Diagnose runtime errors by connecting to dev server via MCP",
      metadata: { version: "1.0.0" },
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
    metadata: {
      name: "contribute",
      description: "Onboard to veryfront-code architecture, testing, conventions, and PR process",
      metadata: { version: "1.0.0" },
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
