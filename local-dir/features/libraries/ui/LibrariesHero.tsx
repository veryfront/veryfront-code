import * as Hero from "@/shared/ui/Hero"
import { Heading } from "@/shared/ui/Heading"
import { Text } from "@/shared/ui/Text"

export function LibrariesHero() {
  return (
    <Hero.Root className="pb-4 md:pb-8 xl:pb-10 border-b border-border max-lg:mb-4">
      <Hero.Wrapper className="max-w-[1360px]">
        <Hero.Content
          layout={{ base: "top" }}
          className="md:col-[1_/_span_23] -mt-px"
        >
          <Hero.ContentWrapper>
            <Heading as="h1" level="1">
              Veryfront Libraries
            </Heading>

            <Text level="lead" className="max-w-xl">
              Power up your application with ready-to-go integrations and UI
              libraries — from AI to payments, logging to workflow, we’ve got
              you covered.
            </Text>
          </Hero.ContentWrapper>
        </Hero.Content>
      </Hero.Wrapper>
    </Hero.Root>
  )
}
