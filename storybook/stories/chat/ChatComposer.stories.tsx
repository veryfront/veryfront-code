import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import { AttachmentPill, ChatComposer, ModelSelector } from "veryfront/chat";
import type { ChatMessage } from "veryfront/chat";
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
  chatMessages,
  createChangeHandler,
  modelOptions,
} from "../fixtures/chat";
import { ReviewSurface, StoryFrame } from "../support/StoryFrame";

const importCode = `import { ChatComposer } from "veryfront/chat"`;

const compositionTree = `ChatComposer  <- input form (forwardRef to the outer div)
  +-- AttachmentPill  <- one per attachments[] entry
  +-- InputBox  <- multiline message input
  +-- ModelSelector  <- shown when models + onModelChange are set
  +-- Export button  <- shown when showExport + messages are set
  +-- SubmitButton  <- send / stop / voice`;

function ChatComposerDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="ChatComposer"
        lead="The chat input area — message field, attachments, model selector, export, and submit, wired through controlled props."
      />

      <DocsSection
        title="Default"
        description="A controlled composer with a model selector and export action."
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

      <DocsSection
        title="Model only"
        description="`ModelSelector` as it appears inside the composer toolbar."
      >
        <DocsExampleAuto of={ModelOnly} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>{compositionTree}</DocsComposition>
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="ChatComposer"
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
  title: "Chat/Components/ChatComposer",
  component: ChatComposer,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: { page: ChatComposerDocsPage },
  },
} satisfies Meta<typeof ChatComposer>;

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
  const [messages] = React.useState<ChatMessage[]>(chatMessages);

  return (
    <StoryFrame maxWidth="820px">
      <ReviewSurface label="Composer">
        <ChatComposer
          input={input}
          onChange={createChangeHandler(setInput)}
          onSubmit={() => undefined}
          isLoading={isLoading}
          stop={() => undefined}
          models={modelOptions}
          model={model}
          onModelChange={setModel}
          onAttach={() => undefined}
          onSelectAttachment={() => undefined}
          attachments={withAttachments ? attachments : undefined}
          onRemoveAttachment={() => undefined}
          showExport
          messages={messages}
          className="pb-0"
        >
          {withAttachments
            ? attachments.map((attachment) => (
              <AttachmentPill key={attachment.id} attachment={attachment} />
            ))
            : null}
        </ChatComposer>
      </ReviewSurface>
    </StoryFrame>
  );
}

export const Default: Story = {
  tags: ["!dev"],
  render: () => <ComposerReview />,
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

export const ModelOnly: Story = {
  tags: ["!dev"],
  render: () => {
    const [model, setModel] = React.useState(modelOptions[0]?.value);

    return (
      <StoryFrame maxWidth="420px">
        <ReviewSurface label="ModelSelector inside composer toolbar">
          <div className="flex justify-end">
            <ModelSelector
              models={modelOptions}
              value={model}
              onChange={setModel}
            />
          </div>
        </ReviewSurface>
      </StoryFrame>
    );
  },
};
