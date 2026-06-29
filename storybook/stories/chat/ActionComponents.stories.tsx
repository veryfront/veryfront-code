import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import {
  BranchPicker,
  MessageActions,
  MessageFeedback,
  QuickActions,
  Suggestion,
  Suggestions,
  TabSwitcher,
} from "veryfront/chat";
import { quickActions } from "../fixtures/chat";
import { ReviewSurface, StoryFrame } from "../support/StoryFrame";

const meta = {
  title: "Veryfront UI/Chat/Action Components",
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const MessageControls: Story = {
  render: () => {
    const [feedback, setFeedback] = React.useState<
      "positive" | "negative" | null
    >("positive");

    return (
      <StoryFrame maxWidth="680px">
        <div className="vf-component-grid">
          <ReviewSurface label="MessageActions">
            <div className="inline-flex rounded-[var(--radius-md)] border border-[var(--outline-border)] p-1">
              <MessageActions
                content="Copy or edit this assistant answer."
                onEdit={() => undefined}
                className="mt-0 opacity-100"
              />
            </div>
          </ReviewSurface>

          <ReviewSurface label="MessageFeedback">
            <MessageFeedback
              messageId="story-message"
              feedback={feedback}
              onFeedback={(_, value) => setFeedback(value)}
            />
          </ReviewSurface>

          <ReviewSurface label="BranchPicker">
            <BranchPicker
              current={2}
              total={4}
              onPrev={() => undefined}
              onNext={() => undefined}
            />
          </ReviewSurface>
        </div>
      </StoryFrame>
    );
  },
};

export const PromptActions: Story = {
  render: () => (
    <StoryFrame maxWidth="760px">
      <ReviewSurface label="QuickActions">
        <QuickActions actions={quickActions} onActionClick={() => undefined} />
      </ReviewSurface>

      <div className="mt-4">
        <ReviewSurface label="Suggestions">
          <Suggestions>
            <Suggestion suggestion="Show risky assumptions" />
            <Suggestion suggestion="Draft a test plan" />
            <Suggestion suggestion="Summarize the run" />
          </Suggestions>
        </ReviewSurface>
      </div>
    </StoryFrame>
  ),
};

export const Tabs: Story = {
  render: () => {
    const [tab, setTab] = React.useState<"chat" | "uploads">("chat");

    return (
      <StoryFrame maxWidth="420px">
        <ReviewSurface label="TabSwitcher">
          <TabSwitcher activeTab={tab} onTabChange={setTab} className="py-0" />
        </ReviewSurface>
      </StoryFrame>
    );
  },
};
