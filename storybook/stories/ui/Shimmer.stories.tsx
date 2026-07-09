import type { Meta, StoryObj } from "@storybook/react-vite";
import { Shimmer } from "../../../src/react/components/ui/index.ts";
import {
  DocsCode,
  DocsComposition,
  DocsExampleAuto,
  DocsHero,
  DocsPage,
  DocsPropsTable,
  DocsSection,
} from "../../.storybook/docs";

const importCode = `import { Shimmer } from "veryfront/ui"`;

const compositionTree = `Shimmer`;

function ShimmerDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Shimmer"
        lead="Text loading indicator for AI streaming and processing states."
      />

      <DocsSection title="Default">
        <DocsExampleAuto of={Default} />
      </DocsSection>

      <DocsSection title="As Heading">
        <DocsExampleAuto of={AsHeading} />
      </DocsSection>

      <DocsSection
        title="Custom Duration"
        description="Slower sweep for longer operations."
      >
        <DocsExampleAuto of={CustomDuration} />
      </DocsSection>

      <DocsSection title="Chat Loading State">
        <DocsExampleAuto of={ChatLoadingState} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>{compositionTree}</DocsComposition>
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="Shimmer"
          description="Animated text shimmer for loading states"
          props={[
            {
              name: "children",
              type: "React.ReactNode",
              description: "Text to shimmer",
            },
            {
              name: "as",
              type: "ElementType",
              default: "'span'",
              description: "Element to render as",
            },
            {
              name: "duration",
              type: "number",
              default: "2",
              description: "Sweep duration in seconds",
            },
            {
              name: "spread",
              type: "number",
              default: "2",
              description: "Band spread multiplier (× content length)",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "UI/Shimmer",
  component: Shimmer,
  tags: ["autodocs"],
  args: {
    children: "Thinking...",
  },
  parameters: {
    layout: "centered",
    docs: { page: ShimmerDocsPage },
  },
} satisfies Meta<typeof Shimmer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  tags: ["!dev"],
  render: () => <Shimmer>Thinking...</Shimmer>,
};

export const AsHeading: Story = {
  name: "As Heading",
  tags: ["!dev"],
  render: () => (
    <Shimmer as="h3" className="text-lg font-medium">
      Generating Response
    </Shimmer>
  ),
};

export const CustomDuration: Story = {
  name: "Custom Duration",
  tags: ["!dev"],
  render: () => <Shimmer duration={4}>Processing files...</Shimmer>,
};

export const ChatLoadingState: Story = {
  name: "Chat Loading State",
  tags: ["!dev"],
  render: () => (
    <div className="flex flex-col gap-1">
      <Shimmer className="text-sm">Analyzing your project structure...</Shimmer>
      <Shimmer className="text-xs text-foreground" duration={3}>
        Reading 12 files
      </Shimmer>
    </div>
  ),
};
