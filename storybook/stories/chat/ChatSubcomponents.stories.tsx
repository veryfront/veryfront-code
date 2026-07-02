import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import {
  Attachment,
  InferenceBadge,
  InlineCitation,
  MessageActionBar,
  ModelSelector,
  QuickActions,
  Reasoning,
  SkillBadge,
  Sources,
  StepIndicator,
  ToolCall,
  ToolStatusBadge,
  UploadsPanel,
} from "veryfront/chat";
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
  completedToolPart,
  erroredToolPart,
  modelOptions,
  quickActions,
  sourceList,
  uploads,
} from "../fixtures/chat";

const importCode =
  `import { ToolCall, Sources, Reasoning, MessageActionBar } from "veryfront/chat"`;

const compositionTree = `Message.Content  <- composes the subcomponents per message
  +-- Reasoning  <- collapsible reasoning / thinking trace
  +-- ToolCall  <- tool invocation with input + output
  +-- Sources  <- source pills (with InlineCitation in body text)
  +-- MessageActionBar  <- copy / edit controls on hover`;

function ChatSubcomponentsDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Composition — Subcomponents"
        lead="The standalone pieces a message is built from — `ToolCall`, `Sources`, `Reasoning`, and `MessageActionBar` — plus the supporting badges and selectors."
      />

      <DocsSection
        title="Component gallery"
        description="Each exported subcomponent rendered in isolation."
      >
        <DocsExampleAuto of={ComponentGallery} />
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
          description="Renders a tool invocation with parameters and results"
          props={[
            {
              name: "tool",
              type: "ChatToolPart | ChatDynamicToolPart",
              description: "The tool-call part to render",
            },
          ]}
        />
        <DocsPropsTable
          component="Sources"
          description="Source citation pills"
          props={[
            {
              name: "sources",
              type: "Source[]",
              description: "Sources to render as pills",
            },
            {
              name: "onSourceClick",
              type: "(source: Source, index: number) => void",
              description: "Called when a source pill is clicked",
            },
            {
              name: "className",
              type: "string",
              description: "Additional class names",
            },
          ]}
        />
        <DocsPropsTable
          component="Reasoning"
          description="Collapsible reasoning / thinking trace"
          props={[
            {
              name: "text",
              type: "string",
              description: "Reasoning text to render as markdown",
            },
            {
              name: "isStreaming",
              type: "boolean",
              default: "false",
              description: "Show the live shimmer while streaming",
            },
            {
              name: "className",
              type: "string",
              description: "Additional class names",
            },
          ]}
        />
        <DocsPropsTable
          component="MessageActionBar"
          description="Context-free copy / edit / regenerate bar (inside a Message, prefer Message.Actions + Message.CopyAction)"
          props={[
            {
              name: "content",
              type: "string",
              description: "Text copied / edited by the actions",
            },
            {
              name: "onEdit",
              type: "(content: string) => void",
              description: "When provided, renders an edit button",
            },
            {
              name: "icons",
              type: "{ copy?, copied?, edit?, regenerate? }",
              description: "Override any of the action icons",
            },
            {
              name: "onCopy",
              type: "(e, next) => void",
              description: "Wrap the built-in copy; call next() to run it",
            },
            {
              name: "className",
              type: "string",
              description: "Additional class names",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "Chat/Composition/Subcomponents",
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: { page: ChatSubcomponentsDocsPage },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const ComponentGallery: Story = {
  tags: ["!dev"],
  render: () => {
    const [model, setModel] = React.useState(modelOptions[0]?.value ?? "");

    return (
      <div className="vf-story-canvas">
        <div className="mx-auto max-w-6xl space-y-4">
          <div className="vf-component-grid">
            <section className="vf-component-surface">
              <p className="vf-component-label">ToolCall</p>
              <div className="space-y-3">
                <ToolCall tool={completedToolPart} />
                <ToolCall tool={erroredToolPart} />
              </div>
            </section>

            <section className="vf-component-surface">
              <p className="vf-component-label">Sources</p>
              <Sources sources={sourceList} onSourceClick={() => undefined} />
              <p className="mt-4 text-sm leading-6 text-[var(--foreground)]">
                Answer text with an{" "}
                <InlineCitation index={0} source={sourceList[0]} />{" "}
                inline citation.
              </p>
            </section>

            <section className="vf-component-surface">
              <p className="vf-component-label">Reasoning</p>
              <Reasoning
                text="I checked the run state, the tool calls, and the user-facing copy before recommending the release path."
                isStreaming
              />
            </section>

            <section className="vf-component-surface">
              <p className="vf-component-label">MessageActionBar</p>
              <div className="group/msg inline-flex rounded-[var(--radius-md)] border border-[var(--outline-border)] p-2">
                {/* Compose demo: a swapped copy icon + a logged click that still
                    runs the default copy — no ejecting required. */}
                <MessageActionBar
                  content="Copy or edit this assistant answer."
                  onEdit={() => undefined}
                  icons={{ copy: <span className="text-[13px] leading-none">✨</span> }}
                  onCopy={(_e, next) => {
                    console.log("copy clicked");
                    next();
                  }}
                />
              </div>
            </section>

            <section className="vf-component-surface">
              <p className="vf-component-label">ModelSelector</p>
              <div className="flex justify-end">
                <ModelSelector
                  models={modelOptions}
                  value={model}
                  onChange={setModel}
                />
              </div>
            </section>

            <section className="vf-component-surface">
              <p className="vf-component-label">QuickActions</p>
              <QuickActions
                actions={quickActions}
                onActionClick={() => undefined}
              />
            </section>

            <section className="vf-component-surface">
              <p className="vf-component-label">Attachments</p>
              <div className="flex flex-wrap gap-2">
                {attachments.map((attachment) => (
                  <Attachment
                    key={attachment.id}
                    attachment={attachment}
                    onRemove={() => undefined}
                  />
                ))}
              </div>
            </section>

            <section className="vf-component-surface">
              <p className="vf-component-label">UploadsPanel</p>
              <div className="h-48 rounded-[var(--radius-lg)] border border-[var(--outline-border)]">
                <UploadsPanel
                  uploads={uploads}
                  onRemoveUpload={() => undefined}
                />
              </div>
            </section>

            <section className="vf-component-surface">
              <p className="vf-component-label">Status badges</p>
              <div className="flex flex-wrap gap-2">
                <ToolStatusBadge state="input-available" />
                <ToolStatusBadge state="output-available" />
                <ToolStatusBadge state="output-error" />
                <SkillBadge
                  tool={{
                    type: "tool-load_skill",
                    toolCallId: "skill-1",
                    toolName: "load_skill",
                    state: "output-available",
                    input: { skillId: "frontend-ui-ux" },
                  }}
                />
                <InferenceBadge inferenceMode="server-local" />
              </div>
            </section>

            <section className="vf-component-surface">
              <p className="vf-component-label">StepIndicator</p>
              <StepIndicator stepIndex={0} isComplete />
              <StepIndicator stepIndex={1} isComplete={false} />
            </section>
          </div>
        </div>
      </div>
    );
  },
};
