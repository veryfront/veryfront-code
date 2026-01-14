import { Button } from "@/shared/ui/Button"
import { ArrowUp } from "https://esm.sh/lucide-react"
import { FormFields, FormField } from "@/shared/ui/FormFields"
import { Label } from "@/shared/ui/Label"
import { Textarea } from "@/shared/ui/Textarea"
import { useForm } from "https://esm.sh/react-hook-form@7.43.9?target=es2020"
import ResizeTextarea from "https://esm.sh/react-textarea-autosize"
import { cn } from "@/shared/utils/utils"
import React from "react"
import {
  imageFileTypes,
  textFileExtensions,
} from "@/features/prompt-form/ui/ChatAttachment"
import { ChatAttachments } from "@/features/prompt-form/ui/ChatAttachments"
import { ChatActions } from "@/features/prompt-form/ui/ChatActions"
import { ChatQuickStart } from "@/features/prompt-form/ui/ChatQuickStart"
import { useAttachmentActions } from "@/features/prompt-form/hooks/useAttachmentActions"
import { useUserContext } from "@/shared/context/UserProvider"
import { useRouter } from "@/lib/Router"
import debounce from "https://esm.sh/lodash.debounce"
import { Container } from "@/shared/ui/Container"
import { LogoMark } from "@/shared/ui/LogoMark"
import { ChatSubmit } from "@/features/prompt-form/ui/ChatSubmit"

export const acceptImagesAndText = `text/*,${imageFileTypes.join(",")},${textFileExtensions.join(",")}`

function getRejectionMessage(rejection: FileRejection): string {
  const hasInvalidTypeError = rejection.errors.some(
    (error) => error.code === "file-invalid-type",
  )

  if (hasInvalidTypeError) {
    return "Invalid file type"
  }

  return rejection.errors.map((error) => error.message).join(", ")
}

export function redirectToProject(project, prompt, attachments) {
  if (project) {
    try {
      sessionStorage.setItem(`${project.id}-prompt`, prompt)
      if (attachments.length) {
        sessionStorage.setItem(
          `${project.id}-attachments`,
          JSON.stringify(attachments),
        )
      }

      sessionStorage.removeItem("prompt")

      const url = new URL(`https://veryfront.com/projects/${project.slug}`)
      url.searchParams.set("prompt", "project")
      window.location = url.toString()
      return
    } catch {
      const url = new URL(`https://veryfront.com/projects/${project.slug}`)
      url.searchParams.set("prompt", "session")
      window.location = url.toString()
      return
    }
  }

  try {
    sessionStorage.setItem("prompt", prompt)

    const url = new URL("https://new.veryfront.com")
    url.searchParams.set("prompt", "session")
    window.location.href = url.toString()
    return
  } catch {
    const url = new URL("https://new.veryfront.com")
    url.searchParams.set("prompt", prompt)
    window.location.href = url.toString()
    return
  }
}

// Animated placeholder component
function AnimatedPlaceholder({ text, isVisible, className }) {
  const [displayText, setDisplayText] = React.useState("")
  const [currentIndex, setCurrentIndex] = React.useState(0)

  React.useEffect(() => {
    if (!isVisible) {
      setDisplayText("")
      setCurrentIndex(0)
      return
    }

    if (currentIndex < text.length) {
      const timer = setTimeout(() => {
        setDisplayText(text.slice(0, currentIndex + 1))
        setCurrentIndex(prev => prev + 1)
      }, 35)

      return () => clearTimeout(timer)
    }
  }, [text, isVisible, currentIndex])

  if (!isVisible) return null

  return (
    <div 
      className={cn(
        'pointer-events-none absolute inset-0 z-0 flex items-start overflow-hidden p-3 pb-[52px] text-sm text-muted font-normal mt-[1px] sm:p-4',
        className
      )}
      aria-hidden="true"
    >
      <div className="flex flex-wrap opacity-100">
        {displayText.split('').map((char, index) => (
          <span
            key={index}
            className="inline-block"
            style={{
              whiteSpace: 'pre',
              opacity: 1,
              filter: 'blur(0px)',
              transform: 'none'
            }}
          >
            {char}
          </span>
        ))}
      </div>
    </div>
  )
}

export function PromptForm() {
  const user = useUserContext()
  const router = useRouter()
  const signInUrl = "/sign-in?from=https://veryfront.com"

  const {
    handleSubmit,
    register,
    formState,
    setFocus,
    setError,
    setValue,
    reset,
    watch,
  } = useForm({
    mode: "onChange",
  })

  const value = watch("prompt")
  const fileInputRef = React.useRef(null)
  const cloneInputRef = React.useRef(null)
  const projectRef = React.useRef(null)

  const [attachments, setAttachments] = React.useState([])
  const [rejected, setRejected] = React.useState<Array<FileRejection>>([])
  const [isFocused, setIsFocused] = React.useState(false)
  const fullPlaceholder = "Describe your agent..."
  const [isRedirecting, setIsRedirecting] = React.useState(false)

  const {
    onAttachFile,
    onAttachCloneScreenshotFile,
    attachDropzone,
    cloneDropzone,
    isUploading,
    isCloneScreenshotUploading,
  } = useAttachmentActions({
    projectRef,
    onFileAttachmentsChange: (newAttachments) => {
      setAttachments((current) => [...current, ...newAttachments])
    },
    onFileAttachmentSuccess: (file, url) => {
      setAttachments((current) => {
        return current.map((attachment) => {
          if (attachment.name === file.name) {
            return {
              ...attachment,
              url,
              isLoading: false,
            }
          }
          return attachment
        })
      })
    },
    onCloneScreenshotSuccess: (files, paths) => {
      const prompt =
        "Recreate the UI shown in the attached screenshot as accurately as possible."

      const attachments = files.map((file, index) => ({
        name: file.name,
        contentType: file.type,
        url: paths[index],
      }))

      try {
        setIsRedirecting(true)
        redirectToProject(projectRef.current, prompt, attachments)
      } catch {
        setIsRedirecting(false)
      }
    },
    onRejectedFilesChange: setRejected,
  })

  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout> = null

    if (rejected.length > 0) {
      timer = setTimeout(() => {
        setRejected([])
      }, 5000)
    }

    return () => {
      if (timer) {
        clearTimeout(timer)
      }
    }
  }, [rejected])

  React.useEffect(() => {
    try {
      const prompt = sessionStorage.getItem("prompt")

      if (prompt) {
        setValue("prompt", prompt)
      }
    } catch {
      //
    }
  }, [setValue])

  function onRemoveAttachment(index) {
    setAttachments((current) => {
      return current.filter((_, i) => i !== index)
    })
  }

  function redirectToSignIn() {
    try {
      if (value) {
        sessionStorage.setItem("prompt", value)
      }
    } catch {
      //
    }
    router.push(signInUrl)
  }

  function onAttachFileClick() {
    if (!user) {
      redirectToSignIn()
      return
    }

    fileInputRef.current?.click()
  }

  function onCloneScreenshotClick() {
    if (!user) {
      redirectToSignIn()
      return
    }

    cloneInputRef.current?.click()
  }

  function onKeyDown(event) {
    if (!event.shiftKey && event.code === "Enter") {
      event.preventDefault()
      const prompt = event.currentTarget?.value
      try {
        setIsRedirecting(true)
        redirectToProject(projectRef.current, prompt, attachments)
      } catch {
        setIsRedirecting(false)
      }
    }
  }

  function onFocus() {
    setIsFocused(true)
  }

  function onBlur() {
    setIsFocused(false)
  }

  const onChange = debounce((event) => {
    try {
      sessionStorage.setItem("prompt", event.target.value)
    } catch {
      //
    }
  }, 150)

  // Show placeholder only when not focused and no value
  const shouldShowPlaceholder = !isFocused && !value

  return (
    <div className="relative pointer-events-auto space-y-20 md:space-y-24 lg:space-y-28">
      <div 
        className="opacity-0 transform translate-y-4 transition-all duration-700"
        style={{ 
          transitionDelay: '300ms', 
          transitionProperty: 'opacity, transform',
          opacity: 1, 
          transform: 'translateY(0px)' 
        }}
      >
        <Container className="max-w-4xl">
          <ChatQuickStart
            onCloneScreenshotClick={onCloneScreenshotClick}
            isCloneScreenshotUploading={isCloneScreenshotUploading}
            isRedirecting={isRedirecting}
            setIsRedirecting={setIsRedirecting}
          />
        </Container>
      </div>

      <div 
        className="opacity-0 transform translate-y-4 transition-all duration-700"
        style={{ 
          transitionDelay: '500ms', 
          transitionProperty: 'opacity, transform',
          opacity: 1, 
          transform: 'translateY(0px)' 
        }}
      >
        <Container className="max-w-3xl">
          <form
            className="relative space-y-6"
            onSubmit={handleSubmit((values) => {
              if (isUploading) {
                return
              }

              const prompt = values.prompt
              try {
                setIsRedirecting(true)
                redirectToProject(projectRef.current, prompt, attachments)
              } catch {
                setIsRedirecting(false)
              }
            })}
          >
            {(isRedirecting || isCloneScreenshotUploading) && (
              <span className="absolute inset-0 z-10 bg-background/80 backdrop-blur-sm rounded-2xl flex flex-col items-center justify-center gap-2 text-sm text-foreground/50">
                <span className="animate-bounce-spin">
                  <LogoMark className="size-6" />
                </span>
                Creating app...
              </span>
            )}

            <div className="relative">
              <div className="relative w-full">
                <div
                  {...attachDropzone?.getRootProps()}
                  className={cn(
                    "bg-background border border-border/40 overflow-hidden rounded-2xl transition-all duration-300",
                    "shadow-[0px_2px_3px_-1px_rgba(0,0,0,0.1),0px_1px_0px_0px_rgba(25,28,33,0.02),0px_0px_0px_1px_rgba(25,28,33,0.08)]",
                    "hover:shadow-[0_4px_12px_rgba(0,0,0,0.15)] hover:border-border/60",
                    "focus-within:shadow-[0_4px_16px_rgba(0,0,0,0.2)] focus-within:border-primary/50",
                    attachDropzone?.isDragActive &&
                      "border-primary border-dashed bg-primary/5",
                  )}
                >
                  {rejected?.length > 0 && (
                    <div className="pt-2.5 px-2.5 sm:px-4">
                      {rejected.map((rejection) => (
                        <p
                          key={rejection.file.name}
                          className="text-[11px] text-destructive font-medium mb-1"
                        >
                          {getRejectionMessage(rejection)}: {rejection.file.name}
                        </p>
                      ))}
                    </div>
                  )}

                  {attachments?.length > 0 && (
                    <div className="pt-2.5 px-2.5 sm:px-4">
                      <ChatAttachments
                        attachments={attachments}
                        onRemove={onRemoveAttachment}
                      />
                    </div>
                  )}
                  
                  <Textarea
                    as={ResizeTextarea}
                    {...register("prompt", {
                      required: "This field is required",
                      onChange,
                    })}
                    id="prompt"
                    rows="5"
                    placeholder=""
                    className="min-h-[120px] w-full max-h-[400px] overflow-y-auto pb-[52px] px-3 pt-3 sm:px-4 sm:pt-4 bg-transparent border-none resize-none focus:outline-none focus:ring-0 text-lg leading-relaxed"
                    onKeyDown={onKeyDown}
                    onFocus={onFocus}
                    onBlur={onBlur}
                    disabled={isRedirecting}
                  />

                  <AnimatedPlaceholder
                    text={fullPlaceholder}
                    isVisible={shouldShowPlaceholder}
                  />

                  <input
                    {...attachDropzone?.getInputProps()}
                    type="file"
                    ref={fileInputRef}
                    onChange={onAttachFile}
                    className="sr-only"
                    accept={acceptImagesAndText}
                    multiple
                    aria-label="Attach File"
                    disabled={isRedirecting}
                  />
                  <input
                    {...cloneDropzone?.getInputProps()}
                    type="file"
                    ref={cloneInputRef}
                    onChange={onAttachCloneScreenshotFile}
                    className="sr-only"
                    accept={acceptImagesAndText}
                    multiple
                    aria-label="Attach File"
                    disabled={isRedirecting}
                  />

                  <div className="absolute bottom-[14px] left-[9px] z-10">
                    <ChatActions
                      onAttachFileClick={onAttachFileClick}
                      onCloneScreenshotClick={onCloneScreenshotClick}
                    />
                  </div>

                  <div className="absolute bottom-[14px] right-[9px] z-10">
                    <ChatSubmit
                      variant="primary"
                      disabled={!value?.trim() || isUploading || isRedirecting}
                      onClick={(e) => {
                        if (!value) {
                          e.preventDefault()
                          setFocus("prompt")
                        }
                      }}
                      type="submit"
                      className="p-[5px] pb-[6px] rounded-lg shadow-[0px_2px_3px_-1px_rgba(0,0,0,0.1),0px_1px_0px_0px_rgba(25,28,33,0.02),0px_0px_0px_1px_rgba(25,28,33,0.08)] hover:shadow-[0_4px_8px_rgba(0,0,0,0.15)] transition-all duration-200"
                    >
                      <ArrowUp className="h-3 w-3" />
                    </ChatSubmit>
                  </div>
                </div>
              </div>
            </div>
          </form>
        </Container>
      </div>
    </div>
  )
}
