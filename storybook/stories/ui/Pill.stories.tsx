import type { Meta, StoryObj } from "@storybook/react-vite";
import { Pill } from "../../../src/react/components/ui/index.ts";
import {
  DocsCode,
  DocsComposition,
  DocsExampleAuto,
  DocsHero,
  DocsPage,
  DocsPropsTable,
  DocsSection,
} from "../../.storybook/docs";

const importCode = `import { Pill } from "veryfront/ui"`;

const compositionTree =
  `Pill   <- Passive trigger pill for selection, filtering, and picker entry points`;

function PillDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Pill"
        lead="Passive trigger for selection, filtering, and picker entry points."
      />

      <DocsSection title="Default">
        <DocsExampleAuto of={Default} />
      </DocsSection>

      <DocsSection title="With icon">
        <DocsExampleAuto of={WithIcon} />
      </DocsSection>

      <DocsSection
        title="On card surface"
        description="Use on='card' on white card or drawer bodies."
      >
        <DocsExampleAuto of={SurfacePairedOnCard} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>{compositionTree}</DocsComposition>
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="Pill"
          description="Passive trigger pill"
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
  title: "UI/Pill",
  component: Pill,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: { page: PillDocsPage },
  },
} satisfies Meta<typeof Pill>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  tags: ["!dev"],
  render: () => <Pill>All files</Pill>,
};

export const WithIcon: Story = {
  name: "With icon",
  tags: ["!dev"],
  render: () => (
    <Pill>
      <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4">
        <circle cx="8" cy="8" r="5" fill="currentColor" />
      </svg>
      Suggested
    </Pill>
  ),
};

export const SurfacePairedOnCard: Story = {
  name: "On card surface",
  tags: ["!dev"],
  render: () => (
    <div className="rounded-lg bg-secondary p-6 shadow-sm">
      <Pill on="card">
        <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4">
          <circle cx="8" cy="8" r="5" fill="currentColor" />
        </svg>
        Project agent
        <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4">
          <path
            d="M4 6l4 4 4-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </Pill>
    </div>
  ),
};
