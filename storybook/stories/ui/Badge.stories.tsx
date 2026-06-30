import type { Meta, StoryObj } from "@storybook/react-vite";
import { Badge } from "../../../src/react/components/chat/ui/index.ts";
import {
  DocsCode,
  DocsExampleAuto,
  DocsHero,
  DocsPage,
  DocsPropsTable,
  DocsSection,
} from "../../.storybook/docs";

function BadgeDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Badge"
        lead="Small pill for status and metadata. Solid by default, or `outline`."
      />
      <DocsSection title="Default">
        <DocsExampleAuto of={Default} />
      </DocsSection>
      <DocsSection title="Outline">
        <DocsExampleAuto of={Outline} />
      </DocsSection>
      <DocsSection
        title="Status"
        description="`success` / `warning` / `destructive` — tinted fills from the `--alert-*-bg` tokens with `--status-*` text."
      >
        <DocsExampleAuto of={Status} />
      </DocsSection>
      <DocsSection title="Import">
        <DocsCode code={`import { Badge } from "veryfront/chat/ui"`} />
      </DocsSection>
      <DocsSection title="API Reference">
        <DocsPropsTable
          component="Badge"
          props={[
            {
              name: "variant",
              type:
                "'default' | 'success' | 'warning' | 'destructive' | 'outline'",
              default: "'default'",
              description: "Visual style",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "Chat/UI/Badge",
  component: Badge,
  tags: ["autodocs"],
  parameters: { layout: "centered", docs: { page: BadgeDocsPage } },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  tags: ["!dev"],
  render: () => <Badge>Default</Badge>,
};
export const Outline: Story = {
  tags: ["!dev"],
  render: () => <Badge variant="outline">Outline</Badge>,
};
export const Status: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="flex items-center gap-2">
      <Badge variant="success">Success</Badge>
      <Badge variant="warning">Warning</Badge>
      <Badge variant="destructive">Error</Badge>
    </div>
  ),
};
