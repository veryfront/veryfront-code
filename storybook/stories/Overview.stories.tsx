import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import {
  AgentCard,
  AttachmentPill,
  ModelSelector,
  ReasoningCard,
  Sources,
} from "veryfront/chat";
import {
  agentCardMessages,
  agentCardTools,
  attachments,
  modelOptions,
  sourceList,
} from "./fixtures/chat";

// Top-level gallery that combines the shipped chat components on a single
// page, mirroring the Veryfront Studio "Overview" concept. Tagged `showcase`
// so the manager hides the addon panel (no args to control here).
const meta = {
  title: "Veryfront UI/Overview",
  tags: ["showcase"],
  parameters: {
    layout: "fullscreen",
    docs: { disable: true },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function ModelSelectorDemo(): React.ReactElement {
  const [model, setModel] = React.useState(modelOptions[0]?.value);
  return (
    <ModelSelector models={modelOptions} value={model} onChange={setModel} />
  );
}

export const Gallery: Story = {
  render: () => (
    <div className="vf-story-canvas">
      <div className="mx-auto w-full" style={{ maxWidth: "1180px" }}>
        <header style={{ marginBottom: "24px" }}>
          <h1
            style={{
              margin: "0 0 4px",
              fontSize: "28px",
              fontWeight: 600,
              color: "var(--foreground)",
            }}
          >
            Veryfront UI
          </h1>
          <p style={{ margin: 0, color: "var(--soft, rgba(0,0,0,0.6))" }}>
            The chat components Veryfront ships, at a glance. Open each
            component in the sidebar for states, props, and code.
          </p>
        </header>
        <div className="vf-component-grid">
          <section className="vf-component-surface">
            <p className="vf-component-label">ModelSelector</p>
            <ModelSelectorDemo />
          </section>
          <section className="vf-component-surface">
            <p className="vf-component-label">AttachmentPill</p>
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
            <p className="vf-component-label">ReasoningCard</p>
            <ReasoningCard text="Comparing run state, recent tool calls, and deploy preconditions before recommending." />
          </section>
          <section className="vf-component-surface">
            <p className="vf-component-label">Sources</p>
            <Sources sources={sourceList} onSourceClick={() => undefined} />
          </section>
          <section
            className="vf-component-surface"
            style={{ gridColumn: "1 / -1" }}
          >
            <p className="vf-component-label">AgentCard</p>
            <AgentCard
              status="completed"
              toolCalls={agentCardTools.slice(0, 1)}
              messages={agentCardMessages}
            />
          </section>
        </div>
      </div>
    </div>
  ),
};
