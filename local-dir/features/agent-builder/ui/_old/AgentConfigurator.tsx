import { useState } from "react"
import { useForm } from "https://esm.sh/react-hook-form@7.51.0"
import { Card } from "@/shared/ui/Card"
import { Button } from "@/shared/ui/Button"
import { useMultiStepForm } from "@/features/agent-builder/hooks/useMultiStepForm"
import { Step1Instructions } from "@/features/agent-builder/ui/agent-steps/Step1Instructions"
import { Step2Integrations } from "@/features/agent-builder/ui/agent-steps/Step2Integrations"
import { Step3Model } from "@/features/agent-builder/ui/agent-steps/Step3Model"
import { cn } from "@/shared/utils/utils"

type FormValues = {
  instructions: string
  integrations: string[]
  model: {
    model: string
    temperature: number
    maxTokens: number
    reasoningMode: string
  }
}

const STEPS = [
  {
    number: 1,
    title: "Agent Instructions",
    description: "Give your agent system instructions",
  },
  {
    number: 2,
    title: "Choose Integrations",
    description: "Give your agent tools by connecting services",
  },
  {
    number: 3,
    title: "Select Model",
    description: "Configure model settings and behavior",
  },
]

export function AgentConfigurator() {
  const { currentStep, goToStep, nextStep, isStepActive, isStepCompleted } =
    useMultiStepForm(3)

  const { handleSubmit, watch, setValue } = useForm<FormValues>({
    defaultValues: {
      instructions: "",
      integrations: [],
      model: {
        model: "gpt-4.1",
        temperature: 0.4,
        maxTokens: 2048,
        reasoningMode: "disabled",
      },
    },
  })

  const formValues = watch()

  const onSubmit = (data: FormValues) => {
    console.log("Agent Configuration:", data)
  }

  const canProceed = (step: number) => {
    if (step === 1) {
      return formValues.instructions.trim().length > 0
    }
    return true
  }

  const handleNext = (step: number) => {
    if (canProceed(step)) {
      nextStep()
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <Card className="max-w-3xl mx-auto p-6 space-y-6">
        <div>
          <h2 className="text-2xl font-semibold mb-1">Agent Configurator</h2>
          <p className="text-sm text-muted-foreground">
            Configure your AI agent step by step
          </p>
        </div>

        <div className="space-y-0">
          {STEPS.map((step, index) => {
            const isActive = isStepActive(step.number)
            const isCompleted = isStepCompleted(step.number)
            const isLast = index === STEPS.length - 1

            return (
              <div key={step.number}>
                <div className="flex gap-4">
                  {/* Step number with connector */}
                  <div className="flex flex-col items-center">
                    <button
                      type="button"
                      onClick={() => goToStep(step.number)}
                      disabled={!isCompleted && !isActive}
                      className={cn(
                        "size-8 rounded-full flex items-center justify-center font-semibold text-sm transition-all duration-300",
                        isActive &&
                          "bg-primary text-primary-foreground ring-4 ring-primary/20",
                        isCompleted &&
                          "bg-primary/20 text-primary hover:bg-primary/30",
                        !isActive &&
                          !isCompleted &&
                          "bg-muted/10 text-muted-foreground",
                      )}
                    >
                      {step.number}
                    </button>
                    {!isLast && (
                      <div
                        className={cn(
                          "w-0.5 flex-1 transition-all duration-300",
                          isCompleted ? "bg-primary" : "bg-muted/10",
                        )}
                      />
                    )}
                  </div>

                  {/* Step content */}
                  <div className={cn("flex-1", isLast ? "pb-0" : "pb-6")}>
                    <button
                      type="button"
                      onClick={() => goToStep(step.number)}
                      disabled={!isCompleted && !isActive}
                      className="w-full text-left group"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <h3
                            className={cn(
                              "font-semibold text-base transition-colors",
                              isActive && "text-foreground",
                              !isActive && "text-muted-foreground",
                            )}
                          >
                            {step.title}
                          </h3>
                          <p className="text-sm text-muted-foreground mt-0.5">
                            {step.description}
                          </p>
                        </div>
                      </div>
                    </button>

                    {/* Step form content with animation */}
                    <div
                      className={cn(
                        "overflow-hidden transition-all duration-500 ease-in-out",
                        isActive
                          ? "max-h-[2000px] opacity-100 mt-4"
                          : "max-h-0 opacity-0",
                      )}
                    >
                      {step.number === 1 && (
                        <Step1Instructions
                          value={formValues.instructions}
                          onChange={(value) => setValue("instructions", value)}
                        />
                      )}
                      {step.number === 2 && (
                        <Step2Integrations
                          value={formValues.integrations}
                          onChange={(value) => setValue("integrations", value)}
                        />
                      )}
                      {step.number === 3 && (
                        <Step3Model
                          value={formValues.model}
                          onChange={(value) => setValue("model", value)}
                        />
                      )}

                      {/* Next button */}
                      {isActive && step.number < STEPS.length && (
                        <div className="mt-4">
                          <Button
                            type="button"
                            onClick={() => handleNext(step.number)}
                            disabled={!canProceed(step.number)}
                            size="sm"
                            variant="secondary"
                          >
                            Next
                          </Button>
                        </div>
                      )}

                      {/* Submit button on last step */}
                      {isActive && step.number === STEPS.length && (
                        <div className="mt-6 flex justify-end">
                          <Button type="submit">Create Agent</Button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </Card>
    </form>
  )
}
