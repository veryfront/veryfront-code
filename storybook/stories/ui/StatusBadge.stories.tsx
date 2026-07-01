import type { Meta, StoryObj } from "@storybook/react-vite";
import { StatusBadge } from "../../../src/react/components/chat/ui/index.ts";
import {
  DocsCode,
  DocsComposition,
  DocsExampleAuto,
  DocsHero,
  DocsPage,
  DocsPropsTable,
  DocsSection,
} from "../../.storybook/docs";

const importCode = `import { StatusBadge } from "veryfront/chat/ui"`;

const compositionTree = `StatusBadge`;

function StatusBadgeDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="StatusBadge"
        lead="Coloured dot with a label for resource state."
      />

      <DocsSection title="Default">
        <DocsExampleAuto of={Default} />
      </DocsSection>

      <DocsSection
        title="All Colors"
        description="Pick by meaning, not appearance."
      >
        <DocsExampleAuto of={AllColors} />
      </DocsSection>

      <DocsSection
        title="Pulse"
        description="Only for actively in-progress states."
      >
        <DocsExampleAuto of={Pulse} />
      </DocsSection>

      <DocsSection title="Job Status Row">
        <DocsExampleAuto of={JobStatusRow} />
      </DocsSection>

      <DocsSection title="Deployment Status">
        <DocsExampleAuto of={DeploymentStatus} />
      </DocsSection>

      <DocsSection title="Channel Status">
        <DocsExampleAuto of={ChannelStatus} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>{compositionTree}</DocsComposition>
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="StatusBadge"
          description="Status indicator with colored dot and label"
          props={[
            { name: "label", type: "string", description: "Status text" },
            {
              name: "color",
              type: "'gray' | 'blue' | 'green' | 'red' | 'yellow'",
              description: "Dot colour",
            },
            {
              name: "pulse",
              type: "boolean",
              default: "false",
              description: "Animate the dot for in-progress states",
            },
            {
              name: "showLabel",
              type: "boolean",
              default: "true",
              description: "Off renders a dot only (label kept for SR)",
            },
            {
              name: "responsive",
              type: "boolean",
              default: "false",
              description: "Hide the label via container query when tight",
            },
            {
              name: "size",
              type: "'sm' | 'inherit'",
              default: "'sm'",
              description: "Label size",
            },
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
  args: {
    label: "Deployed",
    color: "green",
  },
  parameters: {
    layout: "centered",
    docs: { page: StatusBadgeDocsPage },
  },
} satisfies Meta<typeof StatusBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  tags: ["!dev"],
  render: () => <StatusBadge label="Deployed" color="green" />,
};

export const AllColors: Story = {
  name: "All Colors",
  tags: ["!dev"],
  render: () => (
    <div className="flex flex-col gap-3">
      <StatusBadge label="Pending" color="gray" />
      <StatusBadge label="Building" color="blue" />
      <StatusBadge label="Deployed" color="green" />
      <StatusBadge label="Failed" color="red" />
      <StatusBadge label="Partial Success" color="yellow" />
    </div>
  ),
};

export const Pulse: Story = {
  tags: ["!dev"],
  render: () => <StatusBadge label="Building" color="blue" pulse />,
};

export const JobStatusRow: Story = {
  name: "Job Status Row",
  tags: ["!dev"],
  render: () => (
    <div className="flex items-center gap-4">
      <StatusBadge label="Submitted" color="gray" />
      <StatusBadge label="Working" color="blue" pulse />
      <StatusBadge label="Completed" color="green" />
      <StatusBadge label="Failed" color="red" />
    </div>
  ),
};

export const DeploymentStatus: Story = {
  name: "Deployment Status",
  tags: ["!dev"],
  render: () => <StatusBadge label="Deployed 3 hours ago" color="green" />,
};

export const ChannelStatus: Story = {
  name: "Channel Status",
  tags: ["!dev"],
  render: () => (
    <div className="flex flex-col gap-3">
      <StatusBadge label="Connected" color="green" />
      <StatusBadge label="Needs Reauth" color="yellow" />
      <StatusBadge label="Error" color="red" />
      <StatusBadge label="Not Connected" color="gray" />
    </div>
  ),
};
