import type { Meta, StoryObj } from "@storybook/react-vite";
import { InlineCitation, Sources } from "veryfront/chat";
import {
  DocsCode,
  DocsComposition,
  DocsExampleAuto,
  DocsHero,
  DocsPage,
  DocsPropsTable,
  DocsSection,
} from "../../.storybook/docs";
import { sourceList } from "../fixtures/chat";
import { ReviewSurface, StoryFrame } from "../support/StoryFrame";

const importCode = `import { InlineCitation, Sources } from "veryfront/chat"`;

const compositionTree = `Sources  <- wraps a flex-wrap row of pills
  +-- SourcePill  <- numbered chip with hover snippet preview
InlineCitation  <- superscript citation marker with hover card`;

function SourcesDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Sources"
        lead="Retrieval citations — `Sources` renders a row of numbered source pills, and `InlineCitation` drops a citation marker inline in prose."
      />

      <DocsSection
        title="List"
        description="`Sources` renders each source as a numbered pill with a relevance dot and a hover snippet preview."
      >
        <DocsExampleAuto of={List} />
      </DocsSection>

      <DocsSection
        title="Inline"
        description="`InlineCitation` places a superscript marker inside running text; hovering reveals the source title, URL, snippet, and relevance."
      >
        <DocsExampleAuto of={Inline} />
      </DocsSection>

      <DocsSection
        title="Empty"
        description="`Sources` renders nothing when the source list is empty."
      >
        <DocsExampleAuto of={Empty} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>{compositionTree}</DocsComposition>
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="Sources"
          description="A flex-wrap row of numbered source pills"
          props={[
            {
              name: "sources",
              type: "Source[]",
              description:
                "Sources to render. Each has title, optional url, score, snippet.",
            },
            {
              name: "onSourceClick",
              type: "(source: Source, index: number) => void",
              description: "Called when a pill is clicked",
            },
            {
              name: "className",
              type: "string",
              description: "Additional class names for the container",
            },
          ]}
        />
        <DocsPropsTable
          component="InlineCitation"
          description="Inline superscript citation marker with hover card"
          props={[
            {
              name: "index",
              type: "number",
              description: "Zero-based citation index (displayed as index + 1)",
            },
            {
              name: "source",
              type: "Source",
              description: "Source shown in the hover card",
            },
            {
              name: "onClick",
              type: "(index: number) => void",
              description: "Called when the marker is clicked",
            },
            {
              name: "className",
              type: "string",
              description: "Additional class names for the marker button",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "Chat/Components/Sources",
  component: Sources,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: { page: SourcesDocsPage },
  },
} satisfies Meta<typeof Sources>;

export default meta;
type Story = StoryObj<typeof meta>;

export const List: Story = {
  tags: ["!dev"],
  parameters: {
    docs: {
      source: {
        code: `import { Sources } from "veryfront/chat";

<Sources
  sources={[
    { title: "Agent guide", url: "/docs/guides/agents", score: 0.92, snippet: "Agents accept messages, tools, and context, then emit AG-UI events." },
    { title: "Workflow guide", url: "/docs/guides/workflows", score: 0.76, snippet: "Workflows model durable multi-step execution with explicit steps and runs." },
  ]}
  onSourceClick={(source, index) => open(source.url)}
/>`,
      },
    },
  },
  render: () => (
    <StoryFrame maxWidth="720px">
      <ReviewSurface label="Sources">
        <Sources sources={sourceList} onSourceClick={() => undefined} />
      </ReviewSurface>
    </StoryFrame>
  ),
};

export const Inline: Story = {
  tags: ["!dev"],
  parameters: {
    docs: {
      source: {
        code: `import { InlineCitation } from "veryfront/chat";

<p>
  Agent runs emit AG-UI events and persist state{" "}
  <InlineCitation index={0} source={sources[0]} />{" "}
  while workflows keep durable step history{" "}
  <InlineCitation index={1} source={sources[1]} />.
</p>`,
      },
    },
  },
  render: () => (
    <StoryFrame maxWidth="720px">
      <ReviewSurface label="InlineCitation">
        <p className="text-sm leading-6 text-[var(--foreground)]">
          Agent runs emit AG-UI events and persist state{" "}
          <InlineCitation index={0} source={sourceList[0]} />{" "}
          while workflows keep durable step history{" "}
          <InlineCitation index={1} source={sourceList[1]} />.
        </p>
      </ReviewSurface>
    </StoryFrame>
  ),
};

export const Empty: Story = {
  tags: ["!dev"],
  parameters: {
    docs: {
      source: {
        code: `import { Sources } from "veryfront/chat";

<Sources sources={[]} />`,
      },
    },
  },
  render: () => (
    <StoryFrame maxWidth="720px">
      <ReviewSurface label="Empty">
        <Sources sources={[]} />
      </ReviewSurface>
    </StoryFrame>
  ),
};
