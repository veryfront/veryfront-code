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
  Input,
  Label,
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

const importCode = `import {
  Dialog,
  DialogAction,
  DialogBody,
  DialogCancel,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "veryfront/chat/ui"`;

const compositionTree = `Dialog                           <- Root
+-- DialogTrigger                <- opens the dialog
+-- DialogContent                <- Overlay + sand surface, no X close
    +-- DialogHeader             <- Left-aligned column wrapper
    |   +-- DialogTitle          <- Heading level 2, left-aligned
    |   +-- DialogDescription    <- Body text, left-aligned, foreground
    +-- DialogBody               <- Scrollable form / long-content area, left-aligned, fade overflow
    +-- DialogFooter             <- Sticky row, action LEFT, cancel RIGHT
        +-- DialogAction         <- Primary/destructive pill (defaults to primary)
        +-- DialogCancel         <- Secondary pill (defaults to secondary, closes the dialog)`;

function DialogDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Dialog"
        lead="Left-aligned modal for forms, settings, and focused content. No X close — dismiss via Esc, overlay, or Cancel."
      />

      <DocsSection title="Create Project (form, no description)">
        <DocsExampleAuto of={CreateProject} />
      </DocsSection>

      <DocsSection title="Edit Profile (form with description)">
        <DocsExampleAuto of={EditProfile} />
      </DocsSection>

      <DocsSection title="Terms of Service (long content)" description="DialogBody caps height and scrolls.">
        <DocsExampleAuto of={TermsOfService} />
      </DocsSection>

      <DocsSection
        title="Button Variants"
        description={
          <>
            Defaults: <code>action = primary</code>, <code>cancel = secondary</code>.
          </>
        }
      >
        <DocsExampleAuto of={ButtonVariants} />
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
          description="Root"
          props={[
            { name: "open", type: "boolean", description: "Controlled open state" },
            { name: "defaultOpen", type: "boolean", default: "false", description: "Uncontrolled initial open state" },
            { name: "onOpenChange", type: "(open) => void", description: "Open-state change handler" },
          ]}
        />
        <DocsPropsTable
          component="DialogContent"
          description="Overlay + sand surface, no X close"
          props={[{ name: "className", type: "string", description: "Additional classes on the panel" }]}
        />
        <DocsPropsTable
          component="DialogHeader"
          description="Left-aligned column wrapper for title + description"
          props={[{ name: "children", type: "ReactNode", description: "Title and optional description" }]}
        />
        <DocsPropsTable
          component="DialogBody"
          description="Scrollable form / long-content area, left-aligned"
          props={[{ name: "children", type: "ReactNode", description: "Body content" }]}
        />
        <DocsPropsTable
          component="DialogFooter"
          description="Sticky row, action LEFT, cancel RIGHT"
          props={[{ name: "children", type: "ReactNode", description: "Action / cancel buttons" }]}
        />
        <DocsPropsTable
          component="DialogAction"
          description="Confirm pill (defaults to primary)"
          props={[
            { name: "variant", type: "ButtonProps['variant']", default: "'primary'", description: "Button variant (e.g. destructive)" },
            { name: "isLoading", type: "boolean", description: "Shows a loading spinner" },
          ]}
        />
        <DocsPropsTable
          component="DialogCancel"
          description="Cancel pill (defaults to secondary, closes the dialog)"
          props={[{ name: "variant", type: "ButtonProps['variant']", default: "'secondary'", description: "Button variant" }]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "Chat/UI/Dialog",
  component: Dialog,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: { page: DialogDocsPage },
  },
} satisfies Meta<typeof Dialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/* -------------------------------------------------------------------------------------------------
 * Create Project — form, no description (mirrors the canonical Create Project layout)
 * -------------------------------------------------------------------------------------------------*/

export const CreateProject: Story = {
  name: "Create Project",
  tags: ["!dev"],
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="secondary" size="default">
          Open Create Project
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Project</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-2">
            <Label size="sm" htmlFor="create-project-name">
              Project name
            </Label>
            <Input id="create-project-name" placeholder="Project name" />
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogAction>Create</DialogAction>
          <DialogCancel>Cancel</DialogCancel>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
};

/* -------------------------------------------------------------------------------------------------
 * Edit Profile — form with description and multiple fields
 * -------------------------------------------------------------------------------------------------*/

export const EditProfile: Story = {
  name: "Edit Profile",
  tags: ["!dev"],
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="secondary" size="default">
          Open Edit Profile
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Profile</DialogTitle>
          <DialogDescription>Update your information</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-2">
            <Label size="sm" htmlFor="edit-profile-name">
              Name
            </Label>
            <Input id="edit-profile-name" placeholder="Full name" />
          </div>
          <div className="flex flex-col gap-2">
            <Label size="sm" htmlFor="edit-profile-email">
              Email
            </Label>
            <Input id="edit-profile-email" type="email" placeholder="Your email" />
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogAction>Save changes</DialogAction>
          <DialogCancel>Cancel</DialogCancel>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
};

/* -------------------------------------------------------------------------------------------------
 * Terms of Service — long content body, fade overflow into sticky footer
 * -------------------------------------------------------------------------------------------------*/

const termsParagraph =
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.";

export const TermsOfService: Story = {
  name: "Terms of Service",
  tags: ["!dev"],
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="secondary" size="default">
          Open Terms
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Terms of Service</DialogTitle>
          <DialogDescription>Please review before continuing.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          {Array.from({ length: 5 }).map((_, index) => (
            <p key={index} className="text-base leading-relaxed">
              {termsParagraph}
            </p>
          ))}
        </DialogBody>
        <DialogFooter>
          <DialogAction>Accept</DialogAction>
          <DialogCancel>Decline</DialogCancel>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
};

/* -------------------------------------------------------------------------------------------------
 * Button Variants — variants accepted by DialogAction / DialogCancel
 * -------------------------------------------------------------------------------------------------*/

export const ButtonVariants: Story = {
  name: "Button Variants",
  tags: ["!dev"],
  render: () => (
    <div className="flex items-center gap-3">
      <Button variant="primary">Save</Button>
      <Button variant="destructive">Delete</Button>
      <Button variant="secondary">Cancel</Button>
    </div>
  ),
  parameters: {
    docs: {
      source: {
        code: `{/* Primary action (default) */}
<DialogAction>Save</DialogAction>

{/* Destructive action */}
<DialogAction variant="destructive">Delete</DialogAction>

{/* Cancel — defaults to secondary, closes the dialog */}
<DialogCancel>Cancel</DialogCancel>`,
      },
    },
  },
};
