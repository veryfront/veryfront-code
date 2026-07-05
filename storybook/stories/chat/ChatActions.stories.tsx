import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import { ChatActions } from "veryfront/chat";
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

const importCode = `import { ChatActions } from "veryfront/chat"`;

const compositionTree =
  `ChatActions            <- render the preset (props), or compose the sub-parts below
  +-- ChatActions.Root       <- DropdownMenu wrapper + context (aka <ChatActions>)
  +-- ChatActions.Trigger    <- the \`+\` button; pass a child to override (asChild)
  +-- ChatActions.Content    <- the portalled dropdown surface
  +-- ChatActions.Item       <- a single action row (icon? + label, closes on select)
  \`-- ChatActions.Preset     <- the data-driven body (attach row + actions + settings)`;

/** A stateful settings object so the submenu toggles are live in the docs. */
function useDemoSettings() {
  const [autoSubmit, setAutoSubmit] = React.useState(false);
  const [autoFixErrors, setAutoFixErrors] = React.useState(true);
  return {
    autoSubmit,
    autoFixErrors,
    onAutoSubmitChange: setAutoSubmit,
    onAutoFixErrorsChange: setAutoFixErrors,
  };
}

function ChatActionsDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="ChatActions"
        lead="The composer's `+` menu — a dropdown with a built-in `Attach Files or Photos` row plus your own data-driven `actions`, and a `Settings` submenu of toggles. Portals its surface via `Floating` so it never clips inside the input box."
      />

      <DocsSection
        title="Menu"
        description="`ChatActions` renders a `+` trigger and a dropdown of attach actions plus a Settings submenu. Each row is opt-in — pass only the callbacks you support."
      >
        <DocsExampleAuto of={Menu} />
      </DocsSection>

      <DocsSection
        title="Attach only"
        description="Omit `settings` to drop the Settings submenu and its separator — just the attach rows remain."
      >
        <DocsExampleAuto of={AttachOnly} />
      </DocsSection>

      <DocsSection
        title="Compose"
        description="Pass no `children` and `ChatActions` renders the data-driven preset above. Pass `children` and you own the anatomy: compose `ChatActions.Trigger` / `Content` / `Item` (each wires into the same menu). Drop `ChatActions.Preset` back in to keep the built-in rows alongside your own."
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
          component="ChatActions"
          description="The composer's `+` dropdown menu"
          props={[
            {
              name: "onAttachFiles",
              type: "() => void",
              description:
                "Selecting the attach-files row. The row is hidden when omitted.",
            },
            {
              name: "actions",
              type: "ChatActionItem[]",
              description:
                "Data-driven menu rows ({ icon, label, title?, onSelect }) — callers own every action, nothing app-specific is hardcoded.",
            },
            {
              name: "attachFilesLabel",
              type: "string",
              description:
                'Label for the attach-files row. Defaults to "Attach Files or Photos".',
            },
            {
              name: "settings",
              type: "ChatActionsSettings",
              description:
                "Settings submenu toggles (autoSubmit / autoFixErrors + change handlers). The submenu is hidden when omitted.",
            },
            {
              name: "trigger",
              type: "ReactNode",
              description:
                "Custom trigger, rendered via asChild. Defaults to a `+` IconButton.",
            },
            {
              name: "open / defaultOpen / onOpenChange",
              type: "boolean / boolean / (open) => void",
              description: "Controlled or uncontrolled open state of the menu.",
            },
            {
              name: "className",
              type: "string",
              description: "Additional class names for the menu surface.",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "Chat/Components/ChatActions",
  component: ChatActions,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: { page: ChatActionsDocsPage },
  },
} satisfies Meta<typeof ChatActions>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Menu: Story = {
  tags: ["!dev"],
  render: () => {
    const settings = useDemoSettings();
    return (
      <StoryFrame maxWidth="420px">
        <ReviewSurface label="ChatActions">
          <div className="flex min-h-[280px] items-start">
            <ChatActions
              onAttachFiles={() => undefined}
              actions={[
                { label: "Add from URL", onSelect: () => undefined },
                { label: "Connect data source", onSelect: () => undefined },
              ]}
              settings={settings}
            />
          </div>
        </ReviewSurface>
      </StoryFrame>
    );
  },
  parameters: {
    docs: {
      source: {
        code: `<ChatActions
  onAttachFiles={handleAttachFiles}
  actions={[
    { label: "Add from URL", onSelect: handleAddUrl },
    { label: "Connect data source", onSelect: handleConnect },
  ]}
  settings={{
    autoSubmit,
    autoFixErrors,
    onAutoSubmitChange: setAutoSubmit,
    onAutoFixErrorsChange: setAutoFixErrors,
  }}
/>`,
      },
    },
  },
};

export const AttachOnly: Story = {
  tags: ["!dev"],
  render: () => (
    <StoryFrame maxWidth="420px">
      <ReviewSurface label="Attach only">
        <div className="flex min-h-[160px] items-start">
          <ChatActions
            onAttachFiles={() => undefined}
            actions={[{ label: "Add from URL", onSelect: () => undefined }]}
          />
        </div>
      </ReviewSurface>
    </StoryFrame>
  ),
  parameters: {
    docs: {
      source: {
        code: `<ChatActions
  onAttachFiles={handleAttachFiles}
  actions={[{ label: "Add from URL", onSelect: handleAddUrl }]}
/>`,
      },
    },
  },
};

export const Composed: Story = {
  tags: ["!dev"],
  render: () => (
    <StoryFrame maxWidth="420px">
      <ReviewSurface label="Composed">
        <div className="flex min-h-[220px] items-start">
          <ChatActions.Root>
            <ChatActions.Trigger />
            <ChatActions.Content>
              <ChatActions.Item onSelect={() => undefined}>
                Add from URL
              </ChatActions.Item>
              <ChatActions.Item onSelect={() => undefined}>
                Connect data source
              </ChatActions.Item>
            </ChatActions.Content>
          </ChatActions.Root>
        </div>
      </ReviewSurface>
    </StoryFrame>
  ),
  parameters: {
    docs: {
      source: {
        code: `<ChatActions.Root>
  <ChatActions.Trigger />
  <ChatActions.Content>
    <ChatActions.Item onSelect={handleAddUrl}>Add from URL</ChatActions.Item>
    <ChatActions.Item onSelect={handleConnect}>Connect data source</ChatActions.Item>
  </ChatActions.Content>
</ChatActions.Root>`,
      },
    },
  },
};
