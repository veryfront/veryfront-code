import type { Meta, StoryObj } from "@storybook/react-vite";
import { AgentCard } from "veryfront/chat";
import { agentCardMessages, agentCardTools } from "../fixtures/chat";
import { StoryFrame } from "../support/StoryFrame";

const meta = {
  title: "Veryfront UI/Chat/AgentCard",
  component: AgentCard,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof AgentCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Thinking: Story = {
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
