import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  DocsCode,
  DocsComposition,
  DocsExampleAuto,
  DocsHero,
  DocsPage,
  DocsPropsTable,
  DocsSection,
} from "../../.storybook/docs";
import { Separator } from "../../../src/react/components/ui/index.ts";

const importCode = `import { Separator } from "veryfront/ui"`;

function SeparatorDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Separator"
        lead="A thin divider rule - horizontal or vertical, decorative by default."
      />

      <DocsSection title="Horizontal" description="The default - a full-width rule between stacked content.">
        <DocsExampleAuto of={Horizontal} />
      </DocsSection>

      <DocsSection
        title="Vertical"
        description="A full-height rule between inline items; place inside a flex row."
      >
        <DocsExampleAuto of={Vertical} />
      </DocsSection>

      <DocsSection
        title="Semantic"
        description="Pass decorative={false} for a real role='separator' announced to assistive tech."
      >
        <DocsExampleAuto of={Semantic} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>Separator</DocsComposition>
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="Separator"
          description="Thin divider rule"
          props={[
            {
              name: "orientation",
              type: "'horizontal' | 'vertical'",
              default: "'horizontal'",
              description: "Rule direction",
            },
            {
              name: "decorative",
              type: "boolean",
              default: "true",
              description: "When false, renders a semantic role='separator'",
            },
            {
              name: "className",
              type: "string",
              description: "Additional classes",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "UI/Separator",
  component: Separator,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: { page: SeparatorDocsPage },
  },
} satisfies Meta<typeof Separator>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Horizontal: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="w-64">
      <p className="text-sm">Profile</p>
      <Separator orientation="horizontal" className="my-3" />
      <p className="text-sm">Billing</p>
    </div>
  ),
};

export const Vertical: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="flex h-6 items-center gap-3 text-sm">
      <span>Docs</span>
      <Separator orientation="vertical" />
      <span>API</span>
      <Separator orientation="vertical" />
      <span>Support</span>
    </div>
  ),
};

export const Semantic: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="w-64">
      <p className="text-sm">Section one</p>
      <Separator decorative={false} className="my-3" />
      <p className="text-sm">Section two</p>
    </div>
  ),
};
