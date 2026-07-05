import type { Meta, StoryObj } from "@storybook/react-vite";
import { Status } from "../../../src/react/components/chat/ui/index.ts";
import {
  DocsCode,
  DocsComposition,
  DocsExampleAuto,
  DocsHero,
  DocsPage,
  DocsPropsTable,
  DocsSection,
} from "../../.storybook/docs";

const importCode = `import { Status } from "veryfront/chat/ui"`;

const compositionTree = `Status`;

function StatusDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Status"
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
          component="Status"
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
  title: "Chat/UI/Status",
  component: Status,
  tags: ["autodocs"],
  args: {
    label: "Deployed",
    color: "green",
  },
  parameters: {
    layout: "centered",
    docs: { page: StatusDocsPage },
  },
} satisfies Meta<typeof Status>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  tags: ["!dev"],
  render: () => <Status label="Deployed" color="green" />,
};

export const AllColors: Story = {
  name: "All Colors",
  tags: ["!dev"],
  render: () => (
    <div className="flex flex-col gap-3">
      <Status label="Pending" color="gray" />
      <Status label="Building" color="blue" />
      <Status label="Deployed" color="green" />
      <Status label="Failed" color="red" />
      <Status label="Partial Success" color="yellow" />
    </div>
  ),
};

export const Pulse: Story = {
  tags: ["!dev"],
  render: () => <Status label="Building" color="blue" pulse />,
};

export const JobStatusRow: Story = {
  name: "Job Status Row",
  tags: ["!dev"],
  render: () => (
    <div className="flex items-center gap-4">
      <Status label="Submitted" color="gray" />
      <Status label="Working" color="blue" pulse />
      <Status label="Completed" color="green" />
      <Status label="Failed" color="red" />
    </div>
  ),
};

export const DeploymentStatus: Story = {
  name: "Deployment Status",
  tags: ["!dev"],
  render: () => <Status label="Deployed 3 hours ago" color="green" />,
};

export const ChannelStatus: Story = {
  name: "Channel Status",
  tags: ["!dev"],
  render: () => (
    <div className="flex flex-col gap-3">
      <Status label="Connected" color="green" />
      <Status label="Needs Reauth" color="yellow" />
      <Status label="Error" color="red" />
      <Status label="Not Connected" color="gray" />
    </div>
  ),
};
