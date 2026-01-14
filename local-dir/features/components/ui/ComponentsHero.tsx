import * as Hero from "@/shared/ui/Hero"
import { Heading } from "@/shared/ui/Heading"
import { Text } from "@/shared/ui/Text"

export function ComponentsHero({ title, subtitle }) {
  return (
    <Hero.Root className="pb-8 md:pb-12 xl:pb-12">
      <Hero.Wrapper className="max-w-[1360px]">
        <Hero.Content
          layout={{ base: "top" }}
          className="md:col-[1_/_span_23] -mt-px"
        >
          <Hero.ContentWrapper>
            <Heading as="h1" level="1">
              {title}
            </Heading>

            <Text level="lead">{subtitle}</Text>
          </Hero.ContentWrapper>
        </Hero.Content>
      </Hero.Wrapper>
    </Hero.Root>
  )
}
