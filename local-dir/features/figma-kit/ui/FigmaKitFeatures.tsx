import * as Section from "@/shared/ui/Section"
import * as Content from "@/shared/ui/Content"
import { ResponsiveImage } from "@/shared/ui/ResponsiveImage"
import { AspectRatio } from "@/shared/ui/AspectRatio"
import { Button } from "@/shared/ui/Button"
import { ButtonGroup } from "@/shared/ui/ButtonGroup"
import { Container } from "@/shared/ui/Container"
import * as Hero from "@/shared/ui/Hero"
import { Heading } from "@/shared/ui/Heading"
import { Text } from "@/shared/ui/Text"

export function FigmaKitFeatures() {
  return (
    <Section.Root>
      <Container>
        <Section.Header>
          <Heading>Design process</Heading>

          <Text level="lead" className="max-w-2xl">
            Streamline your design process with our Figma kit, featuring
            intuitive tools and pre-built components to save time and boost
            creativity.
          </Text>
        </Section.Header>
      </Container>

      <Content.Root>
        <Content.Wrapper>
          <Content.Content>
            <Content.ContentWrapper>
              <Heading as="h2" level="2">
                <span>1. Choose components</span>
              </Heading>

              <Text>
                Easily customize components to fit your design needs with our
                Figma kit. Streamline your workflow by reusing and adapting
                pre-designed elements effortlessly.
              </Text>
            </Content.ContentWrapper>
          </Content.Content>

          <Content.Aside className="px-4 md:px-0">
            <AspectRatio className="aspect-[1120/700] rounded-xl overflow-hidden w-full h-full">
              <ResponsiveImage
                src="https://cdn.veryfront.com/5b74466b-ad05-4594-82f6-8ed08ad1c37c/figma-kit/veryfront-figma-kit-choose-components.png"
                alt="Veryfront Figma Kit - Choose Components"
                width={1120}
                height={700}
                fill={true}
              />
            </AspectRatio>
          </Content.Aside>
        </Content.Wrapper>
      </Content.Root>

      <Content.Root>
        <Content.Wrapper>
          <Content.Content layout={{ md: "end" }}>
            <Content.ContentWrapper>
              <Heading as="h2" level="2">
                <span>2. Build pages</span>
              </Heading>

              <Text>
                Quickly build pages using fully customizable components in our
                Figma kit. Adapt layouts and elements to match your vision while
                maintaining design consistency.
              </Text>
            </Content.ContentWrapper>
          </Content.Content>

          <Content.Aside className="px-4 md:px-0" layout={{ md: "start" }}>
            <AspectRatio className="aspect-[1120/700] rounded-xl overflow-hidden w-full h-full">
              <ResponsiveImage
                src="https://cdn.veryfront.com/5b74466b-ad05-4594-82f6-8ed08ad1c37c/figma-kit/veryfront-figma-kit-build-pages.png"
                alt="Veryfront Figma Kit - Build Pages"
                width={1120}
                height={700}
                fill={true}
              />
            </AspectRatio>
          </Content.Aside>
        </Content.Wrapper>
      </Content.Root>

      <Content.Root>
        <Content.Wrapper>
          <Content.Content>
            <Content.ContentWrapper>
              <Heading as="h2" level="2">
                <span>3. Add content</span>
              </Heading>

              <Text>
                Adding content to our customizable components is seamless and
                intuitive. Simply replace placeholders with your own text,
                images, or data to bring designs to life effortlessly.
              </Text>
            </Content.ContentWrapper>
          </Content.Content>

          <Content.Aside className="px-4 md:px-0">
            <AspectRatio className="aspect-[1120/700] rounded-xl overflow-hidden w-full h-full">
              <ResponsiveImage
                src="https://cdn.veryfront.com/5b74466b-ad05-4594-82f6-8ed08ad1c37c/figma-kit/veryfront-figma-kit-add-content.png"
                alt="Veryfront Figma Kit - Add Content"
                width={1120}
                height={700}
                fill={true}
              />
            </AspectRatio>
          </Content.Aside>
        </Content.Wrapper>
      </Content.Root>

      <Content.Root>
        <Content.Wrapper>
          <Content.Content layout={{ md: "end" }}>
            <Content.ContentWrapper>
              <Heading as="h2" level="2">
                <span>4. Design to code handoff</span>
              </Heading>

              <Text>
                Streamline design handoff to front-end developers with organized
                layers and consistent components. Our Figma kit ensures clarity
                and precision, making implementation quick and hassle-free.
              </Text>
            </Content.ContentWrapper>
          </Content.Content>

          <Content.Aside className="px-4 md:px-0" layout={{ md: "start" }}>
            <AspectRatio className="aspect-[1120/700] rounded-xl overflow-hidden w-full h-full">
              <ResponsiveImage
                src="https://cdn.veryfront.com/5b74466b-ad05-4594-82f6-8ed08ad1c37c/figma-kit/veryfront-figma-kit-design-to-code-handoff.png"
                alt="Veryfront Figma Kit - Design to Code Handoff"
                width={1120}
                height={700}
                fill={true}
              />
            </AspectRatio>
          </Content.Aside>
        </Content.Wrapper>
      </Content.Root>
    </Section.Root>
  )
}
