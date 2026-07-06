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
import { Badge } from "../../../src/react/components/ui/index.ts";

const importCode = `import { Badge } from "veryfront/ui"`;

function BadgeDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Badge"
        lead="Compact label for status, counts, and metadata."
      />

      <DocsSection title="Default">
        <DocsExampleAuto of={Default} />
      </DocsSection>

      <DocsSection title="Success" description="Healthy, connected, or active.">
        <DocsExampleAuto of={Success} />
      </DocsSection>

      <DocsSection title="Warning" description="Approaching limits or degraded.">
        <DocsExampleAuto of={Warning} />
      </DocsSection>

      <DocsSection title="Destructive" description="Errors and critical states.">
        <DocsExampleAuto of={Destructive} />
      </DocsSection>

      <DocsSection
        title="Outline"
        description="Secondary labels — channel types, runtime targets."
      >
        <DocsExampleAuto of={Outline} />
      </DocsSection>

      <DocsSection title="Status Row">
        <DocsExampleAuto of={StatusRow} />
      </DocsSection>

      <DocsSection title="Environment Labels">
        <DocsExampleAuto of={EnvironmentLabels} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>Badge</DocsComposition>
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="Badge"
          description="Compact inline label"
          props={[
            {
              name: "variant",
              type:
                "'default' | 'success' | 'warning' | 'destructive' | 'outline'",
              default: "'default'",
              description: "Visual style",
            },
            {
              name: "className",
              type: "string",
              description: "Additional classes",
            },
            {
              name: "children",
              type: "ReactNode",
              description: "Badge content",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "UI/Badge",
  component: Badge,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: { page: BadgeDocsPage },
  },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  tags: ["!dev"],
  render: () => <Badge>3 Items</Badge>,
};

export const Success: Story = {
  tags: ["!dev"],
  render: () => <Badge variant="success">Production</Badge>,
};

export const Warning: Story = {
  tags: ["!dev"],
  render: () => <Badge variant="warning">72%</Badge>,
};

export const Destructive: Story = {
  tags: ["!dev"],
  render: () => <Badge variant="destructive">Failed</Badge>,
};

export const Outline: Story = {
  tags: ["!dev"],
  render: () => <Badge variant="outline">Slack</Badge>,
};

export const StatusRow: Story = {
  name: "Status Row",
  tags: ["!dev"],
  render: () => (
    <div className="flex items-center gap-1.5">
      <Badge variant="success">Connected</Badge>
      <Badge variant="outline">HTTP</Badge>
      <Badge>2 Bindings</Badge>
    </div>
  ),
};

export const EnvironmentLabels: Story = {
  name: "Environment Labels",
  tags: ["!dev"],
  render: () => (
    <div className="flex items-center gap-1.5">
      <Badge variant="success">Production</Badge>
      <Badge variant="outline">Staging</Badge>
    </div>
  ),
};
