import type { Meta, StoryObj } from "@storybook/react-vite";
import { ProgressBar } from "../../../src/react/components/chat/ui/index.ts";
import {
  DocsCode,
  DocsExampleAuto,
  DocsHero,
  DocsPage,
  DocsPropsTable,
  DocsSection,
} from "../../.storybook/docs";

function ProgressBarDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="ProgressBar"
        lead="A determinate or indeterminate progress track — uploads, generation progress. Fully labelled for assistive tech."
      />
      <DocsSection title="Determinate" description="Fixed width from `percent`.">
        <DocsExampleAuto of={Determinate} />
      </DocsSection>
      <DocsSection
        title="Indeterminate"
        description="Looping bar when progress is unknown."
      >
        <DocsExampleAuto of={Indeterminate} />
      </DocsSection>
      <DocsSection title="Import">
        <DocsCode code={`import { ProgressBar } from "veryfront/chat/ui"`} />
      </DocsSection>
      <DocsSection title="API Reference">
        <DocsPropsTable
          component="ProgressBar"
          props={[
            { name: "percent", type: "number", description: "Completion 0–100 (clamped)" },
            { name: "indeterminate", type: "boolean", default: "false", description: "Looping bar instead of fixed width" },
            { name: "aria-label", type: "string", description: "Accessible name (defaults to 'Progress')" },
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
  parameters: { layout: "centered", docs: { page: ProgressBarDocsPage } },
} satisfies Meta<typeof ProgressBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Determinate: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="flex w-[320px] flex-col gap-3">
      <ProgressBar percent={25} aria-label="Upload" />
      <ProgressBar percent={60} aria-label="Upload" />
      <ProgressBar percent={100} aria-label="Upload" />
    </div>
  ),
};
export const Indeterminate: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="w-[320px]">
      <ProgressBar percent={0} indeterminate aria-label="Working" />
    </div>
  ),
};
