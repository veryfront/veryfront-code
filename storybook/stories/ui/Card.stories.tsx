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
import { Card, CardContent, CardHeader } from "../../../src/react/components/ui/index.ts";

const importCode = `import { Card, CardHeader, CardContent } from "veryfront/ui"`;

function CardDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Card"
        lead="A surface for grouping related content — solid or outline, with a padding and radius scale."
      />

      <DocsSection title="Solid" description="surface='solid' — the default interactive surface.">
        <DocsExampleAuto of={Solid} />
      </DocsSection>

      <DocsSection title="Outline" description="surface='outline' — border only, no fill.">
        <DocsExampleAuto of={Outline} />
      </DocsSection>

      <DocsSection title="Padding" description="padding='none' | 'sm' | 'md' | 'lg'.">
        <DocsExampleAuto of={Padding} />
      </DocsSection>

      <DocsSection title="Radius" description="radius='default' | 'sm' — smaller radius reads better when nested.">
        <DocsExampleAuto of={Radius} />
      </DocsSection>

      <DocsSection title="With header" description="Compose CardHeader + CardContent.">
        <DocsExampleAuto of={WithHeader} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>{"Card > CardHeader + CardContent"}</DocsComposition>
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="Card"
          description="Grouping surface"
          props={[
            {
              name: "surface",
              type: "'solid' | 'outline'",
              default: "'solid'",
              description: "Filled surface or border-only",
            },
            {
              name: "padding",
              type: "'none' | 'sm' | 'md' | 'lg'",
              default: "'md'",
              description: "Inner padding scale",
            },
            {
              name: "radius",
              type: "'default' | 'sm'",
              default: "'default'",
              description: "Corner radius scale",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "UI/Card",
  component: Card,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: { page: CardDocsPage },
  },
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Solid: Story = {
  tags: ["!dev"],
  render: () => (
    <Card surface="solid" className="w-64">
      <CardContent>Solid surface</CardContent>
    </Card>
  ),
};

export const Outline: Story = {
  tags: ["!dev"],
  render: () => (
    <Card surface="outline" className="w-64">
      <CardContent>Outline surface</CardContent>
    </Card>
  ),
};

export const Padding: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="flex flex-col gap-3">
      <Card surface="outline" padding="none" className="w-64">none</Card>
      <Card surface="outline" padding="sm" className="w-64">sm</Card>
      <Card surface="outline" padding="md" className="w-64">md</Card>
      <Card surface="outline" padding="lg" className="w-64">lg</Card>
    </div>
  ),
};

export const Radius: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="flex gap-3">
      <Card surface="outline" radius="default" className="w-32">default</Card>
      <Card surface="outline" radius="sm" className="w-32">sm</Card>
    </div>
  ),
};

export const WithHeader: Story = {
  name: "With header",
  tags: ["!dev"],
  render: () => (
    <Card className="w-64">
      <CardHeader>Settings</CardHeader>
      <CardContent>Manage your workspace.</CardContent>
    </Card>
  ),
};
