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
import {
  ColorModeProvider,
  ColorModeToggle,
} from "../../../src/react/components/ui/index.ts";

const importCode = `import { ColorModeProvider, ColorModeToggle } from "veryfront/ui"`;

function ColorModeToggleDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="ColorModeToggle"
        lead="A button that flips between light and dark mode via the ColorModeProvider."
      />

      <DocsSection title="Default" description="Click to toggle the resolved color mode.">
        <DocsExampleAuto of={Default} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>{"ColorModeProvider > ColorModeToggle"}</DocsComposition>
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="ColorModeToggle"
          description="Light/dark toggle button"
          props={[
            {
              name: "className",
              type: "string",
              description: "Additional classes for the button",
            },
            {
              name: "...props",
              type: "ButtonHTMLAttributes",
              description: "Any button attribute (aria-*, data-*, id, …)",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "UI/ColorModeToggle",
  component: ColorModeToggle,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: { page: ColorModeToggleDocsPage },
  },
} satisfies Meta<typeof ColorModeToggle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  tags: ["!dev"],
  render: () => (
    <ColorModeProvider>
      <ColorModeToggle className="rounded-md border border-[var(--outline-border)] px-3 py-1.5 text-sm" />
    </ColorModeProvider>
  ),
};
