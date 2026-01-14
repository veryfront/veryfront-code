import { Button } from "@/shared/ui/Button"
import { Heading } from "@/shared/ui/Heading"
import { Text } from "@/shared/ui/Text"
import { Container } from "@/shared/ui/Container"
import { ButtonGroup } from "@/shared/ui/ButtonGroup"
import { Card } from "@/shared/ui/Card"

interface CTAContentProps {
  title?: string
  description?: string
  buttonText?: string
  buttonHref?: string
}

function CTAContent({
  title = "Deliver AI-powered software applications faster",
  description = "Build and deploy custom apps faster by collaborating with AI agents and your team.",
  buttonText = "Start for free",
  buttonHref = "https://new.veryfront.com?prompt=forked",
}: CTAContentProps) {
  return (
    <div className="py-12 md:py-16 lg:py-20 xl:py-24 flex flex-col items-center text-center">
      <div className="max-w-2xl flex flex-col items-center gap-4 md:gap-6">
        <Heading as="h2" level="1">
          {title}
        </Heading>
        <Text level="1" className="text-balance max-w-md font-medium">
          {description}
        </Text>
        <ButtonGroup>
          <Button size="lg" asChild>
            <a href={buttonHref}>{buttonText}</a>
          </Button>
        </ButtonGroup>
      </div>
    </div>
  )
}

interface CTAProps extends CTAContentProps {
  variant?: "card" | "panel"
}

export function CTA({ variant = "panel", ...props }: CTAProps) {
  if (variant === "card") {
    return (
      <Container>
        <Card>
          <CTAContent {...props} />
        </Card>
      </Container>
    )
  }

  return (
    <div className="bg-highlight border-t border-t-divider">
      <Container>
        <CTAContent {...props} />
      </Container>
    </div>
  )
}
