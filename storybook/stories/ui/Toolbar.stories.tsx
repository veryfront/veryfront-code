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
  Toolbar,
  ToolbarButton,
  ToolbarLink,
  ToolbarSeparator,
} from "../../../src/react/components/ui/index.ts";

const importCode = `import { Toolbar, ToolbarButton, ToolbarSeparator, ToolbarLink } from "veryfront/ui"`;

const composition = `Toolbar
├── ToolbarButton
├── ToolbarSeparator
└── ToolbarLink`;

function ToolbarDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Toolbar"
        lead="A role='toolbar' container that groups controls behind one tab stop, with arrow-key roving focus."
      />

      <DocsSection
        title="Horizontal"
        description="The default. Left/Right arrows move focus between items; Home/End jump to the ends."
      >
        <DocsExampleAuto of={Horizontal} />
      </DocsSection>

      <DocsSection
        title="Vertical"
        description="Set orientation='vertical' to stack items and drive focus with Up/Down arrows."
      >
        <DocsExampleAuto of={Vertical} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>{composition}</DocsComposition>
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="Toolbar"
          description="Roving-focus container"
          props={[
            {
              name: "orientation",
              type: "'horizontal' | 'vertical'",
              default: "'horizontal'",
              description: "Layout axis and arrow-key direction",
            },
            {
              name: "className",
              type: "string",
              description: "Additional classes",
            },
          ]}
        />
        <DocsPropsTable
          component="ToolbarButton"
          description="Ghost icon button in the roving focus"
          props={[
            {
              name: "className",
              type: "string",
              description: "Additional classes",
            },
          ]}
        />
        <DocsPropsTable
          component="ToolbarSeparator"
          description="Thin rule between groups of items"
          props={[
            {
              name: "orientation",
              type: "'horizontal' | 'vertical'",
              default: "'vertical'",
              description: "Rule direction (perpendicular to the toolbar)",
            },
            {
              name: "className",
              type: "string",
              description: "Additional classes",
            },
          ]}
        />
        <DocsPropsTable
          component="ToolbarLink"
          description="Anchor styled like a ToolbarButton"
          props={[
            {
              name: "href",
              type: "string",
              description: "The link destination",
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
  title: "UI/Toolbar",
  component: Toolbar,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: { page: ToolbarDocsPage },
  },
} satisfies Meta<typeof Toolbar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Horizontal: Story = {
  tags: ["!dev"],
  render: () => (
    <Toolbar orientation="horizontal" aria-label="Text formatting">
      <ToolbarButton aria-label="Bold">B</ToolbarButton>
      <ToolbarButton aria-label="Italic">I</ToolbarButton>
      <ToolbarButton aria-label="Underline">U</ToolbarButton>
      <ToolbarSeparator />
      <ToolbarButton aria-label="Align left">L</ToolbarButton>
      <ToolbarButton aria-label="Align center">C</ToolbarButton>
      <ToolbarSeparator />
      <ToolbarLink href="#help">Help</ToolbarLink>
    </Toolbar>
  ),
};

export const Vertical: Story = {
  tags: ["!dev"],
  render: () => (
    <Toolbar orientation="vertical" aria-label="Tools">
      <ToolbarButton aria-label="Cut">X</ToolbarButton>
      <ToolbarButton aria-label="Copy">C</ToolbarButton>
      <ToolbarButton aria-label="Paste">V</ToolbarButton>
      <ToolbarSeparator orientation="horizontal" />
      <ToolbarButton aria-label="Delete">D</ToolbarButton>
    </Toolbar>
  ),
};
