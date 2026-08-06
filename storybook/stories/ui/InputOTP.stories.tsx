import * as React from "react";
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
import { InputOTP } from "../../../src/react/components/ui/index.ts";

const importCode = `import { InputOTP } from "veryfront/ui"`;

/** Controlled wrapper so the stories drive a real `value`/`onChange` cycle. */
function ControlledOTP({
  initial = "",
  maxLength = 6,
}: {
  initial?: string;
  maxLength?: number;
}) {
  const [value, setValue] = React.useState(initial);
  return <InputOTP value={value} onChange={setValue} maxLength={maxLength} />;
}

function InputOTPDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="InputOTP"
        lead="A segmented one-time-code input: one hidden numeric field feeding a row of visual slots."
      />

      <DocsSection
        title="Six digits"
        description="The default: six slots, partially filled, with the active slot highlighted."
      >
        <DocsExampleAuto of={SixDigit} />
      </DocsSection>

      <DocsSection
        title="Four digits"
        description="Pass maxLength to change the number of slots."
      >
        <DocsExampleAuto of={FourDigit} />
      </DocsSection>

      <DocsSection
        title="Disabled"
        description="Set disabled to block typing and dim the slots."
      >
        <DocsExampleAuto of={Disabled} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>InputOTP</DocsComposition>
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="InputOTP"
          description="Segmented one-time-code input"
          props={[
            {
              name: "value",
              type: "string",
              description: "The controlled code",
            },
            {
              name: "onChange",
              type: "(value: string) => void",
              description: "Fires with the next sanitized (digits-only) code",
            },
            {
              name: "maxLength",
              type: "number",
              default: "6",
              description: "Number of slots (and the input's max length)",
            },
            {
              name: "disabled",
              type: "boolean",
              default: "false",
              description: "Block typing and dim the slots",
            },
            {
              name: "className",
              type: "string",
              description: "Additional classes",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "UI/InputOTP",
  component: InputOTP,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: { page: InputOTPDocsPage },
  },
} satisfies Meta<typeof InputOTP>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SixDigit: Story = {
  tags: ["!dev"],
  render: () => <ControlledOTP initial="123" maxLength={6} />,
};

export const FourDigit: Story = {
  tags: ["!dev"],
  render: () => <ControlledOTP initial="12" maxLength={4} />,
};

export const Disabled: Story = {
  tags: ["!dev"],
  render: () => <InputOTP value="42" maxLength={6} disabled onChange={() => {}} />,
};
