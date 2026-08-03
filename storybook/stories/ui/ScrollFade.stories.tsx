import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScrollFade } from "../../../src/react/components/ui/index.ts";
import {
  DocsCode,
  DocsExampleAuto,
  DocsHero,
  DocsPage,
  DocsPropsTable,
  DocsSection,
} from "../../.storybook/docs";

function ScrollFadeDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="ScrollFade"
        lead="A scroll container that auto-fades its edges (mask-image) when content overflows or is scrolled — message lists, dialog/drawer bodies. Veryfront's `ScrollArea` equivalent."
      />
      <DocsSection
        title="Both edges"
        description="Fades the top when scrolled and the bottom when more sits below."
      >
        <DocsExampleAuto of={Both} />
      </DocsSection>
      <DocsSection
        title="Bottom only"
        description="Fades only the bottom while content overflows (dialog bodies)."
      >
        <DocsExampleAuto of={Bottom} />
      </DocsSection>
      <DocsSection title="Import">
        <DocsCode code={`import { ScrollFade } from "veryfront/ui"`} />
      </DocsSection>
      <DocsSection title="API Reference">
        <DocsPropsTable
          component="ScrollFade"
          description="Extends div props"
          props={[
            { name: "edges", type: "'both' | 'bottom'", default: "'both'", description: "Which edges fade" },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "UI/ScrollFade",
  component: ScrollFade,
  tags: ["autodocs"],
  parameters: { layout: "centered", docs: { page: ScrollFadeDocsPage } },
} satisfies Meta<typeof ScrollFade>;

export default meta;
type Story = StoryObj<typeof meta>;

const rows = Array.from({ length: 14 }, (_, i) => `Conversation ${i + 1}`);

export const Both: Story = {
  tags: ["!dev"],
  render: () => (
    <ScrollFade className="h-48 w-[280px] rounded-lg bg-[var(--secondary)] p-3">
      <div className="flex flex-col gap-2">
        {rows.map((r) => (
          <div key={r} className="text-sm text-[var(--foreground)]">{r}</div>
        ))}
      </div>
    </ScrollFade>
  ),
};

export const Bottom: Story = {
  tags: ["!dev"],
  render: () => (
    <ScrollFade
      edges="bottom"
      className="h-48 w-[280px] rounded-lg bg-[var(--secondary)] p-3"
    >
      <div className="flex flex-col gap-2">
        {rows.map((r) => (
          <div key={r} className="text-sm text-[var(--foreground)]">{r}</div>
        ))}
      </div>
    </ScrollFade>
  ),
};
