import type { Meta, StoryObj } from "@storybook/react-vite";
import { Pill } from "../../../src/react/components/chat/ui/index.ts";
import { ChevronDownIcon } from "../../../src/react/components/chat/icons/index.ts";
import {
  DocsCode,
  DocsExampleAuto,
  DocsHero,
  DocsPage,
  DocsPropsTable,
  DocsSection,
} from "../../.storybook/docs";

function PillDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Pill"
        lead="Filled trigger pill (label + optional icon/chevron) for selection triggers — `click to open/select`, not `click to act`. Hover is a soft bump, not Button's polarity flip."
      />
      <DocsSection title="Default" description="On the sand chrome background.">
        <DocsExampleAuto of={Default} />
      </DocsSection>
      <DocsSection
        title="On card"
        description="The `card` surface, for white card backgrounds."
      >
        <DocsExampleAuto of={OnCard} />
      </DocsSection>
      <DocsSection title="With chevron">
        <DocsExampleAuto of={WithChevron} />
      </DocsSection>
      <DocsSection title="Import">
        <DocsCode code={`import { Pill } from "veryfront/chat/ui"`} />
      </DocsSection>
      <DocsSection title="API Reference">
        <DocsPropsTable
          component="Pill"
          description="Extends button attributes"
          props={[
            {
              name: "on",
              type: "'chrome' | 'card'",
              default: "'chrome'",
              description: "Surface the pill sits on (drives hover background)",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "Chat/UI/Pill",
  component: Pill,
  tags: ["autodocs"],
  parameters: { layout: "centered", docs: { page: PillDocsPage } },
} satisfies Meta<typeof Pill>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  tags: ["!dev"],
  render: () => <Pill>gpt-4o</Pill>,
};
export const OnCard: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="rounded-lg bg-[var(--secondary)] p-6">
      <Pill on="card">gpt-4o</Pill>
    </div>
  ),
};
export const WithChevron: Story = {
  tags: ["!dev"],
  render: () => (
    <Pill>
      Claude Opus
      <ChevronDownIcon />
    </Pill>
  ),
};
