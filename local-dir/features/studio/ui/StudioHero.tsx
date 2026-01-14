import { Button } from "@/shared/ui/Button"
import { Container } from "@/shared/ui/Container"
import { Heading } from "@/shared/ui/Heading"
import { Text } from "@/shared/ui/Text"
import * as Features from "@/shared/ui/Features"
import { ResponsiveImage } from "@/shared/ui/ResponsiveImage"
import { AspectRatio } from "@/shared/ui/AspectRatio"
import { ButtonGroup } from "@/shared/ui/ButtonGroup"
import * as Hero from "@/shared/ui/Hero"
import { AutomationIcon } from "@/shared/ui/icons/AutomationIcon"
import { BrowserIcon } from "@/shared/ui/icons/BrowserIcon"
import { ThumbsUpIcon } from "@/shared/ui/icons/ThumbsUpIcon"

export function StudioHero() {
  return (
    <>
      <Hero.Root className="!pb-0">
        <Hero.Wrapper className="max-w-[1360px]">
          <Hero.Content
            layout={{ base: "top" }}
            className="md:col-[1_/_span_11]"
          >
            <Hero.ContentWrapper>
              <Heading as="h1" level="1">
                Launch your React app in minutes
              </Heading>

              <Text level="lead">
                Easily create, manage, and deploy your React app, all in one
                place.
              </Text>

              <ButtonGroup
                layout={{
                  base: "center",
                }}
              >
                <Button size="lg" asChild>
                  <a href="https://new.veryfront.com?prompt=forked">
                    Start for free
                  </a>
                </Button>
              </ButtonGroup>
            </Hero.ContentWrapper>
          </Hero.Content>

          <Hero.Aside
            layout={{ base: "bottom" }}
            className="px-4 md:px-0 md:col-[13_/_span_13] lg:col-[12_/_span_13]"
          >
            <AspectRatio className="aspect-[584/375] w-full mx-auto rounded-md overflow-hidden border-4 border-solid border-[#383842]">
              <ResponsiveImage
                src="https://cdn.veryfront.com/5b74466b-ad05-4594-82f6-8ed08ad1c37c/images/studio-hero.png"
                alt="Veryfront Studio"
                width={584}
                height={375}
                fill={true}
                sizes="(max-width: 768px) 100vw, 50vw"
              />
            </AspectRatio>
          </Hero.Aside>
        </Hero.Wrapper>
      </Hero.Root>

      <Features.Root>
        <Container>
          <Features.Grid>
            <Features.Item>
              <Features.CircleIcon>
                <AutomationIcon className="size-6 lg:size-7" />
              </Features.CircleIcon>

              <Features.Content>
                <Heading level="3">Automate Workflow</Heading>
                <Text level="3">
                  Streamline processes and boost productivity.
                </Text>
              </Features.Content>
            </Features.Item>

            <Features.Item>
              <Features.CircleIcon>
                <BrowserIcon className="size-6 lg:size-7 -mt-px" />
              </Features.CircleIcon>

              <Features.Content>
                <Heading level="3">Code in Browser</Heading>
                <Text level="3">
                  Simplify development by allowing real-time testing and faster
                  iteration.
                </Text>
              </Features.Content>
            </Features.Item>

            <Features.Item>
              <Features.CircleIcon>
                <ThumbsUpIcon className="size-5 lg:size-6 -mt-px" />
              </Features.CircleIcon>

              <Features.Content>
                <Heading level="3">Quick & Easy</Heading>
                <Text level="3">
                  Fast and easy to use, improving workflow with minimal effort.
                </Text>
              </Features.Content>
            </Features.Item>
          </Features.Grid>
        </Container>
      </Features.Root>
    </>
  )
}
