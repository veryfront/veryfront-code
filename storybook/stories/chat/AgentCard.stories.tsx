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

const compositionTree =
  `AgentCard  <- render it: <AgentCard {...props} /> (default anatomy)
AgentCard.Root  <- or compose it: context (name, status, tools, messages)
  +-- AgentCard.Header     <- avatar + name (left), Status dot + label (right)
  +-- AgentCard.Reasoning  <- thinking text (renders when set)
  +-- AgentCard.Tools      <- one ToolCall card per entry (or renderTool)
  +-- AgentCard.Body       <- the agent's message text (rendered as Markdown)`;

function AgentCardDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="AgentCard"
        lead="An agent turn rendered as a `Card` wrapping the `Message` anatomy — a header (avatar + name + status) over reasoning, tool calls, and the message text."
      />

      <DocsSection
        title="Thinking"
        description={'An in-progress agent with `status="thinking"`, reasoning text, tool calls, and messages.'}
      >
        <DocsExampleAuto of={Thinking} />
      </DocsSection>

      <DocsSection
        title="Completed"
        description={'A finished turn with `status="completed"`, a single resolved tool call, and the transcript.'}
      >
        <DocsExampleAuto of={Completed} />
      </DocsSection>

      <DocsSection
        title="Error"
        description={'A failed tool call renders inline with `status="error"` and the error message.'}
      >
        <DocsExampleAuto of={Error} />
      </DocsSection>

      <DocsSection
        title="Compose"
        description="Drop to `AgentCard.Root` + parts to recompose the card — reorder the sections (Body over Header), or restyle a section with `className`."
      >
        <DocsExampleAuto of={Composed} />
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
              name: "name",
              type: "string",
              default: '"Agent"',
              description: "Agent display name shown in the header",
            },
            {
              name: "avatarUrl",
              type: "string",
              description: "Agent avatar image; falls back to an initial",
            },
            {
              name: "status",
              type:
                "'idle' | 'thinking' | 'tool_execution' | 'streaming' | 'completed' | 'error'",
              description:
                "Current agent status, rendered as a header Status dot + label",
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
        name="Release Agent"
        status="thinking"
        thinking="Checking run state, recent tool calls, and release blockers."
        toolCalls={agentCardTools}
        messages={agentCardMessages}
      />
    </StoryFrame>
  ),
  parameters: {
    docs: {
      source: {
        code: `<AgentCard
  name="Release Agent"
  status="thinking"
  thinking="Checking run state, recent tool calls, and release blockers."
  toolCalls={toolCalls}
  messages={messages}
/>`,
      },
    },
  },
};

export const Completed: Story = {
  tags: ["!dev"],
  render: () => (
    <StoryFrame maxWidth="720px">
      <AgentCard
        name="Release Agent"
        status="completed"
        toolCalls={agentCardTools.slice(0, 1)}
        messages={agentCardMessages}
      />
    </StoryFrame>
  ),
  parameters: {
    docs: {
      source: {
        code: `<AgentCard
  name="Release Agent"
  status="completed"
  toolCalls={toolCalls}
  messages={messages}
/>`,
      },
    },
  },
};

export const Composed: Story = {
  tags: ["!dev"],
  render: () => (
    <StoryFrame maxWidth="720px">
      <AgentCard.Root
        name="Release Agent"
        status="completed"
        thinking="Checking run state, recent tool calls, and release blockers."
        toolCalls={agentCardTools.slice(0, 1)}
        messages={agentCardMessages}
      >
        <AgentCard.Header className="pb-1" />
        <AgentCard.Body />
        <AgentCard.Tools />
        <AgentCard.Reasoning />
      </AgentCard.Root>
    </StoryFrame>
  ),
  parameters: {
    docs: {
      source: {
        code: `import { AgentCard } from "veryfront/chat";

// Recompose the card: Header (restyled), then Body, Tools, Reasoning.
<AgentCard.Root
  name="Release Agent"
  status="completed"
  thinking="Checking run state, recent tool calls, and release blockers."
  toolCalls={toolCalls}
  messages={messages}
>
  <AgentCard.Header className="pb-1" />
  <AgentCard.Body />
  <AgentCard.Tools />
  <AgentCard.Reasoning />
</AgentCard.Root>`,
      },
    },
  },
};

export const Error: Story = {
  tags: ["!dev"],
  render: () => (
    <StoryFrame maxWidth="720px">
      <AgentCard
        name="Deploy Agent"
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
  parameters: {
    docs: {
      source: {
        code: `<AgentCard
  name="Deploy Agent"
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
/>`,
      },
    },
  },
};
