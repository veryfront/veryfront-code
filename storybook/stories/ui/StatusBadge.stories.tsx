import type { Meta, StoryObj } from "@storybook/react-vite";
import { StatusBadge } from "../../../src/react/components/chat/ui/index.ts";
import {
  DocsCode,
  DocsExampleAuto,
  DocsHero,
  DocsPage,
  DocsPropsTable,
  DocsSection,
} from "../../.storybook/docs";

function StatusBadgeDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="StatusBadge"
        lead="A coloured status dot with a label, keyed to the `--status-*` palette. Optionally pulses (in-progress) or hides the label responsively."
      />
      <DocsSection title="Colors">
        <DocsExampleAuto of={Colors} />
      </DocsSection>
      <DocsSection
        title="Pulse"
        description="`pulse` animates the dot for in-progress states."
      >
        <DocsExampleAuto of={Pulse} />
      </DocsSection>
      <DocsSection title="Import">
        <DocsCode code={`import { StatusBadge } from "veryfront/chat/ui"`} />
      </DocsSection>
      <DocsSection title="API Reference">
        <DocsPropsTable
          component="StatusBadge"
          props={[
            { name: "label", type: "string", description: "Status text" },
            { name: "color", type: "'gray' | 'blue' | 'green' | 'red' | 'yellow'", description: "Dot colour" },
            { name: "pulse", type: "boolean", default: "false", description: "Animate the dot" },
            { name: "showLabel", type: "boolean", default: "true", description: "Off → dot-only (label kept for SR)" },
            { name: "responsive", type: "boolean", default: "false", description: "Hide label via container query when tight" },
            { name: "size", type: "'sm' | 'inherit'", default: "'sm'", description: "Label size" },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "Chat/UI/StatusBadge",
  component: StatusBadge,
  tags: ["autodocs"],
  parameters: { layout: "centered", docs: { page: StatusBadgeDocsPage } },
} satisfies Meta<typeof StatusBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Colors: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="flex flex-col gap-2">
      <StatusBadge color="green" label="Completed" />
      <StatusBadge color="blue" label="Running" />
      <StatusBadge color="yellow" label="Pending" />
      <StatusBadge color="red" label="Failed" />
      <StatusBadge color="gray" label="Idle" />
    </div>
  ),
};
export const Pulse: Story = {
  tags: ["!dev"],
  render: () => <StatusBadge color="blue" label="Running" pulse />,
};
