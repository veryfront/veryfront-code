import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import { AgentPicker, ChatInput } from "veryfront/chat";
import type { AgentOption } from "veryfront/chat";
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
  attachments,
  createChangeHandler,
  modelOptions,
} from "../fixtures/chat";
import { ReviewSurface, StoryFrame } from "../support/StoryFrame";

const importCode = `import { ChatInput } from "veryfront/chat"`;

const agentOptions: AgentOption[] = [
  { id: "veryfront", name: "Veryfront Agent" },
  { id: "inbox-helper", name: "Inbox Helper" },
  { id: "researcher", name: "Research Agent" },
];

const compositionTree = `ChatInput  <- input form (forwardRef to the outer div)
  +-- InputBox  <- multiline message input
  +-- footer toolbar
      +-- + menu  <- attach files
      +-- AgentPicker  <- agent selector pill (agentSelector slot)
      +-- ModelSelector  <- shown when models + onModelChange are set
      +-- submit  <- send / stop`;

function ChatInputDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="ChatInput"
        lead="The chat input area — message field, attachments, agent + model selectors, and submit, wired through controlled props (Studio `PromptInput`)."
      />

      <DocsSection
        title="Default"
        description="A controlled composer with the `+` menu, agent pill, model selector, and submit."
      >
        <DocsExampleAuto of={Default} />
      </DocsSection>

      <DocsSection
        title="With attachments"
        description="Pass `attachments` (and render `AttachmentPill` children) to show pending files above the input."
      >
        <DocsExampleAuto of={WithAttachments} />
      </DocsSection>

      <DocsSection
        title="Streaming"
        description="While `isLoading` is true the input is disabled and the submit button becomes a stop control."
      >
        <DocsExampleAuto of={Streaming} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>{compositionTree}</DocsComposition>
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="ChatInput"
          description="Controlled input area for a chat thread"
          props={[
            {
              name: "input",
              type: "string",
              description: "Current input value",
            },
            {
              name: "onChange",
              type: "(e: ChangeEvent) => void",
              description: "Called when the input value changes",
            },
            {
              name: "onSubmit",
              type: "(e?: FormEvent) => void",
              description: "Called when the message is submitted",
            },
            {
              name: "isLoading",
              type: "boolean",
              description: "Disables input and shows the stop control",
            },
            {
              name: "placeholder",
              type: "string",
              default: '"Type a message..."',
              description: "Input placeholder text",
            },
            {
              name: "theme",
              type: "ChatTheme",
              description: "Per-element class overrides (input, button)",
            },
            {
              name: "stop",
              type: "() => void",
              description: "Called to stop an in-flight response",
            },
            {
              name: "onVoice",
              type: "() => void",
              description: "Enables the voice-input control",
            },
            {
              name: "isListening",
              type: "boolean",
              default: "false",
              description: "Whether voice input is active",
            },
            {
              name: "transcript",
              type: "string",
              description: "Live transcript shown while listening",
            },
            {
              name: "models",
              type: "ModelOption[]",
              description: "Models for the inline ModelSelector",
            },
            {
              name: "model",
              type: "string",
              description: "Currently selected model value",
            },
            {
              name: "onModelChange",
              type: "(model: string) => void",
              description: "Called when the model changes",
            },
            {
              name: "onAttach",
              type: "(files: FileList) => void",
              description: "Called with uploaded files",
            },
            {
              name: "onSelectAttachment",
              type: "() => void",
              description: "Opens a 'select document' menu item",
            },
            {
              name: "attachAccept",
              type: "string",
              description: "accept attribute for the file input",
            },
            {
              name: "attachments",
              type: "AttachmentInfo[]",
              description: "Pending attachments rendered above the input",
            },
            {
              name: "onRemoveAttachment",
              type: "(id: string) => void",
              description: "Called to remove a pending attachment",
            },
            {
              name: "showExport",
              type: "boolean",
              default: "false",
              description: "Show the export-as-Markdown action",
            },
            {
              name: "messages",
              type: "ChatMessage[]",
              description: "Messages used by the export action",
            },
            {
              name: "className",
              type: "string",
              description: "Additional class names for the wrapper",
            },
            {
              name: "children",
              type: "ReactNode",
              description: "Custom content rendered above the input",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "Chat/Components/ChatInput",
  component: ChatInput,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: { page: ChatInputDocsPage },
  },
} satisfies Meta<typeof ChatInput>;

export default meta;
type Story = StoryObj<typeof meta>;

function ComposerReview({
  initialInput = "Draft a release checklist",
  isLoading = false,
  withAttachments = false,
}: {
  initialInput?: string;
  isLoading?: boolean;
  withAttachments?: boolean;
}): React.ReactElement {
  const [input, setInput] = React.useState(initialInput);
  const [model, setModel] = React.useState(modelOptions[0]?.value);
  const [agent, setAgent] = React.useState(agentOptions[0].id);

  return (
    <StoryFrame maxWidth="820px">
      <ReviewSurface label="Composer">
        <ChatInput
          input={input}
          onChange={createChangeHandler(setInput)}
          onSubmit={() => undefined}
          isLoading={isLoading}
          placeholder="Type a prompt or a question..."
          stop={() => undefined}
          models={modelOptions}
          model={model}
          onModelChange={setModel}
          agentSelector={
            <AgentPicker
              agents={agentOptions}
              value={agent}
              onValueChange={setAgent}
            />
          }
          onAttach={() => undefined}
          onSelectAttachment={() => undefined}
          attachments={withAttachments ? attachments : undefined}
          onRemoveAttachment={() => undefined}
          className="pb-0"
        />
      </ReviewSurface>
    </StoryFrame>
  );
}

export const Default: Story = {
  tags: ["!dev"],
  render: () => <ComposerReview initialInput="" />,
};

export const WithAttachments: Story = {
  tags: ["!dev"],
  render: () => (
    <ComposerReview withAttachments initialInput="Review these files" />
  ),
};

export const Streaming: Story = {
  tags: ["!dev"],
  render: () => (
    <ComposerReview
      isLoading
      initialInput="Stop after this step"
    />
  ),
};
