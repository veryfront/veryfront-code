import type { Meta, StoryObj } from "@storybook/react-vite";
import { SkillTool } from "veryfront/chat";
import {
  DocsCode,
  DocsComposition,
  DocsExampleAuto,
  DocsHero,
  DocsPage,
  DocsPropsTable,
  DocsSection,
} from "../../.storybook/docs";
import { ReviewSurface, StoryFrame } from "../support/StoryFrame";

const importCode = `import { SkillTool } from "veryfront/chat"`;

const compositionTree = `SkillTool  <- a tool-call row (icon + label)
  +-- icon    <- Sparkles (loading) / Check (loaded)
  +-- label   <- "Loading skill: X" / "Loaded skill: X"`;

function SkillToolDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="SkillTool"
        lead="Tool-call row for the `load_skill` skill tool. Reads as a sibling of the other tool rows — icon, label, and a check when the skill has loaded."
      />

      <DocsSection
        title="Loading"
        description="While the skill loads, a Sparkles icon pulses and the label shimmers."
      >
        <DocsExampleAuto of={Loading} />
      </DocsSection>

      <DocsSection
        title="Loaded"
        description="Once loaded, a Check appears and the label is solid."
      >
        <DocsExampleAuto of={Loaded} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>{compositionTree}</DocsComposition>
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="SkillTool"
          description="A tool-call row for the load_skill skill tool"
          props={[
            {
              name: "skill",
              type: "string",
              description: "The skill being loaded (id or filename).",
            },
            {
              name: "state",
              type: '"loading" | "loaded"',
              description:
                'Tool-call state. Defaults to "loaded".',
            },
            {
              name: "className",
              type: "string",
              description: "Additional class names for the row.",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "Chat/Components/SkillTool",
  component: SkillTool,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: { page: SkillToolDocsPage },
  },
} satisfies Meta<typeof SkillTool>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = {
  tags: ["!dev"],
  render: () => (
    <StoryFrame maxWidth="720px">
      <ReviewSurface label="Loading">
        <SkillTool skill="code-review" state="loading" />
      </ReviewSurface>
    </StoryFrame>
  ),
};

export const Loaded: Story = {
  tags: ["!dev"],
  render: () => (
    <StoryFrame maxWidth="720px">
      <ReviewSurface label="Loaded">
        <SkillTool skill="code-review" state="loaded" />
      </ReviewSurface>
    </StoryFrame>
  ),
};
