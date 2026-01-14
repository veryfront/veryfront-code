import * as Hero from "@/shared/ui/Hero"
import { Heading } from "@/shared/ui/Heading"
import { Text } from "@/shared/ui/Text"

export function TemplatesHero() {
  return (
    <Hero.Root className="pb-4 md:pb-8 xl:pb-10">
      <Hero.Wrapper className="max-w-[1360px]">
        <Hero.Content
          layout={{ base: "top" }}
          className="md:col-[1_/_span_23] -mt-px"
        >
          <Hero.ContentWrapper>
            <Heading as="h1" level="1">
              Veryfront Templates
            </Heading>

            <Text level="lead">Templates to kick-start your next project.</Text>
          </Hero.ContentWrapper>
        </Hero.Content>
      </Hero.Wrapper>
    </Hero.Root>
  )
}
