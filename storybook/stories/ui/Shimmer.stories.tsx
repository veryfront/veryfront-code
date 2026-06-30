import type { Meta, StoryObj } from "@storybook/react-vite";
import { Shimmer } from "../../../src/react/components/chat/ui/index.ts";
import {
  DocsCode,
  DocsExampleAuto,
  DocsHero,
  DocsPage,
  DocsPropsTable,
  DocsSection,
} from "../../.storybook/docs";

function ShimmerDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Shimmer"
        lead="Animates a light band across text via `bg-clip-text` — for streaming / thinking states. Respects `prefers-reduced-motion`."
      />
      <DocsSection title="Default">
        <DocsExampleAuto of={Default} />
      </DocsSection>
      <DocsSection
        title="Speed"
        description="`duration` controls the sweep (seconds)."
      >
        <DocsExampleAuto of={Speed} />
      </DocsSection>
      <DocsSection title="Import">
        <DocsCode code={`import { Shimmer } from "veryfront/chat/ui"`} />
      </DocsSection>
      <DocsSection title="API Reference">
        <DocsPropsTable
          component="Shimmer"
          props={[
            { name: "as", type: "ElementType", default: "'span'", description: "Element to render as" },
            { name: "duration", type: "number", default: "2", description: "Sweep duration (seconds)" },
            { name: "spread", type: "number", default: "2", description: "Band spread × content length" },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "Chat/UI/Shimmer",
  component: Shimmer,
  tags: ["autodocs"],
  parameters: { layout: "centered", docs: { page: ShimmerDocsPage } },
} satisfies Meta<typeof Shimmer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  tags: ["!dev"],
  render: () => (
    <Shimmer className="text-base">Thinking through the problem…</Shimmer>
  ),
};
export const Speed: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="flex flex-col gap-2 text-base">
      <Shimmer duration={1}>Fast sweep</Shimmer>
      <Shimmer duration={2}>Default sweep</Shimmer>
      <Shimmer duration={3.5}>Slow sweep</Shimmer>
    </div>
  ),
};
