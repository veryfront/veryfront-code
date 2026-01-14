# Veryfront CLI - Claude Code Skill Map

This document explains how to use the Veryfront CLI with Claude Code to develop AI applications.

## Available Skills

| Skill | Command | Description |
|-------|---------|-------------|
| `veryfront-local-dev` | `/veryfront-local-dev` | Start all Veryfront services for local development |
| `veryfront-ops` | `/veryfront-ops` | Kubernetes operations (pods, logs, restarts) |
| `veryfront-create-prd` | `/veryfront-create-prd` | Generate a PRD for a new feature |
| `veryfront-verify` | `/veryfront-verify` | Full browser verification of local system |
| `veryfront-quick-check` | `/veryfront-quick-check` | Quick browser verification |
| `veryfront-e2e` | `/veryfront-e2e` | Full e2e test suite with browser automation |
| `veryfront-smoke-test` | `/veryfront-smoke-test` | Production smoke test |

## CLI Commands for AI App Development

### Project Setup

```bash
# Initialize a new AI agent project
veryfront init my-agent --template ai

# Initialize with service integrations
veryfront init my-agent --template ai --integrations gmail,slack,github

# Initialize from config file (CI/CD)
veryfront init --config project.json
```

### Development Workflow

```bash
# Start dev server with HMR
veryfront dev

# Start on custom port
veryfront dev --port 8080

# Open browser automatically
veryfront dev --open
```

### Building and Deployment

```bash
# Production build
veryfront build

# Build with custom output
veryfront build --output dist

# Build for embedded deployment
veryfront build --preset embedded
```

### Remote Synchronization

```bash
# Pull project from Veryfront cloud
veryfront pull

# Push local changes to a branch
veryfront push --branch=feature-x

# Merge branch into main
veryfront merge feature-x

# Deploy to production
veryfront deploy
```

## AI-Specific Features

### Agent Runtime

Veryfront provides built-in support for AI agents:

```typescript
// src/ai/agent/factory.ts
import { createAgent } from "veryfront/ai";

const agent = createAgent({
  model: "claude-3-opus",
  tools: [/* MCP tools */],
  memory: true,
});
```

### MCP Integration

Model Context Protocol (MCP) tools are first-class citizens:

```typescript
// Define MCP tools for your agent
import { defineTool } from "veryfront/ai";

const searchTool = defineTool({
  name: "search",
  description: "Search the web",
  parameters: z.object({
    query: z.string(),
  }),
  execute: async ({ query }) => {
    // Implementation
  },
});
```

### Workflow Orchestration

Build complex AI workflows:

```typescript
// src/ai/workflow/dsl/workflow.ts
import { workflow, step, parallel, branch } from "veryfront/ai/workflow";

const myWorkflow = workflow("process-document")
  .step("extract", extractStep)
  .parallel([
    step("analyze", analyzeStep),
    step("summarize", summarizeStep),
  ])
  .branch({
    condition: (ctx) => ctx.needsReview,
    yes: step("review", reviewStep),
    no: step("finalize", finalizeStep),
  });
```

## Project Structure

```
my-ai-app/
├── pages/
│   ├── index.tsx          # Main page
│   └── chat/
│       └── index.tsx      # Chat interface
├── api/
│   ├── chat.ts            # Chat API endpoint
│   └── webhooks/
│       └── slack.ts       # Slack webhook handler
├── agents/
│   ├── assistant.ts       # Main assistant agent
│   └── tools/
│       ├── search.ts      # Search tool
│       └── calendar.ts    # Calendar tool
├── workflows/
│   └── onboarding.ts      # Onboarding workflow
├── providers/
│   └── auth.tsx           # Auth provider
├── veryfront.config.ts    # Framework config
└── .veryfrontrc           # Remote sync config
```

## Code Generation

Use the `generate` command to scaffold:

```bash
# Generate a new page
veryfront generate page about

# Generate a new layout
veryfront generate layout admin

# Generate an API endpoint
veryfront generate api users/[id]

# Generate an auth provider
veryfront generate provider auth

# Generate a service integration
veryfront generate integration twilio
```

## Environment Configuration

### Local Development

```bash
# .env.local
VERYFRONT_API_TOKEN=vf_...
VERYFRONT_PROJECT_SLUG=my-project
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
```

### Production

Set environment variables in your deployment platform or use `.veryfrontrc`:

```json
{
  "projectSlug": "my-project",
  "apiUrl": "https://api.veryfront.com"
}
```

## Debugging

```bash
# Check project health
veryfront doctor

# Strict mode (warnings as errors)
veryfront doctor --strict

# List all routes
veryfront routes

# Output routes as JSON
veryfront routes --json

# Analyze bundle chunks
veryfront analyze-chunks
```

## Best Practices for AI Apps

1. **Use typed schemas**: Define Zod schemas for all tool inputs/outputs
2. **Implement retry logic**: Use exponential backoff for API calls
3. **Stream responses**: Use streaming for better UX in chat interfaces
4. **Cache aggressively**: Cache LLM responses when appropriate
5. **Monitor costs**: Track token usage and set budgets
6. **Test workflows**: Write integration tests for critical workflows
7. **Version your prompts**: Keep prompts in version control
