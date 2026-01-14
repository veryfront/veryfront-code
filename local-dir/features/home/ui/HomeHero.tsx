import { Button } from "@/shared/ui/Button"
import { Container } from "@/shared/ui/Container"
import * as Features from "@/shared/ui/Features"
import { ResponsiveImage } from "@/shared/ui/ResponsiveImage"
import { AspectRatio } from "@/shared/ui/AspectRatio"
import { ButtonGroup } from "@/shared/ui/ButtonGroup"
import * as Hero from "@/shared/ui/Hero"

export function HomeHero() {
  return (
    <Hero.Root>
      <Hero.Wrapper variant="column" className="max-w-[1360px]">
        <Hero.Content layout={{ base: "top", xs: "top", md: "top" }}>
          <Hero.ContentWrapper
            layout={{ base: "center", xs: "center", md: "center" }}
          >
            <Hero.Title className="font-medium">
              Build & Ship All in One Place
            </Hero.Title>

            <Hero.Description className="text-balance">
              Code apps with React and Tailwind in the browser. Use templates
              and components. Deploy instantly. Export anytime.
            </Hero.Description>

            <ButtonGroup
              className="pt-2"
              layout={{
                base: "center",
              }}
            >
              <Button asChild size="lg">
                <a href="https://new.veryfront.com?prompt=forked">
                  Get started for free
                </a>
              </Button>
            </ButtonGroup>
          </Hero.ContentWrapper>
        </Hero.Content>

        <Hero.Aside layout={{ base: "bottom", xs: "bottom", md: "bottom" }}>
          <div className="lg:-mx-32">
            <AspectRatio className="aspect-[3064/1354] w-full rounded overflow-hidden">
              <ResponsiveImage
                src="https://cdn.veryfront.com/5b74466b-ad05-4594-82f6-8ed08ad1c37c/images/hero-home-lite.png"
                alt="Veryfront Studio UI Screenshot"
                width={3064}
                height={1354}
                fill={true}
                className="dark:hidden block"
              />
              <ResponsiveImage
                src="https://cdn.veryfront.com/5b74466b-ad05-4594-82f6-8ed08ad1c37c/images/hero-home-dark.png"
                alt="Veryfront Studio UI Screenshot"
                width={3064}
                height={1354}
                fill={true}
                className="hidden dark:block"
              />
            </AspectRatio>
          </div>
        </Hero.Aside>
      </Hero.Wrapper>
    </Hero.Root>
  )
}
