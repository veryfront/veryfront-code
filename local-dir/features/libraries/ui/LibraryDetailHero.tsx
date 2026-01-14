import * as Hero from "@/shared/ui/Hero"
import { Heading } from "@/shared/ui/Heading"
import { Text } from "@/shared/ui/Text"

export function LibraryDetailHero({ title, description, icon }) {
  return (
    <Hero.Root className="pb-4 md:pb-8 xl:pb-10 border-b border-border max-lg:mb-4 -mt-4">
      <Hero.Wrapper className="max-w-[1360px]">
        <Hero.Content
          layout={{ base: "top" }}
          className="md:col-[1_/_span_23] -mt-px"
        >
          <Hero.ContentWrapper>
            <div className="flex gap-4 items-center">
              {icon}
              <Heading as="h1" level="1">
                {title}
              </Heading>
            </div>

            <Text level="lead" className="max-w-xl">
              {description}
            </Text>
          </Hero.ContentWrapper>
        </Hero.Content>
      </Hero.Wrapper>
    </Hero.Root>
  )
}
