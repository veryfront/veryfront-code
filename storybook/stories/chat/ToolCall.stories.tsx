import type { Meta, StoryObj } from "@storybook/react-vite";
import { ToolCall } from "veryfront/chat";
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
  completedToolPart,
  erroredToolPart,
  runningToolPart,
} from "../fixtures/chat";
import { StoryFrame } from "../support/StoryFrame";

const importCode = `import { ToolCall } from "veryfront/chat"`;

const compositionTree = `ToolCall  <- expandable card for one tool invocation
  +-- header       <- tool name + status badge + chevron
  +-- Parameters   <- highlighted JSON input
  +-- Result       <- JSON or auto table output
  +-- Error        <- Alert (error) with the failure text`;

function ToolCallDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="ToolCall"
        lead="An expandable card for a single tool invocation — parameters, result or error, and a status badge that reflects the tool's lifecycle."
      />

      <DocsSection
        title="Running"
        description="While a tool is executing, the card shows a 'Running' status and its parameters."
      >
        <DocsExampleAuto of={Running} />
      </DocsSection>

      <DocsSection
        title="Completed"
        description="A finished tool call expands to show its parameters and result, with a 'Completed' status."
      >
        <DocsExampleAuto of={Completed} />
      </DocsSection>

      <DocsSection
        title="Error"
        description="When a tool fails, the card surfaces the failure text in an error Alert."
      >
        <DocsExampleAuto of={Error} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>{compositionTree}</DocsComposition>
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="ToolCall"
          description="Expandable card for a single tool invocation"
          props={[
            {
              name: "tool",
              type: "ChatToolPart | ChatDynamicToolPart",
              description:
                "The tool part to render (name, state, input, output, errorText)",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "Chat/Components/ToolCall",
  component: ToolCall,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: { page: ToolCallDocsPage },
  },
} satisfies Meta<typeof ToolCall>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Running: Story = {
  tags: ["!dev"],
  render: () => (
    <StoryFrame maxWidth="720px">
      <ToolCall tool={runningToolPart} />
    </StoryFrame>
  ),
};

export const Completed: Story = {
  tags: ["!dev"],
  render: () => (
    <StoryFrame maxWidth="720px">
      <ToolCall tool={completedToolPart} />
    </StoryFrame>
  ),
};

export const Error: Story = {
  tags: ["!dev"],
  render: () => (
    <StoryFrame maxWidth="720px">
      <ToolCall tool={erroredToolPart} />
    </StoryFrame>
  ),
};
