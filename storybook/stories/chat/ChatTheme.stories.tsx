import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  chatButtonVariants,
  chatContainerVariants,
  messageVariants,
} from "../../../src/react/components/chat/theme.ts";
import {
  DocsComposition,
  DocsHero,
  DocsPage,
  DocsPropsTable,
  DocsSection,
} from "../../.storybook/docs";

const compositionTree =
  `chatButtonVariants({ variant, size })  <- action-button classes
messageVariants({ role })              <- per-role message classes
chatContainerVariants({ variant })     <- shell layout classes`;
const messageRoleExamples = [
  { role: "system" },
  { role: "user" },
  { role: "assistant" },
  { role: "tool" },
] as const;
const buttonVariantExamples = [
  { variant: "primary" },
  { variant: "ghost" },
  { variant: "outline" },
  { variant: "icon-ghost" },
] as const;
const buttonTextSizeExamples = [
  { size: "sm" },
  { size: "default" },
] as const;
const iconButtonSizeExamples = [
  { size: "icon-xs" },
  { size: "icon-sm" },
  { size: "icon-default" },
  { size: "icon-lg" },
] as const;
const containerVariantExamples = [
  { variant: "default" },
  { variant: "embedded" },
  { variant: "floating" },
] as const;

/**
 * The chat theme's cva variant surface, demonstrated. `messageVariants` styles a
 * message by `role`; `chatButtonVariants` the chat action buttons by `variant` /
 * `size`; `chatContainerVariants` the shell by layout. Not a Chat/Components entry.
 * It documents the theme tokens the components apply internally.
 */
function ChatThemeDocsPage() {
  return (
    <DocsPage>
      <DocsHero title="Chat theme" lead="The chat theme's cva variants: message roles, action buttons, and shell layouts." />

      <DocsSection title="Message roles" description='role="system" | "user" | "assistant" | "tool".'>
        <div className="space-y-2">
          {messageRoleExamples.map((options) => (
            <div key={options.role} className={messageVariants(options)}>{options.role} message</div>
          ))}
        </div>
      </DocsSection>

      <DocsSection
        title="Action buttons"
        description='variant="primary" | "ghost" | "outline" | "icon-ghost"; size="sm" | "default" | "icon-xs" | "icon-sm" | "icon-default" | "icon-lg".'
      >
        <div className="flex flex-wrap items-center gap-2">
          {buttonVariantExamples.map((options) => (
            <button key={options.variant} type="button" className={chatButtonVariants(options)}>
              {options.variant}
            </button>
          ))}
          {buttonTextSizeExamples.map((options) => (
            <button key={options.size} type="button" className={chatButtonVariants(options)}>
              {options.size}
            </button>
          ))}
          {iconButtonSizeExamples.map((options) => (
            <button
              key={options.size}
              type="button"
              aria-label={options.size}
              className={chatButtonVariants({ variant: "icon-ghost", size: options.size })}
            >
              +
            </button>
          ))}
        </div>
      </DocsSection>

      <DocsSection title="Shell layouts" description='variant="default" | "embedded" | "floating".'>
        <div className="flex gap-2">
          {containerVariantExamples.map((options) => (
            <div key={options.variant} className={`${chatContainerVariants(options)} h-16 flex-1 rounded-md p-2 text-xs`}>
              {options.variant}
            </div>
          ))}
        </div>
      </DocsSection>

      <DocsSection title="How the variants compose" description="Each helper owns one layer of the chat surface; components call them internally.">
        <DocsComposition>{compositionTree}</DocsComposition>
      </DocsSection>

      <DocsPropsTable
        component="chat theme variants"
        description="cva helpers the chat components apply internally."
        props={[
          { name: "messageVariants", type: 'role: "system" | "user" | "assistant" | "tool"', description: "Per-role message bubble classes." },
          { name: "chatButtonVariants", type: 'variant: "primary" | "ghost" | "outline" | "icon-ghost"; size: "sm" | "default" | "icon-xs" | "icon-sm" | "icon-default" | "icon-lg"', description: "Chat action-button classes." },
          { name: "chatContainerVariants", type: 'variant: "default" | "embedded" | "floating"', description: "Chat shell layout classes." },
        ]}
      />
    </DocsPage>
  );
}

const meta = {
  title: "Chat/Theme",
  tags: ["autodocs"],
  parameters: { layout: "padded", docs: { page: ChatThemeDocsPage } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Roles: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="space-y-2">
      {messageRoleExamples.map((options) => (
        <div key={options.role} className={messageVariants(options)}>{options.role}</div>
      ))}
    </div>
  ),
};

export const Buttons: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      {buttonVariantExamples.map((options) => (
        <button key={options.variant} type="button" className={chatButtonVariants(options)}>{options.variant}</button>
      ))}
      {buttonTextSizeExamples.map((options) => (
        <button key={options.size} type="button" className={chatButtonVariants(options)}>{options.size}</button>
      ))}
      {iconButtonSizeExamples.map((options) => (
        <button key={options.size} type="button" aria-label={options.size} className={chatButtonVariants({ variant: "icon-ghost", size: options.size })}>+</button>
      ))}
    </div>
  ),
};

export const Layouts: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="flex gap-2">
      {containerVariantExamples.map((options) => (
        <div key={options.variant} className={`${chatContainerVariants(options)} h-16 flex-1 rounded-md p-2 text-xs`}>
          {options.variant}
        </div>
      ))}
    </div>
  ),
};

/**
 * ACID TEST: override one leaf (the ghost button's hover color) via the
 * variant helper's `className` merge, WITHOUT re-authoring the button. The
 * base `ghost` classes still apply; only the hover token is swapped.
 */
export const OverrideOneLeaf: Story = {
  tags: ["!dev", "acid-test"],
  render: () => (
    <button
      type="button"
      className={chatButtonVariants({
        variant: "ghost",
        className: "hover:bg-[var(--destructive)] hover:text-[var(--destructive-foreground)]",
      })}
    >
      Delete (ghost + custom hover)
    </button>
  ),
};
