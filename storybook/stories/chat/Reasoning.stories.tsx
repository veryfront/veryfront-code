import type { Meta, StoryObj } from "@storybook/react-vite";
import { Reasoning } from "veryfront/chat";
import {
  DocsCode,
  DocsComposition,
  DocsExampleAuto,
  DocsHero,
  DocsPage,
  DocsPropsTable,
  DocsSection,
} from "../../.storybook/docs";
import { ReviewSurface, StoryFrame } from "../support/StoryFrame";

const importCode = `import { Reasoning } from "veryfront/chat"`;

const compositionTree = `Reasoning  <- collapsible disclosure for model thinking
  +-- toggle button  <- "Thinking..." shimmer or "Thought process"
  +-- Markdown  <- reasoning text body when expanded`;

function ReasoningDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Reasoning"
        lead="A collapsible disclosure for a model's reasoning — shimmers while streaming, then auto-collapses once the thought is complete."
      />

      <DocsSection
        title="Streaming"
        description="With `isStreaming`, the card stays open and shows a shimmering 'Thinking...' label while tokens arrive."
      >
        <DocsExampleAuto of={Streaming} />
      </DocsSection>

      <DocsSection
        title="Complete"
        description="Once streaming ends the card auto-collapses after a beat; clicking the toggle re-opens the rendered reasoning."
      >
        <DocsExampleAuto of={Complete} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>{compositionTree}</DocsComposition>
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="Reasoning"
          description="Collapsible reasoning disclosure"
          props={[
            {
              name: "text",
              type: "string",
              description: "Reasoning content, rendered as markdown",
            },
            {
              name: "isStreaming",
              type: "boolean",
              default: "false",
              description:
                "Keep the card open with a shimmer label while tokens stream in",
            },
            {
              name: "className",
              type: "string",
              description: "Additional class names for the container",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "Chat/Components/Reasoning",
  component: Reasoning,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: { page: ReasoningDocsPage },
  },
} satisfies Meta<typeof Reasoning>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Streaming: Story = {
  tags: ["!dev"],
  parameters: {
    docs: {
      source: {
        code: `import { Reasoning } from "veryfront/chat";

<Reasoning
  text="I am comparing the current run state, recent tool calls, and the deploy preconditions before giving a recommendation."
  isStreaming
/>`,
      },
    },
  },
  render: () => (
    <StoryFrame maxWidth="640px">
      <ReviewSurface label="Streaming reasoning">
        <Reasoning
          text="I am comparing the current run state, recent tool calls, and the deploy preconditions before giving a recommendation."
          isStreaming
        />
      </ReviewSurface>
    </StoryFrame>
  ),
};

export const Complete: Story = {
  tags: ["!dev"],
  parameters: {
    docs: {
      source: {
        code: `import { Reasoning } from "veryfront/chat";

<Reasoning text="The release can proceed after the retry path has a user-visible error and the Storybook build is green." />`,
      },
    },
  },
  render: () => (
    <StoryFrame maxWidth="640px">
      <ReviewSurface label="Collapsed after completion">
        <Reasoning text="The release can proceed after the retry path has a user-visible error and the Storybook build is green." />
      </ReviewSurface>
    </StoryFrame>
  ),
};
