import { Button } from "@/shared/ui/Button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/ui/Dialog"
import { cn, cva } from "@/shared/utils/utils"
import { createContext, useContext, useState, useEffect } from "react"

export const toggleVariants = cva(
  "w-9 h-5 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-gray-300 dark:peer-focus:ring-gray-800 rounded-full peer dark:bg-gray-700  after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white  after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-gray-600",
  {
    variants: {
      variant: {
        default: "after:border bg-gray-200",
        checked: "after:translate-x-full after:border-white bg-gray-600",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
)

export const DialogBody = ({ privacySettings, onChange }) => {
  return (
    <div className="flex flex-col gap-4 justify-start">
      <div className="border border-border p-4">
        <div className="flex flex-row gap-4 justify-between">
          <div className="flex flex-col">
            <div className="text-sm font-medium">Essential</div>
            <div className="text-xs font-normal">
              These technologies are required to activate the core functionality
              of the website:
            </div>
          </div>
          <div className="flex flex-col justify-center">
            <div className="relative">
              <div className={cn(toggleVariants({ variant: "checked" }))}></div>
            </div>
          </div>
        </div>
        <div className="border-t border-t-divider mt-4">
          <ul className="pt-4 text-xs text-foreground/75 flex flex-col gap-2">
            <li className="flex flex-row gap-4 items-center w-full justify-between">
              Google Tag Manager
              <div className="relative cursor-pointer">
                <div
                  className={cn(toggleVariants({ variant: "checked" }))}
                ></div>
              </div>
            </li>
          </ul>
        </div>
      </div>

      <div className="border border-border p-4">
        <div className="flex flex-row gap-4 justify-between">
          <div className="flex flex-col">
            <div className="text-sm font-medium">Functional</div>
            <div className="text-xs font-normal">
              These technologies are required to activate the core functionality
              of the website:
            </div>
          </div>
          <div className="flex flex-col justify-center">
            <div
              className="relative cursor-pointer"
              onClick={() => onChange("functional")}
            >
              <div
                className={cn(
                  toggleVariants({
                    variant: privacySettings.functional ? "checked" : "default",
                  }),
                )}
              ></div>
            </div>
          </div>
        </div>
        <div className="border-t border-t-divider mt-4">
          <ul className="mt-4 text-xs text-foreground/75 flex flex-col gap-2">
            <li className="flex flex-row gap-4 items-center w-full justify-between">
              Google Analytics
              <div
                className="relative cursor-pointer"
                onClick={() => onChange("Google Analytics")}
              >
                <div
                  className={cn(
                    toggleVariants({
                      variant: privacySettings["Google Analytics"]
                        ? "checked"
                        : "default",
                    }),
                  )}
                ></div>
              </div>
            </li>
          </ul>
        </div>
      </div>

      <div className="border border-border p-4">
        <div className="flex flex-row gap-4 justify-between">
          <div className="flex flex-col">
            <div className="text-sm font-medium">Targeting / Advertising</div>
            <div className="text-xs font-normal">
              These technologies are required to activate the core functionality
              of the website:
            </div>
          </div>
          <div className="flex flex-col justify-center">
            <div
              className="relative cursor-pointer"
              onClick={() => onChange("advertising")}
            >
              <div
                className={cn(
                  toggleVariants({
                    variant: privacySettings.advertising
                      ? "checked"
                      : "default",
                  }),
                )}
              ></div>
            </div>
          </div>
        </div>
        <div className="border-t border-t-divider mt-4">
          <ul className="mt-4 text-xs text-foreground/75 flex flex-col gap-2">
            <li className="flex flex-row gap-4 items-center w-full justify-between">
              Facebook Pixel
              <div
                className="relative cursor-pointer"
                onClick={() => onChange("Facebook Pixel")}
              >
                <div
                  className={cn(
                    toggleVariants({
                      variant: privacySettings["Facebook Pixel"]
                        ? "checked"
                        : "default",
                    }),
                  )}
                ></div>
              </div>
            </li>
            <li className="flex flex-row gap-4 items-center w-full justify-between">
              Google Analytics Advertising
              <div
                className="relative cursor-pointer"
                onClick={() => onChange("Google Analytics Advertising")}
              >
                <div
                  className={cn(
                    toggleVariants({
                      variant: privacySettings["Google Analytics Advertising"]
                        ? "checked"
                        : "default",
                    }),
                  )}
                ></div>
              </div>
            </li>
            <li className="flex flex-row gap-4 items-center w-full justify-between">
              LinkedIn Insight Tag
              <div
                className="relative cursor-pointer"
                onClick={() => onChange("LinkedIn Insight Tag")}
              >
                <div
                  className={cn(
                    toggleVariants({
                      variant: privacySettings["LinkedIn Insight Tag"]
                        ? "checked"
                        : "default",
                    }),
                  )}
                ></div>
              </div>
            </li>
            <li className="flex flex-row gap-4 items-center w-full justify-between">
              Twitter Advertising
              <div
                className="relative cursor-pointer"
                onClick={() => onChange("Twitter Advertising")}
              >
                <div
                  className={cn(
                    toggleVariants({
                      variant: privacySettings["Twitter Advertising"]
                        ? "checked"
                        : "default",
                    }),
                  )}
                ></div>
              </div>
            </li>
          </ul>
        </div>
      </div>
    </div>
  )
}

export const Banner = ({ acceptAll }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
    <div className="px-4 py-6  rounded bg-white mx-auto max-w-2xl shadow-xl">
      <DialogTitle>Privacy Settings</DialogTitle>
      <div className="text-sm mt-4">
        This site uses third-party website tracking technologies to provide and
        continually improve our services, and to display advertisements
        according to users' interests. I agree and may revoke or change my
        consent at any time with effect for the future.
      </div>
      <div className="flex flex-row gap-4 py-4">
        <a href="/privacy" className="text-xs hover:underline">
          Privacy Policy
        </a>
        <a href="/imprint" className="text-xs hover:underline">
          Imprint
        </a>
        <DialogTrigger asChild>
          <a className="text-xs hover:underline cursor-pointer">Options</a>
        </DialogTrigger>
      </div>
      <Button onClick={() => acceptAll()} className="w-full">
        Accept All
      </Button>
    </div>
  </div>
)

export const BannerSmall = ({ acceptAll }) => {
  return (
    <div className="fixed bottom-0 left-0 z-[500] flex items-center p-2 md:px-5 md:py-4">
      <div className="px-4 py-4 rounded border border-border bg-popover mx-auto max-w-lg shadow-xl">
        <div className="text-sm">
          This site uses cookies to deliver its services and analyze traffic.
        </div>
        <div className="flex flex-col md:flex-row gap-4 md:gap-4 flex-nowrap md:items-center items-start pt-4">
          <div className="flex flex-row gap-4 items-center">
            <DialogTrigger asChild>
              <Button variant="secondary" size="xs" className="w-full">
                Options
              </Button>
            </DialogTrigger>
            <Button onClick={acceptAll} size="xs" className="w-full">
              Accept
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export const Options = ({
  privacySettings,
  onChange,
  saveSettings,
  acceptAll,
  onNavigate,
}) => {
  return (
    <DialogContent className="sm:max-w-2xl overflow-y-auto w-full h-full md:w-auto md:h-auto border-border bg-popover">
      <DialogHeader className="flex flex-col items-start text-left self-start">
        <DialogTitle>Privacy Settings</DialogTitle>
        <DialogDescription className="max-w-xl pt-2">
          This tool helps you to select and deactivate various tags / trackers /
          analytic tools used on this website.
        </DialogDescription>
        <div className="flex flex-row gap-4 pt-4">
          <a
            href="/privacy"
            className="text-xs hover:underline focus:underline"
            onClick={onNavigate}
          >
            Privacy Policy
          </a>
          <a
            href="/imprint"
            className="text-xs hover:underline focus:underline"
            onClick={onNavigate}
          >
            Imprint
          </a>
        </div>
      </DialogHeader>
      <DialogBody privacySettings={privacySettings} onChange={onChange} />
      <DialogFooter className="mt-4 gap-4">
        <Button
          onClick={() => saveSettings()}
          variant="secondary"
          className="w-full"
        >
          Save Settings
        </Button>
        <Button onClick={() => acceptAll()} className="w-full">
          Accept All
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}

export const ConsentContext = createContext()

export function useConsentContext() {
  return useContext(ConsentContext)
}

export function ConsentProvider({ children, onSubmit }) {
  const [context, setContext] = useState({
    showConsentOptions: false,
  })
  const [initialized, setInitialized] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const [privacySettings, setPrivacySettings] = useState({
    functional: false,
    advertising: false,
    "Google Analytics": false,
    "Google Analytics Advertising": false,
    "Facebook Pixel": false,
    "LinkedIn Insight Tag": false,
    "Twitter Advertising": false,
  })

  useEffect(() => {
    const initialSettings = localStorage.getItem("privacySettings")
    if (initialSettings) {
      const settings = JSON.parse(initialSettings)
      setPrivacySettings(settings)
      if (onSubmit) {
        onSubmit(settings)
      }
      setSubmitted(true)
    }
    setInitialized(true)
  }, [setInitialized, setPrivacySettings])

  const onChange = (field) => {
    const newValue = !privacySettings[field]

    if (field === "functional") {
      const newSettings = {
        ...privacySettings,
        [field]: newValue,
        "Google Analytics": newValue,
      }
      setPrivacySettings(newSettings)
      return
    }

    if (field === "advertising") {
      const newSettings = {
        ...privacySettings,
        [field]: newValue,
        "Google Analytics Advertising": newValue,
        "Facebook Pixel": newValue,
        "LinkedIn Insight Tag": newValue,
        "Twitter Advertising": newValue,
      }
      setPrivacySettings(newSettings)
      return
    }

    const newSettings = { ...privacySettings, [field]: newValue }
    setPrivacySettings(newSettings)
  }

  const saveSettings = () => {
    onSubmit(privacySettings)
    localStorage.setItem("privacySettings", JSON.stringify(privacySettings))
    setSubmitted(true)
  }

  const acceptAll = () => {
    const newSettings = {
      functional: true,
      advertising: true,
      "Google Analytics": true,
      "Google Analytics Advertising": true,
      "Facebook Pixel": true,
      "LinkedIn Insight Tag": true,
      "Twitter Advertising": true,
    }
    onSubmit(newSettings)
    setPrivacySettings(newSettings)
    localStorage.setItem("privacySettings", JSON.stringify(newSettings))
    setSubmitted(true)
  }

  return (
    <ConsentContext.Provider value={{ context, setContext }}>
      {children}
      {initialized && (!submitted || context.showConsentOptions) && (
        <Dialog>
          <BannerSmall
            acceptAll={() => {
              acceptAll()
              setContext((current) => ({
                ...current,
                showConsentOptions: false,
              }))
            }}
          />
          <Options
            privacySettings={privacySettings}
            onChange={onChange}
            onNavigate={() => {
              setContext((current) => ({
                ...current,
                showConsentOptions: false,
              }))
            }}
            saveSettings={() => {
              saveSettings()
              setContext((current) => ({
                ...current,
                showConsentOptions: false,
              }))
            }}
            acceptAll={() => {
              acceptAll()
              setContext((current) => ({
                ...current,
                showConsentOptions: false,
              }))
            }}
          />
        </Dialog>
      )}
    </ConsentContext.Provider>
  )
}
