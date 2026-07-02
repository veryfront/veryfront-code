import type * as React from "react";
import type {
  AttachmentInfo,
  ChatMessage,
  ChatToolPart,
  ModelOption,
  QuickAction,
  Source,
  Thread,
  UploadedFile,
} from "veryfront/chat";

export const modelOptions: ModelOption[] = [
  {
    value: "anthropic/claude-sonnet-4",
    label: "Claude Sonnet 4",
    provider: "Anthropic",
  },
  { value: "openai/gpt-4.1", label: "GPT-4.1", provider: "OpenAI" },
  {
    value: "google/gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    provider: "Google",
  },
];

export const quickActions: QuickAction[] = [
  { id: "summarize", label: "Summarize" },
  { id: "compare", label: "Compare" },
  { id: "next-steps", label: "Next steps" },
];

export const sourceList: Source[] = [
  {
    title: "Agent guide",
    url: "/docs/guides/agents",
    score: 0.92,
    snippet:
      "Agents accept messages, tools, and context, then emit AG-UI events.",
  },
  {
    title: "Workflow guide",
    url: "/docs/guides/workflows",
    score: 0.76,
    snippet:
      "Workflows model durable multi-step execution with explicit steps and runs.",
  },
  {
    title: "Runs concept",
    url: "/docs/concepts/run",
    score: 0.58,
    snippet: "Runs are durable executions of an agent, workflow, or task.",
  },
];

export const attachments: AttachmentInfo[] = [
  { id: "prd", name: "agent-prd.md", size: 18342, type: "text/markdown" },
  { id: "log", name: "runtime-log.txt", size: 8427, type: "text/plain" },
];

export const uploads: UploadedFile[] = [
  { id: "upload-1", name: "run-analysis.csv", size: 24424, type: "text/csv" },
  {
    id: "upload-2",
    name: "prompt-notes.md",
    size: 9812,
    type: "text/markdown",
  },
];

export const completedToolPart: ChatToolPart<"search_docs"> = {
  type: "tool-search_docs",
  toolCallId: "tool-search-docs-1",
  toolName: "search_docs",
  state: "output-available",
  input: { query: "agent run persistence" },
  output: [
    { title: "Runs", confidence: "high" },
    { title: "Agent guide", confidence: "medium" },
  ],
};

export const erroredToolPart: ChatToolPart<"trigger_deploy"> = {
  type: "tool-trigger_deploy",
  toolCallId: "tool-trigger-deploy-1",
  toolName: "trigger_deploy",
  state: "output-error",
  input: { project: "demo" },
  errorText: "Missing deploy token",
};

export const runningToolPart: ChatToolPart<"search_docs"> = {
  type: "tool-search_docs",
  toolCallId: "tool-search-docs-running",
  toolName: "search_docs",
  state: "input-available",
  input: { query: "agent run persistence" },
};

export const chatMessages: ChatMessage[] = [
  {
    id: "msg-user-1",
    role: "user",
    createdAt: "2026-06-29T09:00:00.000Z",
    parts: [{
      type: "text",
      text: "What should I check before shipping this agent?",
    }],
  },
  {
    id: "msg-assistant-1",
    role: "assistant",
    createdAt: "2026-06-29T09:00:04.000Z",
    parts: [
      {
        type: "reasoning",
        text:
          "The answer should prioritize runtime behavior, run persistence, and tool safety.",
      },
      {
        type: "text",
        text:
          "Check the run lifecycle, streamed AG-UI events, tool input validation, and user-facing error handling before shipping.",
      },
      completedToolPart,
    ],
    metadata: {
      sources: sourceList,
      usage: { inputTokens: 542, outputTokens: 184, reasoningTokens: 36 },
    },
  },
  {
    id: "msg-user-2",
    role: "user",
    createdAt: "2026-06-29T09:01:00.000Z",
    parts: [{ type: "text", text: "Add the deployment risk too." }],
  },
  {
    id: "msg-assistant-2",
    role: "assistant",
    createdAt: "2026-06-29T09:01:03.000Z",
    parts: [
      {
        type: "text",
        text:
          "Deployment risk is mostly about configuration drift. Verify required secrets, runtime environment, and rollback path.",
      },
      erroredToolPart,
    ],
  },
];

const now = Date.now();

export const threads: Thread[] = [
  {
    id: "thread-active",
    title: "Release review",
    messages: chatMessages,
    createdAt: now - 45 * 60 * 1000,
    updatedAt: now - 5 * 60 * 1000,
  },
  {
    id: "thread-yesterday",
    title: "Agent run audit",
    messages: chatMessages.slice(0, 2),
    createdAt: now - 28 * 60 * 60 * 1000,
    updatedAt: now - 26 * 60 * 60 * 1000,
  },
  {
    id: "thread-older",
    title: "Workflow migration notes",
    messages: chatMessages.slice(0, 1),
    createdAt: now - 6 * 24 * 60 * 60 * 1000,
    updatedAt: now - 6 * 24 * 60 * 60 * 1000,
  },
];

export const loadingMessages: ChatMessage[] = [
  chatMessages[0],
  {
    id: "msg-assistant-loading",
    role: "assistant",
    createdAt: "2026-06-29T09:02:00.000Z",
    parts: [{ type: "text", text: "I am checking the latest run state" }],
  },
];

export const markdownExample = [
  "# Shipping an agent",
  "",
  "A full-stack **agent runtime** streams events over AG-UI. This guide is a",
  "quick reference — see the [runs API](https://veryfront.com/docs/runs) for the",
  "complete surface.",
  "",
  "## Release checklist",
  "",
  "Before you promote a run to production, confirm each of the following:",
  "",
  "1. Verify streamed **AG-UI** events arrive in order",
  "2. Confirm run state persists after a reload",
  "3. Check tool inputs *before* execution",
  "",
  "### Nested tasks",
  "",
  "- Runtime",
  "  - Stream watchdog is armed",
  "  - Idle timeout is set to `30s`",
  "- Persistence",
  "  - Run state is written on every step",
  "",
  "> **Note:** a run that stalls without a heartbeat is force-finished by the",
  "> stream watchdog. Keep `heartbeatMs` below the idle timeout.",
  "",
  "---",
  "",
  "## Fetching a run",
  "",
  "Use `veryfront.runs.get(runId)` to read the current status:",
  "",
  "```ts",
  "const run = await veryfront.runs.get(runId);",
  "if (run.status === 'failed') {",
  "  throw new Error(`Run ${run.id} failed: ${run.error}`);",
  "}",
  "console.log(run.status);",
  "```",
  "",
  "Or stream events straight from the CLI:",
  "",
  "```bash",
  "vf runs watch $RUN_ID --json | jq '.status'",
  "```",
  "",
  "## Status reference",
  "",
  "| Status      | Streaming | Terminal |",
  "| ----------- | :-------: | :------: |",
  "| `queued`    | no        | no       |",
  "| `running`   | yes       | no       |",
  "| `completed` | no        | yes      |",
  "| `failed`    | no        | yes      |",
  "",
  "That covers the everyday flow — headings, lists, tables, blockquotes,",
  "inline `code`, links, and fenced code all render inline.",
].join("\n");

export const agentCardMessages = [
  {
    id: "agent-message-1",
    role: "assistant" as const,
    parts: [{ type: "text" as const, text: "I found two release blockers." }],
  },
];

export const agentCardTools = [
  {
    id: "tool-1",
    name: "vf_get_errors",
    args: { project: "demo" },
    status: "completed" as const,
    result: { errors: 0, warnings: 2 },
    executionTime: 824,
  },
  {
    id: "tool-2",
    name: "vf_run_tests",
    args: { filter: "chat" },
    status: "executing" as const,
  },
];

export function createChangeHandler(setInput: (value: string) => void) {
  return (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setInput(event.currentTarget.value);
  };
}
