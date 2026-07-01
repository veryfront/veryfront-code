import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChatEmptyState } from "veryfront/chat";
import {
  DocsCode,
  DocsComposition,
  DocsExampleAuto,
  DocsHero,
  DocsPage,
  DocsPropsTable,
  DocsSection,
} from "../../.storybook/docs";
import { StoryFrame } from "../support/StoryFrame";

const importCode = `import { ChatEmptyState } from "veryfront/chat"`;

const compositionTree =
  `ChatEmptyState.Root          <- centered container
  +-- ChatEmptyState.Avatar        <- hero agent avatar (64px)
  +-- ChatEmptyState.Heading       <- agent name / title
  +-- ChatEmptyState.Suggestions   <- wrapping chip row
        +-- ChatEmptyState.Suggestion  <- one filled chip`;

const SUGGESTIONS = [
  "Create a plan",
  "Make a research",
  "Create an agent",
  "Create a skill",
];

function ChatEmptyStateDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="ChatEmptyState"
        lead="The conversation idle view: an agent avatar, a heading, and a row of suggestion chips. Compose the parts yourself — no monolithic prop surface."
      />

      <DocsSection title="Default">
        <DocsExampleAuto of={Default} />
      </DocsSection>

      <DocsSection
        title="Custom Agent"
        description="Any agent name and suggestions — the avatar falls back to the name's initial."
      >
        <DocsExampleAuto of={CustomAgent} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>{compositionTree}</DocsComposition>
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="ChatEmptyState.Root"
          description="Centered flex container for the empty-state pieces"
          props={[
            {
              name: "className",
              type: "string",
              description: "Additional classes on the container",
            },
          ]}
        />
        <DocsPropsTable
          component="ChatEmptyState.Avatar"
          description="Hero agent avatar (64px)"
          props={[
            { name: "src", type: "string", description: "Agent avatar image URL" },
            {
              name: "alt",
              type: "string",
              default: '"Veryfront Agent"',
              description: "Label and initial source",
            },
            {
              name: "isCreating",
              type: "boolean",
              default: "false",
              description: "Pulse while provisioning",
            },
          ]}
        />
        <DocsPropsTable
          component="ChatEmptyState.Heading"
          description="Balanced, centered title"
          props={[
            {
              name: "level",
              type: "1 | 2 | 3 | 4 | 5 | 6",
              default: "2",
              description: "Heading element level",
            },
          ]}
        />
        <DocsPropsTable
          component="ChatEmptyState.Suggestion"
          description="A single filled chip — accepts all Button props except variant"
          props={[
            {
              name: "onClick",
              type: "(e) => void",
              description: "Fired when the chip is pressed",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "Chat/Components/ChatEmptyState",
  component: ChatEmptyState.Root,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: { page: ChatEmptyStateDocsPage },
  },
} satisfies Meta<typeof ChatEmptyState.Root>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  tags: ["!dev"],
  render: () => (
    <StoryFrame maxWidth="820px">
      <div className="flex min-h-[360px] flex-col">
        <ChatEmptyState.Root>
          <ChatEmptyState.Avatar alt="Veryfront Agent" />
          <ChatEmptyState.Heading>Veryfront Agent</ChatEmptyState.Heading>
          <ChatEmptyState.Suggestions>
            {SUGGESTIONS.map((s) => (
              <ChatEmptyState.Suggestion key={s}>{s}</ChatEmptyState.Suggestion>
            ))}
          </ChatEmptyState.Suggestions>
        </ChatEmptyState.Root>
      </div>
    </StoryFrame>
  ),
};

export const CustomAgent: Story = {
  name: "Custom Agent",
  tags: ["!dev"],
  render: () => (
    <StoryFrame maxWidth="820px">
      <div className="flex min-h-[360px] flex-col">
        <ChatEmptyState.Root>
          <ChatEmptyState.Avatar alt="Gmail Agent" />
          <ChatEmptyState.Heading>Gmail Agent</ChatEmptyState.Heading>
          <ChatEmptyState.Suggestions>
            <ChatEmptyState.Suggestion>Summarize my inbox</ChatEmptyState.Suggestion>
            <ChatEmptyState.Suggestion>Draft a reply</ChatEmptyState.Suggestion>
            <ChatEmptyState.Suggestion>Find an attachment</ChatEmptyState.Suggestion>
          </ChatEmptyState.Suggestions>
        </ChatEmptyState.Root>
      </div>
    </StoryFrame>
  ),
};
