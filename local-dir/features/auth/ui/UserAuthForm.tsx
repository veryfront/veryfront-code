import { Button } from "@/shared/ui/Button"
import { FormError } from "@/shared/ui/FormError"
import { Input } from "@/shared/ui/Input"
import { GithubIcon } from "@/shared/ui/icons/GithubIcon"
import { GoogleIcon } from "@/shared/ui/icons/GoogleIcon"
import { useRouter } from "@/lib/Router"
import { useForm } from "https://esm.sh/react-hook-form@7.43.9"
import { LogoMark } from "@/shared/ui/LogoMark"
import { RefreshCw } from "https://esm.sh/lucide-react"

function extractDomain(url) {
  const matches = url.match(
    /^(?:https?:\/\/)?(?:[^@\n]+@)?(?:www\.)?([^:/\n]+)/im,
  )
  if (matches && matches.length > 1) {
    const hostParts = matches[1].split(".")
    if (hostParts.length > 1) {
      const tld = hostParts.slice(-2).join(".")
      return tld
    }
  }
  return null
}

export function UserAuthForm({ title = true }) {
  const router = useRouter()
  const domain = router?.domain
  const { handleSubmit, register, formState, setError, reset, getValues } =
    useForm()

  const authUrl = domain.includes("veryfront.com")
    ? "https://auth.veryfront.com"
    : "https://auth.veryfront.org"

  return (
    <div className="grid gap-5">
      <div className="flex flex-col space-y-2.5 -mb-1">
        {title && (
          <h1 className="text-2xl md:text-3xl font-medium tracking-tight font-display">
            {formState.isSubmitSuccessful
              ? "Check your email"
              : "Sign in to Veryfront"}
          </h1>
        )}

        <p className="text-sm text-muted-foreground">
          {formState.isSubmitSuccessful ? (
            <>
              Log in using the magic link sent to <b>{getValues("email")}</b>
            </>
          ) : null}
        </p>
      </div>

      {formState.isSubmitSuccessful && (
        <div className="md:text-center">
          <Button
            variant="secondary"
            disabled={formState.isSubmitting}
            onClick={() => {
              window.dataLayer?.push({
                event: "custom_event",
                section: "user_auth_form",
                category: "link",
                action: "clicked",
                label: "Go Back",
              })
              reset()
            }}
          >
            Go Back
          </Button>
        </div>
      )}

      {!formState.isSubmitSuccessful && (
        <>
          <form
            onSubmit={handleSubmit((values) => {
              return fetch("https://auth.veryfront.com/auth/magiclink", {
                method: "POST",
                headers: {
                  Accept: "application/json",
                  "Content-Type": "application/json",
                },
                body: JSON.stringify(values),
              })
                .then((data) => {
                  if (data.status > 400) {
                    setError("generic", {
                      message: "Something went wrong",
                    })
                    window.dataLayer?.push({
                      event: "custom_event",
                      category: "form_error",
                      action: "submitted",
                      label: "Something went wrong",
                    })
                    return
                  }
                  window.dataLayer?.push({
                    event: "custom_event",
                    category: "form_success",
                    action: "submitted",
                    label: "OK",
                  })
                })
                .catch(() => {
                  setError("generic", { message: "Something went wrong" })
                  window.dataLayer?.push({
                    event: "custom_event",
                    category: "form_error",
                    action: "submitted",
                    label: "Something went wrong",
                  })
                })
            })}
          >
            <div className="grid gap-3">
              <FormError>{formState.errors?.generic?.message}</FormError>
              <div className="grid gap-1">
                <label className="sr-only" htmlFor="email">
                  Email
                </label>
                <Input
                  {...register("email", {
                    required: "This field is required",
                  })}
                  id="email"
                  placeholder="name@example.com"
                  type="email"
                  autoCapitalize="none"
                  autoComplete="email"
                  autoCorrect="off"
                  disabled={formState.isSubmitting}
                  className="max-w-auto md:min-w-[320px]"
                />
                <FormError>{formState.errors?.email?.message}</FormError>
              </div>
              <Button
                variant="primary"
                size="lg"
                disabled={formState.isSubmitting}
                onClick={() => {
                  window.dataLayer?.push({
                    event: "custom_event",
                    section: "user_auth_form",
                    category: "link",
                    action: "clicked",
                    label: "Continue with email",
                  })
                }}
              >
                {formState.isSubmitting && (
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                )}
                Sign in with Email
              </Button>
            </div>
          </form>

          <div>
            <div className="relative flex justify-center text-xs uppercase">
              <span
                className="h-px w-full bg-muted/40 block absolute top-1/2"
                role="presentation"
              />
              <span className="block text-muted/80 bg-background px-3 z-10 relative">
                Or
              </span>
            </div>
          </div>

          <Button
            variant="outline"
            size="lg"
            asChild
            disabled={formState.isSubmitting}
          >
            <a
              href={`${authUrl}/auth/google-login?url=${encodeURIComponent(`https://${extractDomain(domain)}/login?from=${router.query.from || "/dashboard"}`)}`}
              onClick={() => {
                window.dataLayer?.push({
                  event: "custom_event",
                  section: "user_auth_form",
                  category: "link",
                  action: "clicked",
                  label: "Continue with Google",
                })
              }}
            >
              <GoogleIcon className="mr-2 h-4 w-4" />
              Sign in with Google
            </a>
          </Button>

          <Button
            variant="outline"
            size="lg"
            asChild
            disabled={formState.isSubmitting}
          >
            <a
              href={`${authUrl}/auth/github-login?url=${encodeURIComponent(`https://${extractDomain(domain)}/login?from=${router.query.from || "/dashboard"}`)}`}
              onClick={() => {
                window.dataLayer?.push({
                  event: "custom_event",
                  section: "user_auth_form",
                  category: "link",
                  action: "clicked",
                  label: "Continue with Github",
                })
              }}
            >
              <GithubIcon className="mr-2 h-4 w-4" />
              Sign in with Github
            </a>
          </Button>

          <p className="text-sm text-muted-foreground/20 hidden">
            <span>
              We only contract with legal entities. By continuing, you confirm
              that you are a legal entity or an authorized representative of
              such, and you agree to our{" "}
            </span>
            <a
              href="/terms"
              className="inline underline underline-offset-4 hover:text-primary"
              onClick={() => {
                window.dataLayer?.push({
                  event: "custom_event",
                  section: "user_auth_form",
                  category: "link",
                  action: "clicked",
                  label: "Terms of Service",
                })
              }}
            >
              Terms of Service
            </a>
            <span>.</span>
          </p>

          <p className="text-sm text-muted-foreground/20 hidden">
            <span>Information on data protection can be found in our </span>
            <a
              href="/privacy"
              className="underline underline-offset-4 hover:text-primary"
              onClick={() => {
                window.dataLayer?.push({
                  event: "custom_event",
                  section: "user_auth_form",
                  category: "link",
                  action: "clicked",
                  label: "Privacy Policy",
                })
              }}
            >
              Privacy Policy
            </a>
            <span>.</span>
          </p>
        </>
      )}
    </div>
  )
}
