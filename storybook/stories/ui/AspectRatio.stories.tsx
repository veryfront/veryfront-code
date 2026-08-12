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
import { AspectRatio } from "../../../src/react/components/ui/index.ts";

const importCode = `import { AspectRatio } from "veryfront/ui"`;

function AspectRatioDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="AspectRatio"
        lead="Constrain content to a fixed width/height ratio."
      />

      <DocsSection title="Widescreen" description="16 / 9 — video, hero media, embeds.">
        <DocsExampleAuto of={Widescreen} />
      </DocsSection>

      <DocsSection title="Square" description="1 / 1 — avatars, thumbnails, tiles.">
        <DocsExampleAuto of={Square} />
      </DocsSection>

      <DocsSection title="Portrait" description="3 / 4 — cards and vertical media.">
        <DocsExampleAuto of={Portrait} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>AspectRatio</DocsComposition>
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="AspectRatio"
          description="Fixed-ratio content box"
          props={[
            {
              name: "ratio",
              type: "number",
              default: "1",
              description: "Width ÷ height (e.g. 16 / 9)",
            },
            {
              name: "className",
              type: "string",
              description: "Additional classes",
            },
            {
              name: "children",
              type: "ReactNode",
              description: "Content that fills the box",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "UI/AspectRatio",
  component: AspectRatio,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: { page: AspectRatioDocsPage },
  },
} satisfies Meta<typeof AspectRatio>;

export default meta;
type Story = StoryObj<typeof meta>;

const Placeholder = ({ label }: { label: string }) => (
  <div className="flex h-full w-full items-center justify-center rounded-lg bg-[var(--edge)] text-sm text-[var(--muted-foreground)]">
    {label}
  </div>
);

export const Widescreen: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="w-72">
      <AspectRatio ratio={16 / 9}>
        <Placeholder label="16 / 9" />
      </AspectRatio>
    </div>
  ),
};

export const Square: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="w-48">
      <AspectRatio ratio={1}>
        <Placeholder label="1 / 1" />
      </AspectRatio>
    </div>
  ),
};

export const Portrait: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="w-48">
      <AspectRatio ratio={3 / 4}>
        <Placeholder label="3 / 4" />
      </AspectRatio>
    </div>
  ),
};
