# Claude Code SDK Integration

Integrate Anthropic's Claude Code SDK into Veryfront workflows for powerful agentic coding capabilities.

## Overview

This module provides a harness for running Claude Code SDK agents within Veryfront's durable workflow system. It combines:

- **Claude Code SDK**: Anthropic's agentic coding capabilities (bash, file editing, computer use)
- **Veryfront Workflows**: Durability, multi-tenancy, human-in-the-loop
- **Tenant-Aware Operations**: File operations scoped to the current project

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Veryfront Workflow                          │
│  ┌─────────┐    ┌─────────────────┐    ┌─────────────────────┐  │
│  │  step   │───▶│ ClaudeCodeAgent │───▶│ waitForApproval     │  │
│  └─────────┘    └────────┬────────┘    └─────────────────────┘  │
│                          │                                       │
│         ┌────────────────┼────────────────┐                      │
│         ▼                ▼                ▼                      │
│  ┌────────────┐  ┌────────────┐  ┌────────────────┐             │
│  │ BashTool   │  │ FileTool   │  │ ComputerTool   │             │
│  │ (sandbox)  │  │ (api.files)│  │ (optional)     │             │
│  └────────────┘  └────────────┘  └────────────────┘             │
│         │                │                                       │
│         ▼                ▼                                       │
│  ┌────────────────────────────────────┐                         │
│  │     Tenant Context (AsyncLocal)    │                         │
│  │  - projectSlug, token, projectId   │                         │
│  └────────────────────────────────────┘                         │
└─────────────────────────────────────────────────────────────────┘
```

## Features

### 1. Built-in Tool Modes

| Mode | Tools Enabled | Use Case |
|------|---------------|----------|
| `code` | bash, file editor | Code modifications, scripts |
| `analysis` | file reader only | Code review, analysis |
| `full` | bash, file, computer | Full automation |
| `custom` | User-specified | Fine-grained control |

### 2. Tenant-Aware File Operations

All file operations automatically use the current project context:

```typescript
// Tool uses api.files internally - no tenant passing needed
await agent.run("Read the package.json and update dependencies");
// Automatically reads from current tenant's project
```

### 3. Sandbox Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| `strict` | Containerized, no network | Untrusted code |
| `permissive` | Process isolation only | Trusted code |
| `none` | Direct execution | Development only |

### 4. Checkpointing

Long-running agent tasks are checkpointed:
- After each tool execution
- On agentic loop iterations
- Before human approval requests

## Usage

### Basic: As a Workflow Tool

```typescript
import { workflow, step } from "veryfront/ai/workflow";

export const codeFix = workflow({
  id: "code-fix",
  steps: [
    step("fix", {
      tool: "claude-code",
      input: (ctx) => ({
        task: ctx.input.issue,
        mode: "code",
        maxIterations: 10,
      }),
    }),
  ],
});
```

### Advanced: Custom Agent Configuration

```typescript
import { claudeCodeAgent } from "veryfront/ai/workflow/claude-code";

const agent = claudeCodeAgent({
  model: "claude-sonnet-4-20250514",
  mode: "code",
  sandbox: "strict",

  // Custom tools alongside built-ins
  tools: {
    runTests: myTestRunner,
    deployPreview: myDeployTool,
  },

  // Callbacks for observability
  onToolCall: (tool, input) => console.log(`Calling ${tool}`),
  onIteration: (i, result) => console.log(`Iteration ${i}`),
});

// Use in workflow
export const migration = workflow({
  id: "migration",
  steps: [
    step("migrate", { agent }),
    waitForApproval("review"),
    step("apply", { tool: "git-commit" }),
  ],
});
```

### With Human-in-the-Loop

```typescript
export const safeMigration = workflow({
  id: "safe-migration",
  steps: [
    // Agent proposes changes
    step("propose", {
      tool: "claude-code",
      input: { task: "Migrate to React 19", mode: "analysis" },
    }),

    // Human reviews proposed changes
    waitForApproval("review-changes", {
      message: "Review proposed migration changes",
      payload: (ctx) => ctx.propose.changes,
    }),

    // Agent applies approved changes
    step("apply", {
      tool: "claude-code",
      input: (ctx) => ({
        task: `Apply these changes: ${JSON.stringify(ctx.propose.changes)}`,
        mode: "code",
      }),
    }),

    // Human reviews final result
    waitForApproval("review-final"),

    step("commit", { tool: "git-commit" }),
  ],
});
```

## API Reference

### `claudeCodeAgent(config)`

Create a Claude Code agent for use in workflows.

```typescript
interface ClaudeCodeAgentConfig {
  /** Model to use (default: claude-sonnet-4-20250514) */
  model?: string;

  /** Tool mode: 'code' | 'analysis' | 'full' | 'custom' */
  mode?: ClaudeCodeMode;

  /** Sandbox mode: 'strict' | 'permissive' | 'none' */
  sandbox?: SandboxMode;

  /** Maximum agentic loop iterations */
  maxIterations?: number;

  /** Custom tools to add */
  tools?: Record<string, Tool>;

  /** System prompt override */
  system?: string;

  /** Callbacks */
  onToolCall?: (tool: string, input: unknown) => void;
  onIteration?: (iteration: number, result: unknown) => void;
  onComplete?: (result: ClaudeCodeResult) => void;
}
```

### `claudeCodeTool`

Pre-configured tool for use in workflow steps.

```typescript
interface ClaudeCodeToolInput {
  /** Task description for the agent */
  task: string;

  /** Tool mode */
  mode?: ClaudeCodeMode;

  /** Maximum iterations */
  maxIterations?: number;

  /** Files to focus on (optional) */
  files?: string[];

  /** Additional context */
  context?: Record<string, unknown>;
}
```

### Built-in Tools

#### `bash` (type: bash_20250124)
Execute shell commands in sandbox.

#### `file_editor` (type: text_editor_20250124)
Edit files using str_replace operations.

#### `file_reader`
Read files from project (uses `api.files.read`).

#### `computer` (type: computer_20250124)
Computer use for UI automation (optional, requires setup).

## Security Considerations

### File Access
- All file operations scoped to tenant project
- Path traversal protection enabled
- No access outside project root

### Shell Execution
- Commands run in isolated container (strict mode)
- Network access disabled by default
- Resource limits enforced (CPU, memory, time)

### Secrets
- Environment variables not passed to sandbox
- API keys managed via Veryfront config
- Tenant tokens never exposed to agent

## Examples

### Code Review Agent

```typescript
export const codeReview = workflow({
  id: "code-review",
  steps: [
    step("review", {
      tool: "claude-code",
      input: (ctx) => ({
        task: `Review the following PR changes for:
          - Security issues
          - Performance problems
          - Code style violations

          Files: ${ctx.input.files.join(", ")}`,
        mode: "analysis",
      }),
    }),
  ],
});
```

### Dependency Updater

```typescript
export const updateDeps = workflow({
  id: "update-deps",
  steps: [
    step("analyze", {
      tool: "claude-code",
      input: {
        task: "Analyze package.json and find outdated dependencies",
        mode: "analysis",
      },
    }),

    step("update", {
      tool: "claude-code",
      input: (ctx) => ({
        task: `Update these dependencies: ${ctx.analyze.outdated.join(", ")}`,
        mode: "code",
      }),
    }),

    step("test", { tool: "run-tests" }),

    waitForApproval("review"),

    step("commit", {
      tool: "git-commit",
      input: { message: "chore: update dependencies" },
    }),
  ],
});
```

### Bug Fix Agent

```typescript
export const bugFix = workflow({
  id: "bug-fix",
  steps: [
    step("reproduce", {
      tool: "claude-code",
      input: (ctx) => ({
        task: `Reproduce this bug: ${ctx.input.issueDescription}`,
        mode: "code",
      }),
    }),

    step("fix", {
      tool: "claude-code",
      input: (ctx) => ({
        task: `Fix the bug. Root cause: ${ctx.reproduce.rootCause}`,
        mode: "code",
        maxIterations: 15,
      }),
    }),

    step("verify", {
      tool: "claude-code",
      input: {
        task: "Run tests to verify the fix",
        mode: "code",
      },
    }),

    waitForApproval("review-fix"),
  ],
});
```

## Configuration

### Environment Variables

```bash
# Required
ANTHROPIC_API_KEY=sk-ant-...

# Optional
CLAUDE_CODE_SANDBOX=strict          # strict | permissive | none
CLAUDE_CODE_MAX_ITERATIONS=20       # Default max iterations
CLAUDE_CODE_TIMEOUT=300000          # Timeout per iteration (ms)
```

### Veryfront Config

```typescript
// veryfront.config.ts
export default {
  ai: {
    claudeCode: {
      enabled: true,
      defaultModel: "claude-sonnet-4-20250514",
      sandbox: "strict",
      maxIterations: 20,
      timeout: "5m",
    },
  },
};
```

## Roadmap

- [ ] Computer use integration for UI testing
- [ ] Git operations as built-in tools
- [ ] Diff preview before apply
- [ ] Cost tracking and limits
- [ ] Streaming progress updates
- [ ] Multi-file atomic operations
