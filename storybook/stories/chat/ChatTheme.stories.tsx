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

/**
 * The chat theme's cva variant surface, demonstrated. `messageVariants` styles a
 * message by `role`; `chatButtonVariants` the chat action buttons by `variant` /
 * `size`; `chatContainerVariants` the shell by layout. Not a Chat/Components entry
 * — it documents the theme tokens the components apply internally.
 */
function ChatThemeDocsPage() {
  return (
    <DocsPage>
      <DocsHero title="Chat theme" lead="The chat theme's cva variants: message roles, action buttons, and shell layouts." />

      <DocsSection title="Message roles" description='role="system" | "user" | "assistant".'>
        <div className="space-y-2">
          {(["system", "user", "assistant"] as const).map((role) => (
            <div key={role} className={messageVariants({ role })}>{role} message</div>
          ))}
        </div>
      </DocsSection>

      <DocsSection
        title="Action buttons"
        description='variant="primary" | "ghost" | "outline" | "icon-ghost"; size="default" | "icon-xs" | "icon-sm" | "icon-default" | "icon-lg".'
      >
        <div className="flex flex-wrap items-center gap-2">
          {(["primary", "ghost", "outline", "icon-ghost"] as const).map((variant) => (
            <button key={variant} type="button" className={chatButtonVariants({ variant })}>
              {variant}
            </button>
          ))}
          {(["icon-xs", "icon-sm", "icon-default", "icon-lg"] as const).map((size) => (
            <button
              key={size}
              type="button"
              aria-label={size}
              className={chatButtonVariants({ variant: "icon-ghost", size })}
            >
              +
            </button>
          ))}
        </div>
      </DocsSection>

      <DocsSection title="Shell layouts" description='variant="default" | "embedded" | "floating".'>
        <div className="flex gap-2">
          {(["default", "embedded", "floating"] as const).map((variant) => (
            <div key={variant} className={`${chatContainerVariants({ variant })} h-16 flex-1 rounded-md p-2 text-xs`}>
              {variant}
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
          { name: "messageVariants", type: 'role: "system" | "user" | "assistant"', description: "Per-role message bubble classes." },
          { name: "chatButtonVariants", type: 'variant: "primary" | "ghost" | "outline" | "icon-ghost"; size: "default" | "icon-xs" | "icon-sm" | "icon-default" | "icon-lg"', description: "Chat action-button classes." },
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
      {(["system", "user", "assistant"] as const).map((role) => (
        <div key={role} className={messageVariants({ role })}>{role}</div>
      ))}
    </div>
  ),
};

export const Buttons: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      {(["primary", "ghost", "outline", "icon-ghost"] as const).map((variant) => (
        <button key={variant} type="button" className={chatButtonVariants({ variant })}>{variant}</button>
      ))}
      {(["icon-xs", "icon-sm", "icon-default", "icon-lg"] as const).map((size) => (
        <button key={size} type="button" aria-label={size} className={chatButtonVariants({ variant: "icon-ghost", size })}>+</button>
      ))}
    </div>
  ),
};

export const Layouts: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="flex gap-2">
      {(["default", "embedded", "floating"] as const).map((variant) => (
        <div key={variant} className={`${chatContainerVariants({ variant })} h-16 flex-1 rounded-md p-2 text-xs`}>
          {variant}
        </div>
      ))}
    </div>
  ),
};

/**
 * ACID TEST — override one leaf (the ghost button's hover color) via the
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
