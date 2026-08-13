import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
} from "../../../src/react/components/ui/index.ts";

const importCode =
  `import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle, AlertDialogTrigger } from "veryfront/ui"`;

const compositionTree =
  `AlertDialog                          <- Owns open state; no dismiss on outside-click / Escape
+-- AlertDialogTrigger               <- Opens the confirm modal
+-- AlertDialogContent               <- role="alertdialog", labelled + described
|   +-- AlertDialogTitle             <- Required accessible name
|   +-- AlertDialogDescription       <- Required supporting copy
|   +-- AlertDialogFooter            <- Right-aligned action row
|   |   +-- AlertDialogCancel        <- Closes without confirming
|   |   +-- AlertDialogAction        <- Runs onClick, then closes`;

/** "Delete account" confirmation with a destructive Action, driven by local state. */
function DeleteAccountConfirm() {
  const [deleted, setDeleted] = useState(false);
  return (
    <div className="flex flex-col items-start gap-3">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="destructive">Delete account</Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogTitle>Delete account?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently removes your account and all of its data. This action cannot be undone.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => setDeleted(true)}>
              Delete account
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <p className="text-sm text-[var(--muted-foreground)]">
        {deleted ? "Account deleted." : "Account active."}
      </p>
    </div>
  );
}

function AlertDialogDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="AlertDialog"
        lead="A confirmation modal - a Dialog with role='alertdialog', a required title + description, and explicit Action / Cancel buttons. It does not dismiss on outside-click or Escape; the user must choose."
      />

      <DocsSection
        title="Destructive confirm"
        description="A 'Delete account' flow: the trigger opens the modal, the destructive Action runs its onClick then closes, and Cancel closes without confirming."
      >
        <DocsExampleAuto of={DeleteAccount} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>{compositionTree}</DocsComposition>
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="AlertDialog"
          description="Confirmation modal root - owns open state"
          props={[
            {
              name: "open",
              type: "boolean",
              description: "Controlled open state (pair with onOpenChange)",
            },
            {
              name: "defaultOpen",
              type: "boolean",
              default: "false",
              description: "Initial open state when uncontrolled",
            },
            {
              name: "onOpenChange",
              type: "(open: boolean) => void",
              description: "Fires when the open state changes",
            },
            {
              name: "children",
              type: "React.ReactNode",
              description: "The trigger and content parts to compose",
            },
          ]}
        />
        <DocsPropsTable
          component="AlertDialogAction"
          description="Confirming action button - runs its onClick, then closes"
          props={[
            {
              name: "variant",
              type: "ButtonProps['variant']",
              default: "'primary'",
              description: "Button style - pass 'destructive' for dangerous actions",
            },
            {
              name: "onClick",
              type: "(e: MouseEvent) => void",
              description: "Runs before the dialog closes",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "UI/AlertDialog",
  component: AlertDialog,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: { page: AlertDialogDocsPage },
  },
} satisfies Meta<typeof AlertDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DeleteAccount: Story = {
  tags: ["!dev"],
  render: () => <DeleteAccountConfirm />,
};
