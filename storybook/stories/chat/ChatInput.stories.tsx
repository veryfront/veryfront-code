import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import { AgentPicker, ChatInput } from "veryfront/chat";
import type { AgentOption, AttachmentInfo } from "veryfront/chat";
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
  filesToAttachments,
  modelOptions,
} from "../fixtures/chat";

const importCode = `import { ChatInput } from "veryfront/chat"`;

const agentOptions: AgentOption[] = [
  { id: "veryfront", name: "Veryfront Agent" },
  { id: "inbox-helper", name: "Inbox Helper" },
  { id: "researcher", name: "Research Agent" },
];

const compositionTree = `ChatInput  <- batteries-included input form
  +-- ChatInput.Root     <- composer state provider
  +-- ChatInput.Field    <- multiline message input
  +-- ChatInput.Toolbar  <- action layout slot
      +-- Attach / Model / Export / Voice / Stop / Send`;

function ChatInputDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="ChatInput"
        lead="The chat input area: message field, attachments, agent and model selectors, and submit, wired through controlled props."
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
        title="Drag and drop"
        description="Drag files onto the composer card (Studio `PromptForm`): a dashed border and a “Drop files” overlay appear, and on drop `onDrop` (falling back to `onAttach`) receives the `FileList`. Wire it to your attachment state and the dropped files become pills."
      >
        <DocsExampleAuto of={DragAndDrop} />
      </DocsSection>

      <DocsSection
        title="Streaming"
        description="While `isLoading` is true the input is disabled and the submit button becomes a stop control."
      >
        <DocsExampleAuto of={Streaming} />
      </DocsSection>

      <DocsSection
        title="Composed"
        description="`ChatInput` is render-or-compose. Use `ChatInput.Root` (provides ComposerContext) and arrange `ChatInput.Field` with the toolbar sub-parts (`Send`/`Attach`/`Model`/`Export` and others). Presence controls which actions render."
      >
        <DocsExampleAuto of={Composed} />
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
              description: "Action used by a composed ChatInput.Voice",
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
  const [files, setFiles] = React.useState<AttachmentInfo[]>(
    withAttachments ? attachments : [],
  );

  // Both the `+` menu upload and a drag-and-drop land here, so the composer is
  // fully working: dropped files become attachment pills above the input.
  const addFiles = (list: FileList) =>
    setFiles((current) => [...current, ...filesToAttachments(list)]);

  // Rendered exactly as it appears inside <Chat>, with no review chrome, so the
  // composer looks identical across the ChatInput and Chat docs.
  return (
    <div className="vf-story-canvas">
      <div className="mx-auto w-full max-w-[850px]">
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
          toolbarStart={
            <AgentPicker
              agents={agentOptions}
              value={agent}
              onValueChange={setAgent}
            />
          }
          onAttach={addFiles}
          onDrop={addFiles}
          attachments={files}
          onRemoveAttachment={(id) =>
            setFiles((current) => current.filter((file) => file.id !== id))}
        />
      </div>
    </div>
  );
}

export const Default: Story = {
  tags: ["!dev"],
  render: () => <ComposerReview initialInput="" />,
  parameters: {
    docs: {
      source: {
        code: `<ChatInput
  input={input}
  onChange={onChange}
  onSubmit={handleSubmit}
  models={models}
  model={model}
  onModelChange={setModel}
  onAttach={handleAttach}
  onSelectAttachment={openPicker}
  toolbarStart={<AgentPicker agents={agents} value={agent} onValueChange={setAgent} />}
/>`,
      },
    },
  },
};

export const WithAttachments: Story = {
  tags: ["!dev"],
  render: () => (
    <ComposerReview withAttachments initialInput="Review these files" />
  ),
  parameters: {
    docs: {
      source: {
        code: `<ChatInput
  input={input}
  onChange={onChange}
  onSubmit={handleSubmit}
  attachments={attachments}
  onRemoveAttachment={handleRemove}
  onAttach={handleAttach}
/>`,
      },
    },
  },
};

export const DragAndDrop: Story = {
  name: "Drag and drop",
  tags: ["!dev"],
  render: () => <ComposerReview initialInput="Drag a file onto me" />,
  parameters: {
    docs: {
      source: {
        code: `const [files, setFiles] = React.useState<AttachmentInfo[]>([]);
const addFiles = (list: FileList) =>
  setFiles((cur) => [...cur, ...filesToAttachments(list)]);

<ChatInput
  input={input}
  onChange={onChange}
  onSubmit={handleSubmit}
  onAttach={addFiles}   // + menu upload
  onDrop={addFiles}     // drag onto the composer
  attachments={files}
  onRemoveAttachment={(id) =>
    setFiles((cur) => cur.filter((f) => f.id !== id))}
/>`,
      },
    },
  },
};

function ComposedComposer(): React.ReactElement {
  const [input, setInput] = React.useState(
    "Composed from ChatInput.Root + parts",
  );
  return (
    <div className="vf-story-canvas">
      <div className="mx-auto w-full max-w-[850px]">
        <ChatInput.Root
          input={input}
          onChange={createChangeHandler(setInput)}
          onSubmit={() => undefined}
          onAttach={() => undefined}
          onVoice={() => undefined}
          models={modelOptions}
          model={modelOptions[0]?.value}
          onModelChange={() => undefined}
        >
          <div className="rounded-[var(--radius-lg)] bg-[var(--secondary)] px-4 pt-3 pb-3 shadow-sm">
            <ChatInput.Field placeholder="Composed composer..." />
            <div className="mt-2.5 flex items-center justify-between">
              <ChatInput.Attach />
              <div className="flex items-center gap-1.5">
                <ChatInput.Model />
                <ChatInput.Export messages={chatMessages} />
                <ChatInput.Voice />
                <ChatInput.Send
                  icon={<span className="text-[15px] leading-none">🚀</span>}
                  onClick={(_e, next) => {
                    console.log("send clicked");
                    next();
                  }}
                />
              </div>
            </div>
          </div>
        </ChatInput.Root>
      </div>
    </div>
  );
}

export const Composed: Story = {
  tags: ["!dev", "acid-test"],
  render: () => <ComposedComposer />,
  parameters: {
    docs: {
      source: {
        code: `<ChatInput.Root
  input={input}
  onChange={onChange}
  onSubmit={submit}
  onAttach={attach}
  onVoice={toggleVoice}
>
  <div className="... card">
    <ChatInput.Field placeholder="Composed composer..." />
    <div className="toolbar">
      <ChatInput.Attach />
      <ChatInput.Model />
      <ChatInput.Export messages={messages} />
      <ChatInput.Voice />
      <ChatInput.Send
        icon={<RocketIcon />}
        onClick={(e, next) => { console.log("send"); next(); }}
      />
    </div>
  </div>
</ChatInput.Root>`,
      },
    },
  },
};

export const Streaming: Story = {
  tags: ["!dev"],
  render: () => (
    <ComposerReview
      isLoading
      initialInput="Stop after this step"
    />
  ),
  parameters: {
    docs: {
      source: {
        code: `<ChatInput
  input={input}
  onChange={onChange}
  onSubmit={handleSubmit}
  isLoading
  stop={handleStop}
/>`,
      },
    },
  },
};
