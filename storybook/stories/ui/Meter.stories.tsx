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
import { Meter } from "../../../src/react/components/ui/index.ts";

const importCode = `import { Meter } from "veryfront/ui"`;

function MeterDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Meter"
        lead="A semantic gauge for a known, bounded reading — score, quota, or usage."
      />

      <DocsSection
        title="Default"
        description="The neutral variant — a plain fill for an unqualified reading."
      >
        <DocsExampleAuto of={Default} />
      </DocsSection>

      <DocsSection
        title="Success"
        description="The success variant — a healthy, in-range reading."
      >
        <DocsExampleAuto of={Success} />
      </DocsSection>

      <DocsSection
        title="Warning"
        description="The warning variant — approaching a limit."
      >
        <DocsExampleAuto of={Warning} />
      </DocsSection>

      <DocsSection
        title="Danger"
        description="The danger variant — over threshold; value clamps to max."
      >
        <DocsExampleAuto of={Danger} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>Meter</DocsComposition>
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="Meter"
          description="Semantic gauge for a bounded reading"
          props={[
            {
              name: "value",
              type: "number",
              description: "Current reading (clamped into [min, max])",
            },
            {
              name: "min",
              type: "number",
              default: "0",
              description: "Lower bound of the range",
            },
            {
              name: "max",
              type: "number",
              default: "100",
              description: "Upper bound of the range",
            },
            {
              name: "variant",
              type: "'default' | 'success' | 'warning' | 'danger'",
              default: "'default'",
              description: "Semantic colour of the fill",
            },
            {
              name: "label",
              type: "string",
              description: "Accessible reading exposed as aria-valuetext",
            },
            {
              name: "className",
              type: "string",
              description: "Additional classes",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "UI/Meter",
  component: Meter,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: { page: MeterDocsPage },
  },
} satisfies Meta<typeof Meter>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="w-64">
      <Meter value={50} variant="default" label="50 of 100" />
    </div>
  ),
};

export const Success: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="w-64">
      <Meter value={24} variant="success" label="24% used" />
    </div>
  ),
};

export const Warning: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="w-64">
      <Meter value={82} variant="warning" label="82% full" />
    </div>
  ),
};

export const Danger: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="w-64">
      <Meter value={140} variant="danger" label="Over quota" />
    </div>
  ),
};
