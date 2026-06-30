import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import {
  AttachmentPill,
  InferenceBadge,
  InlineCitation,
  MessageActions,
  ModelSelector,
  QuickActions,
  ReasoningCard,
  SkillBadge,
  Sources,
  StepIndicator,
  ToolCallCard,
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
  `import { ToolCallCard, Sources, ReasoningCard, MessageActions } from "veryfront/chat"`;

const compositionTree = `Message.Content  <- composes the subcomponents per message
  +-- ReasoningCard  <- collapsible reasoning / thinking trace
  +-- ToolCallCard  <- tool invocation with input + output
  +-- Sources  <- source pills (with InlineCitation in body text)
  +-- MessageActions  <- copy / edit controls on hover`;

function ChatSubcomponentsDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Composition — Subcomponents"
        lead="The standalone pieces a message is built from — `ToolCallCard`, `Sources`, `ReasoningCard`, and `MessageActions` — plus the supporting badges and selectors."
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
          component="ToolCallCard"
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
          component="ReasoningCard"
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
          component="MessageActions"
          description="Copy / edit controls shown on a message"
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
              <p className="vf-component-label">ToolCallCard</p>
              <div className="space-y-3">
                <ToolCallCard tool={completedToolPart} />
                <ToolCallCard tool={erroredToolPart} />
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
              <p className="vf-component-label">ReasoningCard</p>
              <ReasoningCard
                text="I checked the run state, the tool calls, and the user-facing copy before recommending the release path."
                isStreaming
              />
            </section>

            <section className="vf-component-surface">
              <p className="vf-component-label">MessageActions</p>
              <div className="group/msg inline-flex rounded-[var(--radius-md)] border border-[var(--outline-border)] p-2">
                <MessageActions
                  content="Copy or edit this assistant answer."
                  onEdit={() => undefined}
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
                  <AttachmentPill
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
