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
import {
  DocsCode,
  DocsComposition,
  DocsExampleAuto,
  DocsHero,
  DocsPage,
  DocsPropsTable,
  DocsSection,
} from "../../.storybook/docs";
import { quickActions } from "../fixtures/chat";
import { ReviewSurface, StoryFrame } from "../support/StoryFrame";

const importCode =
  `import {
  BranchPicker,
  MessageActions,
  MessageFeedback,
  QuickActions,
  Suggestion,
  Suggestions,
  TabSwitcher,
} from "veryfront/chat"`;

const compositionTree = `Message controls
  +-- MessageActions  <- copy / edit an assistant answer
  +-- MessageFeedback  <- thumbs up / down rating
  +-- BranchPicker  <- step between regenerated responses
Prompt controls
  +-- QuickActions  <- pill row of one-tap prompts
  +-- Suggestions  <- container for Suggestion buttons
        +-- Suggestion  <- a single suggested prompt
View controls
  +-- TabSwitcher  <- chat / uploads tab pill`;

function ActionComponentsDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Action Components"
        lead="The small, composable controls that surround chat messages and prompts — feedback, copy/edit, suggestions, quick actions, and view tabs."
      />

      <DocsSection
        title="Message controls"
        description="`MessageActions` (copy / edit), `MessageFeedback` (thumbs up / down), and `BranchPicker` (regenerated-response navigation) sit beneath an assistant turn."
      >
        <DocsExampleAuto of={MessageControls} />
      </DocsSection>

      <DocsSection
        title="Prompt controls"
        description="`QuickActions` renders a pill row of one-tap prompts; `Suggestions` wraps individual `Suggestion` buttons for the empty state."
      >
        <DocsExampleAuto of={PromptActions} />
      </DocsSection>

      <DocsSection
        title="View tabs"
        description="`TabSwitcher` toggles between the chat and uploads views with a WAI-ARIA tabs pattern."
      >
        <DocsExampleAuto of={Tabs} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>{compositionTree}</DocsComposition>
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="MessageActions"
          description="Copy / edit controls for a message"
          props={[
            {
              name: "content",
              type: "string",
              description: "Text copied to the clipboard and passed to onEdit",
            },
            {
              name: "onEdit",
              type: "(content: string) => void",
              description: "When provided, renders an edit button calling this handler",
            },
            {
              name: "className",
              type: "string",
              description: "Additional class name",
            },
          ]}
        />
        <DocsPropsTable
          component="MessageFeedback"
          description="Thumbs up / down rating control"
          props={[
            {
              name: "messageId",
              type: "string",
              description: "Identifier passed back to onFeedback",
            },
            {
              name: "feedback",
              type: "'positive' | 'negative' | null",
              description: "Current feedback state",
            },
            {
              name: "onFeedback",
              type: "(messageId: string, feedback: 'positive' | 'negative') => void",
              description: "Called when the user rates the message",
            },
            {
              name: "className",
              type: "string",
              description: "Additional class name",
            },
          ]}
        />
        <DocsPropsTable
          component="QuickActions"
          description="Pill row of one-tap prompts"
          props={[
            {
              name: "actions",
              type: "QuickAction[]",
              description: "Actions to render; each is { id, label, icon?, prompt? }",
            },
            {
              name: "onActionClick",
              type: "(action: QuickAction) => void",
              description: "Called with the clicked action",
            },
            {
              name: "className",
              type: "string",
              description: "Additional class name",
            },
          ]}
        />
        <DocsPropsTable
          component="Suggestions"
          description="Container for Suggestion buttons"
          props={[
            {
              name: "children",
              type: "React.ReactNode",
              description: "Suggestion elements to lay out",
            },
            {
              name: "layout",
              type: "'grid' | 'horizontal'",
              default: "'grid'",
              description: "Wrap suggestions in a grid or a horizontal scroller",
            },
            {
              name: "className",
              type: "string",
              description: "Additional class name",
            },
          ]}
        />
        <DocsPropsTable
          component="TabSwitcher"
          description="Chat / uploads view toggle"
          props={[
            {
              name: "activeTab",
              type: "'chat' | 'uploads'",
              description: "Currently selected tab",
            },
            {
              name: "onTabChange",
              type: "(tab: 'chat' | 'uploads') => void",
              description: "Called when the active tab changes",
            },
            {
              name: "className",
              type: "string",
              description: "Additional class name",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "Chat/Components/Action Components",
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: { page: ActionComponentsDocsPage },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const MessageControls: Story = {
  tags: ["!dev"],
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
  tags: ["!dev"],
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
  tags: ["!dev"],
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
