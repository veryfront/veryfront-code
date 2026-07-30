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
} from "../../../src/react/components/ui/toast.tsx";

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

function ToastDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Toast"
        lead="Transient notifications — enqueue with useToast(), stacked bottom-right, auto-dismissing."
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
