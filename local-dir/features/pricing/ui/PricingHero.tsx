import * as Hero from "@/shared/ui/Hero"
import { Heading } from "@/shared/ui/Heading"
import { Text } from "@/shared/ui/Text"

export function PricingHero({ children }) {
  return (
    <Hero.Root>
      <Hero.Wrapper variant="column" className="max-w-[1360px]">
        <Hero.Content layout={{ base: "top", xs: "top", md: "top" }}>
          <Hero.ContentWrapper
            layout={{ base: "start", xs: "center", md: "center" }}
          >
            <Heading as="h1" level="1">
              Pricing
            </Heading>

            <Text level="lead">Free until you are ready to go live.</Text>
          </Hero.ContentWrapper>
        </Hero.Content>
      </Hero.Wrapper>
    </Hero.Root>
  )
}
