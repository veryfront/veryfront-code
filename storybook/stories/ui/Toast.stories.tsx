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
  Toast,
  ToastProvider,
  type ToastVariant,
  useToast,
} from "../../../src/react/components/ui/index.ts";

const importCode = `import { ToastProvider, useToast } from "veryfront/ui"`;

const usageCode = `function SaveButton() {
  const { toast } = useToast();
  return (
    <button
      type="button"
      onClick={() =>
        toast({ title: "Saved", description: "Your changes are live.", variant: "success" })}
    >
      Save
    </button>
  );
}

function App() {
  return (
    <ToastProvider>
      <SaveButton />
    </ToastProvider>
  );
}`;

function TriggerButton({ variant }: { variant: ToastVariant }) {
  const { toast } = useToast();
  const copy: Record<ToastVariant, { title: string; description: string }> = {
    default: { title: "Heads up", description: "This is a neutral notification." },
    success: { title: "Saved", description: "Your changes are live." },
    destructive: { title: "Upload failed", description: "The connection was reset." },
  };
  return (
    <button
      type="button"
      onClick={() =>
        toast({ ...copy[variant], variant, duration: 4000 })}
      className="inline-flex h-[38px] items-center rounded-md bg-[var(--foreground)] px-4 text-sm font-medium text-[var(--background)]"
    >
      Show {variant} toast
    </button>
  );
}

/** A provider-wrapped trigger so each story is self-contained. */
function ToastDemo({ variant }: { variant: ToastVariant }) {
  return (
    <ToastProvider>
      <TriggerButton variant={variant} />
    </ToastProvider>
  );
}

const triggerClass =
  "inline-flex h-[38px] items-center rounded-md bg-[var(--foreground)] px-4 text-sm font-medium text-[var(--background)]";

const TrashIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M3 6h18M8 6V4h8v2m-9 0v14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V6" />
  </svg>
);

function ActionTrigger() {
  const { toast } = useToast();
  return (
    <button
      type="button"
      className={triggerClass}
      onClick={() =>
        toast({
          title: "File deleted",
          description: "report.pdf was removed.",
          icon: <TrashIcon />,
          duration: Infinity,
          action: { label: "Undo", onClick: () => {} },
          cancel: { label: "Dismiss" },
        })}
    >
      Delete file
    </button>
  );
}

function CustomTrigger() {
  const { toast, dismiss } = useToast();
  return (
    <button
      type="button"
      className={triggerClass}
      onClick={() =>
        toast.custom((id) => (
          <div className="pointer-events-auto flex items-center gap-3 rounded-lg bg-[var(--foreground)] px-4 py-3 text-sm text-[var(--background)] shadow-lg">
            Fully custom toast
            <button type="button" className="underline" onClick={() => dismiss(id)}>close</button>
          </div>
        ))}
    >
      Show custom toast
    </button>
  );
}

function ToastDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Toast"
        lead="Transient notifications: enqueue with useToast(), stacked bottom-right, auto-dismissing."
      />

      <DocsSection title="Default" description="Neutral notification on the popover surface.">
        <DocsExampleAuto of={Default} />
      </DocsSection>

      <DocsSection title="Success" description="Positive confirmation, accented with --status-success.">
        <DocsExampleAuto of={Success} />
      </DocsSection>

      <DocsSection
        title="Destructive"
        description="Error / failure, accented with --status-error."
      >
        <DocsExampleAuto of={Destructive} />
      </DocsSection>

      <DocsSection
        title="Icon + actions"
        description="Add a leading icon and action / cancel buttons; each dismisses after its handler runs."
      >
        <DocsExampleAuto of={WithActions} />
      </DocsSection>

      <DocsSection
        title="Custom"
        description="toast.custom((id) => node): you own the markup; the provider owns the queue + lifecycle."
      >
        <DocsExampleAuto of={Custom} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Usage">
        <DocsCode code={usageCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>
          ToastProvider · useToast · ToastViewport · Toast · ToastTitle · ToastDescription ·
          ToastClose
        </DocsComposition>
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="toast(options)"
          description="Enqueue a notification (returns its id)"
          props={[
            { name: "title", type: "React.ReactNode", description: "Heading line" },
            {
              name: "description",
              type: "React.ReactNode",
              description: "Secondary supporting line",
            },
            {
              name: "variant",
              type: '"default" | "success" | "destructive"',
              default: '"default"',
              description: "Colour scheme",
            },
            { name: "icon", type: "React.ReactNode", description: "Leading icon shown before the text" },
            {
              name: "action",
              type: "{ label; onClick }",
              description: "Primary button; runs onClick then dismisses",
            },
            {
              name: "cancel",
              type: "{ label; onClick? }",
              description: "Secondary/cancel button; dismisses",
            },
            {
              name: "duration",
              type: "number",
              default: "5000",
              description: "Milliseconds before auto-dismiss (Infinity to persist)",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "UI/Toast",
  component: Toast,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: { page: ToastDocsPage },
  },
} satisfies Meta<typeof Toast>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  tags: ["!dev"],
  render: () => <ToastDemo variant="default" />,
};

export const Success: Story = {
  tags: ["!dev"],
  render: () => <ToastDemo variant="success" />,
};

export const Destructive: Story = {
  tags: ["!dev"],
  render: () => <ToastDemo variant="destructive" />,
};

export const WithActions: Story = {
  name: "Icon + actions",
  tags: ["!dev"],
  render: () => (
    <ToastProvider>
      <ActionTrigger />
    </ToastProvider>
  ),
};

export const Custom: Story = {
  tags: ["!dev"],
  render: () => (
    <ToastProvider>
      <CustomTrigger />
    </ToastProvider>
  ),
};
