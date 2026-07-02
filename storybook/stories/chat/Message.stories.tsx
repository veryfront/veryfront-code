import type { Meta, StoryObj } from "@storybook/react-vite";
import { Message, StandaloneMessage, StreamingMessage } from "veryfront/chat";
import {
  DocsCode,
  DocsComposition,
  DocsExampleAuto,
  DocsHero,
  DocsPage,
  DocsPropsTable,
  DocsSection,
} from "../../.storybook/docs";
import { chatMessages, completedToolPart } from "../fixtures/chat";
import { StoryFrame } from "../support/StoryFrame";

const importCode =
  `import { Message, StandaloneMessage, StreamingMessage } from "veryfront/chat"`;

const compositionTree = `Message.Root  <- context: message, branch state
  +-- Message.Header  <- agent avatar + name + timestamp (assistant)
  +-- Message.BranchPicker  <- switch between regenerated responses
  +-- Message.Content  <- markdown body, sources, reasoning steps
  +-- Message.Continuing  <- "Continuing…" shimmer while streaming
  +-- Message.Actions  <- copy / regenerate
  +-- Message.Tokens  <- token-usage popover (Model / Input / Output / Total)
  +-- Message.BranchPicker  <- optional: switch between regenerated responses
StandaloneMessage  <- non-compound convenience wrapper around Root
StreamingMessage  <- live token + tool-call stream while generating`;

function MessageDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Message"
        lead="A single chat turn — `StandaloneMessage` for the common case, or the `Message.*` compound parts when you need to recompose the layout."
      />

      <DocsSection
        title="Standalone"
        description="`StandaloneMessage` renders a user/assistant turn with role and timestamp — no composition required."
      >
        <DocsExampleAuto of={StandalonePair} />
      </DocsSection>

      <DocsSection
        title="Compound — Assistant"
        description="Compose `Message.Root` with the parts you need: branch picker, content with sources and steps, actions, and feedback."
      >
        <DocsExampleAuto of={CompoundAssistant} />
      </DocsSection>

      <DocsSection
        title="Compound — User"
        description="A minimal user turn — just content and actions."
      >
        <DocsExampleAuto of={CompoundUser} />
      </DocsSection>

      <DocsSection
        title="Streaming"
        description="`StreamingMessage` renders text and tool-call parts live as they arrive."
      >
        <DocsExampleAuto of={Streaming} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>{compositionTree}</DocsComposition>
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="StandaloneMessage"
          description="Self-contained message turn"
          props={[
            {
              name: "message",
              type: "ChatMessage",
              description: "The message to render",
            },
            {
              name: "showRole",
              type: "boolean",
              default: "false",
              description: "Show the user / assistant role label",
            },
            {
              name: "showTimestamp",
              type: "boolean",
              default: "false",
              description: "Show the message timestamp",
            },
          ]}
        />
        <DocsPropsTable
          component="Message.Root"
          description="Compound context provider for the parts below"
          props={[
            {
              name: "message",
              type: "ChatMessage",
              description: "The message to render",
            },
            {
              name: "feedback",
              type: "'positive' | 'negative' | null",
              description: "Current feedback state",
            },
            {
              name: "onFeedback",
              type: "(value) => void",
              description: "Called when the user rates the message",
            },
            {
              name: "getBranches",
              type: "() => { current: number; total: number }",
              description: "Supplies branch state to BranchPicker",
            },
            {
              name: "switchBranch",
              type: "(direction) => void",
              description: "Navigate between regenerated responses",
            },
          ]}
        />
        <DocsPropsTable
          component="StreamingMessage"
          description="Live message rendered from streaming parts"
          props={[
            {
              name: "parts",
              type: "MessagePart[]",
              description: "Text and tool-call parts to render in order",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "Chat/Components/Message",
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: { page: MessageDocsPage },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const StandalonePair: Story = {
  tags: ["!dev"],
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
  tags: ["!dev"],
  render: () => (
    <StoryFrame maxWidth="760px">
      <Message.Root message={chatMessages[1]} onReload={() => undefined}>
        <Message.Header />
        <Message.Content showSources showSteps />
        <div className="mt-1.5 flex items-center gap-0.5">
          <Message.Actions />
          <Message.Tokens />
        </div>
      </Message.Root>
    </StoryFrame>
  ),
};

export const CompoundUser: Story = {
  tags: ["!dev"],
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
  tags: ["!dev"],
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
