import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  InferenceBadge,
  SkillBadge,
  ToolCallCard,
  ToolStatusBadge,
} from "veryfront/chat";
import { completedToolPart, erroredToolPart } from "../fixtures/chat";
import { ReviewSurface, StoryFrame } from "../support/StoryFrame";

const meta = {
  title: "Veryfront UI/Chat/ToolCallCard",
  component: ToolCallCard,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof ToolCallCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Completed: Story = {
  render: () => (
    <StoryFrame maxWidth="720px">
      <ToolCallCard tool={completedToolPart} />
    </StoryFrame>
  ),
};

export const Error: Story = {
  render: () => (
    <StoryFrame maxWidth="720px">
      <ToolCallCard tool={erroredToolPart} />
    </StoryFrame>
  ),
};

export const Badges: Story = {
  render: () => (
    <StoryFrame maxWidth="720px">
      <ReviewSurface label="Status and mode badges">
        <div className="flex flex-wrap gap-2">
          <ToolStatusBadge state="input-available" />
          <ToolStatusBadge state="output-available" />
          <ToolStatusBadge state="output-error" />
          <SkillBadge
            tool={{
              type: "tool-load_skill",
              toolCallId: "skill-1",
              toolName: "load_skill",
              state: "output-available",
              input: { skillId: "frontend-ui-ux" },
            }}
          />
          <InferenceBadge inferenceMode="server-local" />
        </div>
      </ReviewSurface>
    </StoryFrame>
  ),
};
