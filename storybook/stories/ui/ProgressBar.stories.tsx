import type { Meta, StoryObj } from "@storybook/react-vite";
import { ProgressBar } from "../../../src/react/components/chat/ui/index.ts";
import {
  DocsCode,
  DocsComposition,
  DocsExampleAuto,
  DocsHero,
  DocsPage,
  DocsPropsTable,
  DocsSection,
} from "../../.storybook/docs";

const importCode = `import { ProgressBar } from "veryfront/chat/ui"`;

const compositionTree = `ProgressBar`;

function ProgressBarDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="ProgressBar"
        lead="Horizontal completion bar — determinate or indeterminate."
      />

      <DocsSection title="Default" description="Always provide an aria-label.">
        <DocsExampleAuto of={Default} />
      </DocsSection>

      <DocsSection title="States">
        <DocsExampleAuto of={States} />
      </DocsSection>

      <DocsSection
        title="Indeterminate"
        description="Unknown-duration operations."
      >
        <DocsExampleAuto of={Indeterminate} />
      </DocsSection>

      <DocsSection title="Real-world: Credit Usage">
        <DocsExampleAuto of={CreditUsage} />
      </DocsSection>

      <DocsSection title="Real-world: File Upload">
        <DocsExampleAuto of={FileUpload} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>{compositionTree}</DocsComposition>
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="ProgressBar"
          description="Horizontal progress indicator"
          props={[
            {
              name: "percent",
              type: "number",
              description: "Completion 0–100 (clamped)",
            },
            {
              name: "indeterminate",
              type: "boolean",
              default: "false",
              description: "Looping bar instead of a fixed width",
            },
            {
              name: "aria-label",
              type: "string",
              description: "Accessible name (defaults to 'Progress')",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "Chat/UI/ProgressBar",
  component: ProgressBar,
  tags: ["autodocs"],
  args: { percent: 0 },
  parameters: {
    layout: "centered",
    docs: { page: ProgressBarDocsPage },
  },
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ProgressBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  tags: ["!dev"],
  render: () => <ProgressBar percent={35} aria-label="Credit usage" />,
};

export const States: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="flex flex-col gap-4">
      <ProgressBar percent={0} aria-label="Empty" />
      <ProgressBar percent={50} aria-label="Half" />
      <ProgressBar percent={100} aria-label="Full" />
    </div>
  ),
  parameters: {
    docs: {
      source: {
        code: `<ProgressBar percent={0} />
<ProgressBar percent={50} />
<ProgressBar percent={100} />`,
      },
    },
  },
};

export const Indeterminate: Story = {
  tags: ["!dev"],
  render: () => (
    <ProgressBar percent={0} indeterminate aria-label="Processing files" />
  ),
};

export const CreditUsage: Story = {
  name: "Credit Usage",
  tags: ["!dev"],
  render: () => (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-sm">
        <span>AI Credits</span>
        <span className="text-foreground">488 / 1,000</span>
      </div>
      <ProgressBar percent={49} aria-label="AI Credit usage" />
    </div>
  ),
};

export const FileUpload: Story = {
  name: "File Upload",
  tags: ["!dev"],
  render: () => (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-sm">
        <span>Uploading files...</span>
        <span className="text-foreground">65%</span>
      </div>
      <ProgressBar percent={65} aria-label="File upload progress" />
    </div>
  ),
};
