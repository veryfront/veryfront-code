import type { Meta, StoryObj } from "@storybook/react-vite";
import { StepIndicator } from "veryfront/chat";
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

const importCode = `import { StepIndicator } from "veryfront/chat"`;

const compositionTree = `StepIndicator  <- divider between steps of a multi-step turn
  +-- rule  <- hairline that runs to each edge
  +-- pill  <- status glyph + "Step N" label`;

function StepIndicatorDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="StepIndicator"
        lead="A labelled divider that separates the steps of a multi-step assistant turn — a check once the step is done, a pulsing dot while it runs. Rendered automatically by `Message` when `showSteps` is on and a turn has more than one step."
      />

      <DocsSection
        title="Complete"
        description="A finished step shows a success check next to its label."
      >
        <DocsExampleAuto of={Complete} />
      </DocsSection>

      <DocsSection
        title="Pending"
        description="An in-progress step shows a pulsing dot until it resolves."
      >
        <DocsExampleAuto of={Pending} />
      </DocsSection>

      <DocsSection
        title="In a turn"
        description="Steps divide the parts of a single turn — each rule marks where the next step begins."
      >
        <DocsExampleAuto of={Sequence} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>{compositionTree}</DocsComposition>
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="StepIndicator"
          description="Labelled divider between the steps of a multi-step turn"
          props={[
            {
              name: "stepIndex",
              type: "number",
              description: "Zero-based step index; the label reads `Step {stepIndex + 1}`",
            },
            {
              name: "isComplete",
              type: "boolean",
              description:
                "Show the success check (complete) or the pulsing dot (pending)",
            },
            {
              name: "icon",
              type: "React.ReactNode",
              description: "Override the complete/pending status glyph",
            },
            {
              name: "className",
              type: "string",
              description: "Additional class names for the container",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "Chat/Components/StepIndicator",
  component: StepIndicator,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: { page: StepIndicatorDocsPage },
  },
} satisfies Meta<typeof StepIndicator>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Complete: Story = {
  tags: ["!dev"],
  parameters: {
    docs: {
      source: {
        code: `import { StepIndicator } from "veryfront/chat";

<StepIndicator stepIndex={0} isComplete />`,
      },
    },
  },
  render: () => (
    <StoryFrame maxWidth="640px">
      <ReviewSurface label="Completed step">
        <StepIndicator stepIndex={0} isComplete />
      </ReviewSurface>
    </StoryFrame>
  ),
};

export const Pending: Story = {
  tags: ["!dev"],
  parameters: {
    docs: {
      source: {
        code: `import { StepIndicator } from "veryfront/chat";

<StepIndicator stepIndex={1} isComplete={false} />`,
      },
    },
  },
  render: () => (
    <StoryFrame maxWidth="640px">
      <ReviewSurface label="Pending step">
        <StepIndicator stepIndex={1} isComplete={false} />
      </ReviewSurface>
    </StoryFrame>
  ),
};

export const Sequence: Story = {
  tags: ["!dev"],
  parameters: {
    docs: {
      source: {
        code: `import { StepIndicator } from "veryfront/chat";

<StepIndicator stepIndex={0} isComplete />
{/* ...step 1 output... */}
<StepIndicator stepIndex={1} isComplete />
{/* ...step 2 output... */}
<StepIndicator stepIndex={2} isComplete={false} />
{/* ...step 3 streaming... */}`,
      },
    },
  },
  render: () => (
    <StoryFrame maxWidth="640px">
      <ReviewSurface label="Steps within a turn">
        <StepIndicator stepIndex={0} isComplete />
        <p className="py-1 text-sm leading-6 text-[var(--foreground)]">
          Searched the runs index and found the failing deploy.
        </p>
        <StepIndicator stepIndex={1} isComplete />
        <p className="py-1 text-sm leading-6 text-[var(--foreground)]">
          Read the error log and identified the missing retry path.
        </p>
        <StepIndicator stepIndex={2} isComplete={false} />
        <p className="py-1 text-sm leading-6 text-[var(--foreground)]">
          Drafting the fix…
        </p>
      </ReviewSurface>
    </StoryFrame>
  ),
};
