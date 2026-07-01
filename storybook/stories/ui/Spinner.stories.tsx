import type { Meta, StoryObj } from "@storybook/react-vite";
import { Spinner } from "../../../src/react/components/chat/ui/index.ts";
import {
  DocsCode,
  DocsComposition,
  DocsExampleAuto,
  DocsHero,
  DocsPage,
  DocsPropsTable,
  DocsSection,
} from "../../.storybook/docs";

const importCode = `import { Spinner } from "veryfront/chat/ui"`;

const compositionTree = `Spinner`;

function SpinnerDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Spinner"
        lead="Inline loading indicator using the Veryfront mark."
      />

      <DocsSection title="Default">
        <DocsExampleAuto of={Default} />
      </DocsSection>

      <DocsSection title="Inline With Text">
        <DocsExampleAuto of={InlineWithText} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>{compositionTree}</DocsComposition>
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="Spinner"
          description="Animated loading indicator built on the Veryfront mark"
          props={[
            {
              name: "className",
              type: "string",
              description: "Size / extra classes (defaults to size-7)",
            },
            {
              name: "label",
              type: "string",
              default: "'Loading'",
              description: "Accessible label",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "Chat/UI/Spinner",
  component: Spinner,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: { page: SpinnerDocsPage },
  },
} satisfies Meta<typeof Spinner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  tags: ["!dev"],
  render: () => <Spinner />,
};

export const InlineWithText: Story = {
  name: "Inline With Text",
  tags: ["!dev"],
  render: () => (
    <div className="flex items-center gap-2 text-sm text-foreground">
      <Spinner />
      Loading messages...
    </div>
  ),
};
