/**
 * @fileoverview Agent builder form component with react-hook-form integration.
 */

import { useMemo, useState } from "react"
import { FormProvider } from "https://esm.sh/react-hook-form@7.53.2"
import { useAgentBuilderForm } from "../hooks/useAgentBuilderForm"
import { ToolsDropdown } from "./ToolsDropdown"
import { ModelDropdown } from "./ModelDropdown"
import { SubmitButton } from "./SubmitButton"
import { PLACEHOLDERS } from "../constants"
import { buildAgentPrompt } from "../utils/promptBuilder"
import { redirectToAgentProject } from "../utils/redirectToProject"
import type { AgentBuilderFormData } from "../types/form"

/** Available tool integrations. */
export type Tool = "ServiceNow" | "Jira" | "Salesforce" | "GitHub"

/** Available AI models. */
export type AIModel =
  | "Gemini 1.5 Pro"
  | "GPT-4o"
  | "Claude 3.5 Sonnet"
  | "Claude 3 Opus"

/** Agent builder form data structure. */
export interface AgentBuilderFormData {
  /** User instructions or description. */
  instructions: string
  /** Selected integration tools (agent mode only). */
  tools: Tool[]
  /** Selected AI model (agent mode only). */
  model: AIModel | null
  /** Uploaded file (webapp/aiapp/webshop modes). */
  file: FileList | null
}

/** Available modes for the hero overlay interface. */
export type HeroMode = "agent" | "webapp" | "aiapp" | "webshop" | "dream"

interface AgentBuilderFormProps {
  /** Interface mode that determines available options. */
  mode?: HeroMode
  /** Optional placeholder override. */
  placeholder?: string
}

/**
 * Form component for building AI agents with tools and model selection.
 *
 * @param props - Component props
 * @returns Agent builder form
 *
 * @example
 * <AgentBuilderForm mode="agent" />
 */
export function AgentBuilderForm({
  mode = "agent",
  placeholder,
}: AgentBuilderFormProps) {
  const form = useAgentBuilderForm()
  const [isRedirecting, setIsRedirecting] = useState(false)
  const computedPlaceholder = useMemo(
    () => placeholder || PLACEHOLDERS[mode] || PLACEHOLDERS.agent,
    [mode, placeholder],
  )

  const onSubmit = (data: AgentBuilderFormData) => {
    if (!data.instructions.trim()) {
      form.setError("instructions", {
        type: "required",
        message: "Instructions are required",
      })
      return
    }

    try {
      setIsRedirecting(true)

      // Build the formatted prompt
      const prompt = buildAgentPrompt({
        instructions: data.instructions,
        tools: data.tools,
        model: data.model,
      })

      // Redirect to new project with prompt
      redirectToAgentProject(prompt)
    } catch (error) {
      console.error("Failed to submit form:", error)
      setIsRedirecting(false)
    }
  }

  return (
    <FormProvider {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="absolute bottom-24 left-1/2 -translate-x-1/2 w-[90%] max-w-[900px] z-10 flex items-center gap-2 bg-white dark:bg-gray-900 py-3 px-4 rounded-2xl shadow-lg dark:shadow-[0_0_20px_rgba(26,188,254,0.3)] flex-wrap"
      >
        {isRedirecting && (
          <div className="absolute inset-0 z-20 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm rounded-2xl flex items-center justify-center text-sm text-gray-700 dark:text-gray-300">
            Creating agent...
          </div>
        )}

        <input
          type="text"
          className="flex-1 border-none outline-none text-base text-gray-500 dark:text-gray-300 bg-transparent min-w-[200px] px-2 placeholder:text-gray-400 dark:placeholder:text-gray-500"
          placeholder={computedPlaceholder}
          aria-label="Agent instructions"
          disabled={isRedirecting}
          {...form.register("instructions", {
            required: "Instructions are required",
          })}
        />

        <div className="flex gap-2 items-center mr-2">
          <ToolsDropdown control={form.control} />
          <ModelDropdown control={form.control} />
        </div>

        <SubmitButton />
      </form>
    </FormProvider>
  )
}
