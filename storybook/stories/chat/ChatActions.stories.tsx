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

const compositionTree = `ChatActions  <- the composer's \`+\` menu (DropdownMenu)
  +-- DropdownMenuTrigger  <- \`+\` IconButton (override with \`trigger\`)
  +-- DropdownMenuContent  <- portalled surface (Floating)
        +-- "Attach Files or Photos"  <- onAttachFiles
        +-- "Attach Figma File"       <- onAttachFigma
        +-- Settings                  <- nested submenu (Floating)
              +-- Auto-send queue   (Switch)
              +-- Autofix errors    (Switch)`;

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
        lead="The composer's `+` menu — a dropdown with the built-in attach rows (`Attach Files or Photos`, `Attach Figma File`) and a `Settings` submenu of toggles. Portals its surface via `Floating` so it never clips inside the input box."
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
              name: "onAttachFigma",
              type: "() => void",
              description:
                "Selecting the attach-Figma row. The row is hidden when omitted.",
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
              defaultOpen
              onAttachFiles={() => undefined}
              onAttachFigma={() => undefined}
              settings={settings}
            />
          </div>
        </ReviewSurface>
      </StoryFrame>
    );
  },
};

export const AttachOnly: Story = {
  tags: ["!dev"],
  render: () => (
    <StoryFrame maxWidth="420px">
      <ReviewSurface label="Attach only">
        <div className="flex min-h-[160px] items-start">
          <ChatActions
            defaultOpen
            onAttachFiles={() => undefined}
            onAttachFigma={() => undefined}
          />
        </div>
      </ReviewSurface>
    </StoryFrame>
  ),
};
