import type { Meta, StoryObj } from "@storybook/react-vite";
import { ReasoningCard } from "veryfront/chat";
import { ReviewSurface, StoryFrame } from "../support/StoryFrame";

const meta = {
  title: "Veryfront UI/Chat/ReasoningCard",
  component: ReasoningCard,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof ReasoningCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Streaming: Story = {
  render: () => (
    <StoryFrame maxWidth="640px">
      <ReviewSurface label="Streaming reasoning">
        <ReasoningCard
          text="I am comparing the current run state, recent tool calls, and the deploy preconditions before giving a recommendation."
          isStreaming
        />
      </ReviewSurface>
    </StoryFrame>
  ),
};

export const Complete: Story = {
  render: () => (
    <StoryFrame maxWidth="640px">
      <ReviewSurface label="Collapsed after completion">
        <ReasoningCard text="The release can proceed after the retry path has a user-visible error and the Storybook build is green." />
      </ReviewSurface>
    </StoryFrame>
  ),
};
