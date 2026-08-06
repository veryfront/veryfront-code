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
  Field,
  FieldControl,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
} from "../../../src/react/components/ui/index.ts";

const importCode = `import { Field, FieldLabel, FieldControl, FieldDescription, FieldError } from "veryfront/ui"`;

const compositionTree = `<Field>
  <FieldLabel />
  <FieldControl>{control}</FieldControl>
  <FieldDescription />
  <FieldError />
</Field>`;

function FieldDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Field"
        lead="A form-field wrapper that wires a label, description, and error to a control for accessibility."
      />

      <DocsSection
        title="Basic"
        description="A label, control, and helper text: ids are derived and wired for you."
      >
        <DocsExampleAuto of={Basic} />
      </DocsSection>

      <DocsSection
        title="Invalid"
        description="Pass invalid to flag the label and control and surface a role='alert' error."
      >
        <DocsExampleAuto of={Invalid} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>{compositionTree}</DocsComposition>
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="Field"
          description="Form-field wrapper: provides derived ids to its sub-parts"
          props={[
            {
              name: "invalid",
              type: "boolean",
              default: "false",
              description: "Mark the field invalid; flags the label/control/error via context",
            },
            {
              name: "className",
              type: "string",
              description: "Additional classes",
            },
          ]}
        />
        <DocsPropsTable
          component="FieldControl"
          description="Wiring wrapper: clones its single child control with id / aria-describedby / aria-invalid"
          props={[
            {
              name: "children",
              type: "React.ReactElement",
              description: "The single form control element to wire",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "UI/Field",
  component: Field,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: { page: FieldDocsPage },
  },
} satisfies Meta<typeof Field>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Basic: Story = {
  tags: ["!dev"],
  render: () => (
    <Field className="w-72">
      <FieldLabel>Email</FieldLabel>
      <FieldControl>
        <Input type="email" placeholder="you@example.com" />
      </FieldControl>
      <FieldDescription>Veryfront never shares your email.</FieldDescription>
    </Field>
  ),
};

export const Invalid: Story = {
  tags: ["!dev"],
  render: () => (
    <Field invalid className="w-72">
      <FieldLabel>Email</FieldLabel>
      <FieldControl>
        <Input type="email" defaultValue="not-an-email" />
      </FieldControl>
      <FieldError>Enter a valid email address.</FieldError>
    </Field>
  ),
};
