import type { Meta, StoryObj } from "@storybook/react-vite";
import { Message, StandaloneMessage, StreamingMessage } from "veryfront/chat";
import { chatMessages, completedToolPart } from "../fixtures/chat";
import { StoryFrame } from "../support/StoryFrame";

const meta = {
  title: "Veryfront UI/Chat/Message",
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const StandalonePair: Story = {
  render: () => (
    <StoryFrame maxWidth="760px">
      <div className="space-y-4">
        <StandaloneMessage message={chatMessages[0]} showRole showTimestamp />
        <StandaloneMessage message={chatMessages[1]} showRole showTimestamp />
      </div>
    </StoryFrame>
  ),
};

export const CompoundAssistant: Story = {
  render: () => (
    <StoryFrame maxWidth="760px">
      <Message.Root
        message={chatMessages[1]}
        onFeedback={() => undefined}
        feedback="positive"
        getBranches={() => ({ current: 1, total: 3 })}
        switchBranch={() => undefined}
      >
        <Message.Avatar />
        <div className="min-w-0 flex-1">
          <Message.BranchPicker />
          <Message.Content showSources showSteps />
          <Message.Actions />
          <Message.Feedback />
        </div>
      </Message.Root>
    </StoryFrame>
  ),
};

export const CompoundUser: Story = {
  render: () => (
    <StoryFrame maxWidth="760px">
      <Message.Root message={chatMessages[0]}>
        <Message.Content />
        <Message.Actions />
      </Message.Root>
    </StoryFrame>
  ),
};

export const Streaming: Story = {
  render: () => (
    <StoryFrame maxWidth="760px">
      <StreamingMessage
        parts={[
          {
            type: "text",
            text: "I am checking the run state and tool results now",
          },
          completedToolPart,
        ]}
      />
    </StoryFrame>
  ),
};
