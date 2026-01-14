import { Network, LockOpen, Layers, Shield } from "https://esm.sh/lucide-react"
import { Heading } from "@/shared/ui/Heading"
import { Container } from "@/shared/ui/Container"
import { Text } from "@/shared/ui/Text"
import { AgentIcon } from "@/shared/ui/icons/AgentIcon"
import { AutomationIcon } from "@/shared/ui/icons/AutomationIcon"
import { cn } from "@/shared/utils/utils"

export function ProductFeatures({
  title = "Create and deploy AI powered applications",
  isCenteredTitle = false,
}: {
  title: string
  isCenteredTitle: boolean
}) {
  return (
    <Container>
      {title && (
        <Heading
          as="h2"
          level="1"
          className={cn(
            "mb-8 lg:mb-12 max-w-xl text-balance",
            isCenteredTitle && "text-center mx-auto",
          )}
        >
          {title}
        </Heading>
      )}

      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 md:gap-12 lg:gap-16">
        <article className="space-y-3 lg:pr-4 xl:pr-8">
          <div className="w-12 h-12 flex items-center justify-center">
            <AgentIcon className="w-8 h-8" strokeWidth={1} />
          </div>
          <div>
            <Heading level="3" className="mb-2.5">
              AI Powered Development
            </Heading>
            <Text level="3">
              Accelerate the full software lifecycle with integrated AI. From
              plan and build to deploy and operate, streamline every stage with
              smart automation.
            </Text>
          </div>
        </article>

        <article className="space-y-3 lg:pr-4 xl:pr-8">
          <div className="w-12 h-12 flex items-center justify-center">
            <Layers className="w-8 h-8" strokeWidth={1} />
          </div>
          <div>
            <Heading level="3" className="mb-2.5">
              One Tech Stack
            </Heading>
            <Text level="3">
              Build AI-powered business applications on a unified, modern stack
              and reduce the operational overhead of fragmented enterprise
              environments.
            </Text>
          </div>
        </article>

        <article className="space-y-3 lg:pr-4 xl:pr-8">
          <div className="w-12 h-12 flex items-center justify-center">
            <Network className="w-8 h-8" strokeWidth={1} />
          </div>
          <div>
            <Heading level="3" className="mb-2.5">
              Real Time Collaboration
            </Heading>
            <Text level="3">
              Enable seamless teamwork between citizen developers and pro
              coders. Code, preview, and share updates instantly to stay
              aligned.
            </Text>
          </div>
        </article>

        <article className="space-y-3 lg:pr-4 xl:pr-8">
          <div className="w-12 h-12 flex items-center justify-center">
            <AutomationIcon className="w-7 h-7" strokeWidth={1} />
          </div>
          <div>
            <Heading level="3" className="mb-2.5">
              Build and Deploy in One
            </Heading>
            <Text level="3">
              Place Design, develop, and deploy from a single platform. Download
              code, integrate with Git-native workflows, and deploy via CI/CD to
              secure runtimes.
            </Text>
          </div>
        </article>

        <article className="space-y-3 lg:pr-4 xl:pr-8">
          <div className="w-12 h-12 flex items-center justify-center">
            <Shield className="w-8 h-8" strokeWidth={1} />
          </div>
          <div>
            <Heading level="3" className="mb-2.5">
              Enterprise ready
            </Heading>
            <Text level="3">
              Built for enterprise scale, security, and compliance. Enable
              multi-tenant capabilities, composable applications, and reusable
              templates.
            </Text>
          </div>
        </article>

        <article className="space-y-3 lg:pr-4 xl:pr-8">
          <div className="w-12 h-12 flex items-center justify-center">
            <LockOpen className="w-8 h-8" strokeWidth={1} />
          </div>
          <div>
            <Heading level="3" className="mb-2.5">
              No Vendor Lock In
            </Heading>
            <Text level="3">
              Retain full control of your code and infrastructure. Export
              anytime and integrate seamlessly with your existing toolchain.
            </Text>
          </div>
        </article>
      </section>
    </Container>
  )
}
