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
import { ScrollArea } from "../../../src/react/components/ui/index.ts";

const importCode = `import { ScrollArea } from "veryfront/ui"`;

function ScrollAreaDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="ScrollArea"
        lead="A styled native-overflow scroll container with a tasteful thin scrollbar: vertical, horizontal, or both."
      />

      <DocsSection
        title="Vertical"
        description="The default: scrolls the y-axis and clips the x-axis. Give it a fixed height."
      >
        <DocsExampleAuto of={Vertical} />
      </DocsSection>

      <DocsSection
        title="Horizontal"
        description="Scrolls the x-axis and clips the y-axis. Give it a fixed width and lay the content out in a row."
      >
        <DocsExampleAuto of={Horizontal} />
      </DocsSection>

      <DocsSection
        title="Both"
        description="Scrolls on either axis for content that overflows in two dimensions."
      >
        <DocsExampleAuto of={Both} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>ScrollArea</DocsComposition>
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="ScrollArea"
          description="Styled native-overflow scroll container"
          props={[
            {
              name: "orientation",
              type: "'vertical' | 'horizontal' | 'both'",
              default: "'vertical'",
              description: "Which axis scrolls: vertical, horizontal, or both",
            },
            {
              name: "children",
              type: "React.ReactNode",
              description: "The scrollable content",
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
  title: "UI/ScrollArea",
  component: ScrollArea,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: { page: ScrollAreaDocsPage },
  },
} satisfies Meta<typeof ScrollArea>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Vertical: Story = {
  tags: ["!dev"],
  render: () => (
    <ScrollArea
      orientation="vertical"
      className="h-48 w-64 border border-[var(--border)] p-4 text-sm"
    >
      <div className="space-y-2">
        {Array.from({ length: 24 }, (_, i) => (
          <p key={i}>Line {i + 1}, tall content that scrolls vertically.</p>
        ))}
      </div>
    </ScrollArea>
  ),
};

export const Horizontal: Story = {
  tags: ["!dev"],
  render: () => (
    <ScrollArea
      orientation="horizontal"
      className="w-64 border border-[var(--border)] p-4 text-sm"
    >
      <div className="flex gap-3">
        {Array.from({ length: 16 }, (_, i) => (
          <div
            key={i}
            className="flex h-16 w-24 shrink-0 items-center justify-center rounded-md bg-[var(--muted)] text-[var(--muted-foreground)]"
          >
            Card {i + 1}
          </div>
        ))}
      </div>
    </ScrollArea>
  ),
};

export const Both: Story = {
  tags: ["!dev"],
  render: () => (
    <ScrollArea
      orientation="both"
      className="h-48 w-64 border border-[var(--border)] p-4 text-sm"
    >
      <div className="w-[600px] space-y-2">
        {Array.from({ length: 24 }, (_, i) => (
          <p key={i} className="whitespace-nowrap">
            Row {i + 1}, wide and tall content that overflows on both axes.
          </p>
        ))}
      </div>
    </ScrollArea>
  ),
};
