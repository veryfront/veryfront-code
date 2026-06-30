import type { Meta, StoryObj } from "@storybook/react-vite";
import { AgentCard } from "veryfront/chat";
import {
  DocsCode,
  DocsComposition,
  DocsExampleAuto,
  DocsHero,
  DocsPage,
  DocsPropsTable,
  DocsSection,
} from "../../.storybook/docs";
import { agentCardMessages, agentCardTools } from "../fixtures/chat";
import { StoryFrame } from "../support/StoryFrame";

const importCode = `import { AgentCard } from "veryfront/chat"`;

const compositionTree = `AgentCard
  +-- AgentStatus  <- status pill (idle / thinking / streaming / completed / error)
  +-- ThinkingIndicator  <- reasoning text, shown when 'thinking' is set
  +-- Tool Calls  <- ToolInvocation + ToolResult per tool call
  +-- Messages  <- scrollable transcript of agent messages`;

function AgentCardDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="AgentCard"
        lead="A self-contained view of an agent turn — status, reasoning, tool calls, and the message transcript in one card."
      />

      <DocsSection
        title="Thinking"
        description={"An in-progress agent with `status=\"thinking\"`, reasoning text, tool calls, and messages."}
      >
        <DocsExampleAuto of={Thinking} />
      </DocsSection>

      <DocsSection
        title="Completed"
        description={"A finished turn with `status=\"completed\"`, a single resolved tool call, and the transcript."}
      >
        <DocsExampleAuto of={Completed} />
      </DocsSection>

      <DocsSection
        title="Error"
        description={"A failed tool call renders inline with `status=\"error\"` and the error message."}
      >
        <DocsExampleAuto of={Error} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>{compositionTree}</DocsComposition>
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="AgentCard"
          description={"Self-contained agent turn"}
          props={[
            {
              name: "status",
              type: "'idle' | 'thinking' | 'tool_execution' | 'streaming' | 'completed' | 'error'",
              description: "Current agent status, rendered as a status pill",
            },
            {
              name: "messages",
              type: "AgentMessage[]",
              description: "Agent messages to render as a transcript",
            },
            {
              name: "toolCalls",
              type: "ToolCall[]",
              default: "[]",
              description: "Tool calls to render with arguments and results",
            },
            {
              name: "thinking",
              type: "string",
              description: "Reasoning text shown in the thinking indicator",
            },
            {
              name: "theme",
              type: "Partial<AgentTheme>",
              description: "Theme overrides merged over the default agent theme",
            },
            {
              name: "renderTool",
              type: "(toolCall: ToolCall) => React.ReactNode",
              description: "Custom renderer for each tool call",
            },
            {
              name: "className",
              type: "string",
              description: "Additional class name for the container",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "Chat/Components/AgentCard",
  component: AgentCard,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: { page: AgentCardDocsPage },
  },
} satisfies Meta<typeof AgentCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Thinking: Story = {
  tags: ["!dev"],
  render: () => (
    <StoryFrame maxWidth="720px">
      <AgentCard
        status="thinking"
        thinking="Checking run state, recent tool calls, and release blockers."
        toolCalls={agentCardTools}
        messages={agentCardMessages}
      />
    </StoryFrame>
  ),
};

export const Completed: Story = {
  tags: ["!dev"],
  render: () => (
    <StoryFrame maxWidth="720px">
      <AgentCard
        status="completed"
        toolCalls={agentCardTools.slice(0, 1)}
        messages={agentCardMessages}
      />
    </StoryFrame>
  ),
};

export const Error: Story = {
  tags: ["!dev"],
  render: () => (
    <StoryFrame maxWidth="720px">
      <AgentCard
        status="error"
        toolCalls={[
          {
            id: "tool-error",
            name: "vf_trigger_deploy",
            args: { dryRun: true },
            status: "error",
            error: "Deploy token is missing",
          },
        ]}
      />
    </StoryFrame>
  ),
};
