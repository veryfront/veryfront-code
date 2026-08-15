import * as React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  DatePicker,
  DatePickerContent,
  DatePickerTrigger,
} from "../../../src/react/components/ui/index.ts";
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
  DatePicker,
  DatePickerTrigger,
  DatePickerContent,
} from "veryfront/ui"`;

const compositionTree = `DatePicker                 <- Root (owns value + open, provides context)
├─ DatePickerTrigger       <- field-styled button, opens the popover
└─ DatePickerContent       <- Popover surface
   └─ Calendar             <- month grid; picking a day sets value + closes`;

function DatePickerDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="DatePicker"
        lead="A field-styled button that opens a Popover holding a Calendar: pick a day, it fills the field and closes."
      />

      <DocsSection
        title="Controlled"
        description="Hold the selected Date in state and pass it back as value; onChange fires with the picked day and the popover closes."
      >
        <DocsExampleAuto of={Controlled} />
      </DocsSection>

      <DocsSection
        title="Open by default"
        description="Seed defaultOpen to render with the calendar already showing a fixed month."
      >
        <DocsExampleAuto of={OpenByDefault} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>{compositionTree}</DocsComposition>
      </DocsSection>

      <DocsSection title="API reference">
        <DocsPropsTable
          component="DatePicker"
          description="Root: owns value + open state, provides context, renders the Popover."
          props={[
            { name: "value", type: "Date", description: "Controlled selected day" },
            { name: "defaultValue", type: "Date", description: "Uncontrolled initial selected day" },
            { name: "onChange", type: "(date: Date) => void", description: "Fires with the picked day" },
            { name: "open", type: "boolean", description: "Controlled open state" },
            { name: "defaultOpen", type: "boolean", default: "false", description: "Uncontrolled initial open state" },
            { name: "onOpenChange", type: "(open: boolean) => void", description: "Open-state change handler" },
            { name: "placeholder", type: "string", default: "'Pick a date'", description: "Trigger label when no value is selected" },
            { name: "format", type: "(date: Date) => string", default: "(d) => d.toLocaleDateString()", description: "Formats the selected day into the trigger label" },
            { name: "defaultMonth", type: "Date", default: "value ?? today", description: "Month the calendar shows initially" },
          ]}
        />
        <DocsPropsTable
          component="DatePickerTrigger"
          description="Field-styled button showing the formatted value or placeholder; the Popover trigger."
          props={[{ name: "className", type: "string", description: "Additional classes" }]}
        />
        <DocsPropsTable
          component="DatePickerContent"
          description="Popover surface wrapping the Calendar."
          props={[
            { name: "align", type: "'start' | 'end'", default: "'start'", description: "Horizontal alignment relative to the trigger" },
            { name: "className", type: "string", description: "Additional classes" },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "UI/DatePicker",
  component: DatePicker,
  subcomponents: { DatePickerTrigger, DatePickerContent },
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: { page: DatePickerDocsPage },
  },
} satisfies Meta<typeof DatePicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Controlled: Story = {
  tags: ["!dev"],
  render: () => {
    const [date, setDate] = React.useState<Date | undefined>(new Date(2026, 0, 15));
    return (
      <div className="flex w-[260px] flex-col items-stretch gap-3">
        <DatePicker value={date} onChange={setDate} defaultMonth={new Date(2026, 0, 1)}>
          <DatePickerTrigger />
          <DatePickerContent />
        </DatePicker>
        <p className="text-sm text-[var(--muted-foreground)]">
          Selected: {date ? date.toDateString() : "none"}
        </p>
      </div>
    );
  },
};

export const OpenByDefault: Story = {
  tags: ["!dev"],
  render: () => {
    const [date, setDate] = React.useState<Date | undefined>();
    return (
      <div className="w-[260px]">
        <DatePicker
          value={date}
          onChange={setDate}
          defaultOpen
          defaultMonth={new Date(2026, 0, 1)}
        >
          <DatePickerTrigger />
          <DatePickerContent />
        </DatePicker>
      </div>
    );
  },
};
