import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Button,
  Dialog,
  DialogAction,
  DialogBody,
  DialogCancel,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../../../src/react/components/chat/ui/index.ts";
import {
  DocsCode,
  DocsComposition,
  DocsExampleAuto,
  DocsHero,
  DocsPage,
  DocsPropsTable,
  DocsSection,
} from "../../.storybook/docs";

const importCode =
  `import {
  Dialog, DialogTrigger, DialogContent, DialogHeader,
  DialogTitle, DialogDescription, DialogBody, DialogFooter,
  DialogAction, DialogCancel,
} from "veryfront/chat/ui"`;

const compositionTree =
  `Dialog              <- owns open state
  +-- DialogTrigger      <- opens (asChild merges onto your element)
  +-- DialogContent      <- overlay + centered panel; Escape / overlay-click dismiss
       +-- DialogHeader       <- DialogTitle + DialogDescription
       +-- DialogBody         <- scrollable area (bottom edge-fade)
       +-- DialogFooter       <- DialogAction (primary) + DialogCancel`;

function DialogDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Dialog"
        lead="A modal — confirmations, settings. Basic behavior (Escape / overlay-click dismiss); focus-trap, scroll-lock and portal are TODO. For in-chat confirms, prefer Popover."
      />
      <DocsSection title="Confirm" description="Click the trigger to open.">
        <DocsExampleAuto of={Confirm} />
      </DocsSection>
      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>
      <DocsSection title="Composition">
        <DocsComposition>{compositionTree}</DocsComposition>
      </DocsSection>
      <DocsSection title="API Reference">
        <DocsPropsTable
          component="Dialog"
          props={[
            { name: "open / defaultOpen", type: "boolean", description: "Controlled / uncontrolled state" },
            { name: "onOpenChange", type: "(open) => void", description: "Open-state callback" },
          ]}
        />
        <DocsPropsTable
          component="DialogAction"
          props={[
            { name: "isLoading", type: "boolean", description: "Pulse + disable while pending" },
            { name: "variant / size", type: "ButtonProps", description: "Defaults to primary / default" },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "Chat/UI/Dialog",
  component: Dialog,
  tags: ["autodocs"],
  parameters: { layout: "centered", docs: { page: DialogDocsPage } },
} satisfies Meta<typeof Dialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Confirm: Story = {
  tags: ["!dev"],
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="secondary">Delete conversation</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete conversation?</DialogTitle>
          <DialogDescription>
            This permanently removes the conversation and its messages. This
            action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <span className="text-sm text-[var(--foreground)]">
            12 messages will be deleted.
          </span>
        </DialogBody>
        <DialogFooter>
          <DialogAction variant="destructive">Delete</DialogAction>
          <DialogCancel>Cancel</DialogCancel>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
};
