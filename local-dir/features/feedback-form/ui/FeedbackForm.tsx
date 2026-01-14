import { Button } from "@/shared/ui/Button"
import { contactForm } from "@/shared/utils/contactForm"
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/Popover"
import { FormFields, FormField } from "@/shared/ui/FormFields"
import { Input } from "@/shared/ui/Input"
import { Label } from "@/shared/ui/Label"
import { Textarea } from "@/shared/ui/Textarea"
import { cn } from "@/shared/utils/utils"
import { FormError } from "@/shared/ui/FormError"
import { useForm } from "https://esm.sh/react-hook-form@7.43.9"

export function FeedbackForm() {
  const { handleSubmit, register, formState, setError, reset } = useForm()

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          onClick={() => {
            window.dataLayer?.push({
              event: "custom_event",
              section: "desktop_menu",
              category: "link",
              action: "clicked",
              label: "Feedback",
            })
          }}
        >
          Feedback
        </Button>
      </PopoverTrigger>

      <PopoverContent sideOffset={15} align="end" className="w-full max-w-max">
        <form
          className="p-0.5 w-[300px]"
          onSubmit={handleSubmit((values) => {
            return contactForm({
              pageName: "Feedback",
              values,
            }).catch(() => {
              setError("generic", { message: "Something went wrong" })
            })
          })}
        >
          <FormError>{formState.errors?.generic?.message}</FormError>

          {formState.isSubmitSuccessful ? (
            <FormFields className="items-center">
              <p className="text-gray-700 dark:text-white text-sm font-medium">
                Thank you for your feedback!
              </p>
              <div>
                <Button
                  variant="secondary"
                  type="button"
                  onClick={() => {
                    setError("")
                    reset()
                  }}
                >
                  Go back
                </Button>
              </div>
            </FormFields>
          ) : (
            <FormFields>
              <FormField>
                <Label htmlFor="email">Email Address</Label>
                <Input
                  {...register("email", {
                    required: "This field is required",
                  })}
                  id="email"
                  type="email"
                  placeholder="janedoe@example.com"
                />
                <FormError>{formState.errors?.email?.message}</FormError>
              </FormField>
              <FormField>
                <Label htmlFor="message">Message</Label>
                <Textarea
                  {...register("message", {
                    required: "This field is required",
                  })}
                  id="message"
                  rows="6"
                  placeholder="Your feedback..."
                />
                <FormError>{formState.errors?.message?.message}</FormError>
              </FormField>

              <Button asChild>
                <button
                  className="w-full"
                  disabled={formState.isSubmitting}
                  type="submit"
                  onClick={() => {
                    window.dataLayer?.push({
                      event: "custom_event",
                      section: "sales_contact_form",
                      category: "link",
                      action: "clicked",
                      label: "Submit",
                    })
                  }}
                >
                  Submit
                </button>
              </Button>
            </FormFields>
          )}
        </form>
      </PopoverContent>
    </Popover>
  )
}
