import { Button } from "@/shared/ui/Button"
import { Heading } from "@/shared/ui/Heading"
import { Text } from "@/shared/ui/Text"
import * as Content from "@/shared/ui/Content"
import * as FeaturesTabs from "@/shared/ui/FeaturesTabs"
import { ResponsiveImage } from "@/shared/ui/ResponsiveImage"
import { AspectRatio } from "@/shared/ui/AspectRatio"
import { ButtonGroup } from "@/shared/ui/ButtonGroup"
import { Card } from "@/shared/ui/Card"

export function StudioFeatures() {
  return (
    <>
      <Content.Root>
        <Content.Wrapper>
          <Content.Content>
            <Content.ContentWrapper>
              <Heading level="2">Code in the Browser</Heading>

              <Text>
                The intuitive interface simplifies the coding process, allowing
                developers to focus on building efficiently. Veryfront ensures a
                smooth and responsive experience for all your browser-based
                coding needs.
              </Text>
            </Content.ContentWrapper>
          </Content.Content>

          <Content.Aside className="px-4 md:px-0 flex justify-center flex-col">
            <Card
              border
              solid
              className="pl-8 py-8 lg:pl-12 lg:py-12 flex flex-col items-end justify-center"
            >
              <AspectRatio className="aspect-[1414/541] overflow-hidden">
                <ResponsiveImage
                  src="https://cdn.veryfront.com/5b74466b-ad05-4594-82f6-8ed08ad1c37c/features/studio-feature-code-dark.png"
                  alt="Browser Coding Graphic"
                  width={1414}
                  height={541}
                  fill={true}
                />
              </AspectRatio>
            </Card>
          </Content.Aside>
        </Content.Wrapper>
      </Content.Root>

      <Content.Root>
        <Content.Wrapper>
          <Content.Content layout={{ md: "end" }}>
            <Content.ContentWrapper>
              <Heading level="2">Collaborate in Real-Time</Heading>

              <Text>
                Collaborating in real-time with Veryfront allows teams to work
                together seamlessly, making instant updates and feedback
                possible. This enhances productivity and ensures everyone stays
                aligned throughout the development process.
              </Text>
            </Content.ContentWrapper>
          </Content.Content>

          <Content.Aside
            className="px-4 md:px-0 flex justify-center flex-col"
            layout={{ md: "start" }}
          >
            <Card className="flex flex-col items-start justify-center">
              <AspectRatio className="aspect-[1540/808] overflow-hidden">
                <ResponsiveImage
                  src="https://cdn.veryfront.com/5b74466b-ad05-4594-82f6-8ed08ad1c37c/features/studio-feature-collab-dark.png"
                  alt="Live Collaboration Graphic"
                  width={1540}
                  height={808}
                  fill={true}
                />
              </AspectRatio>
            </Card>
          </Content.Aside>
        </Content.Wrapper>
      </Content.Root>

      <Content.Root>
        <Content.Wrapper>
          <Content.Content>
            <Content.ContentWrapper>
              <Heading level="2">Share Preview Links</Heading>

              <Text>
                With Veryfront, sharing and previewing links is quick and
                straightforward, allowing teams to instantly review progress.
                This feature ensures everyone can easily access live updates and
                provide feedback in real-time.
              </Text>
            </Content.ContentWrapper>
          </Content.Content>

          <Content.Aside className="px-4 md:px-0 flex justify-center flex-col">
            <Card className="flex flex-col items-end justify-end">
              <AspectRatio className="aspect-[1540/808] overflow-hidden">
                <ResponsiveImage
                  src="https://cdn.veryfront.com/5b74466b-ad05-4594-82f6-8ed08ad1c37c/features/studio-feature-share-dark.png"
                  alt="Preview Sharing Graphic"
                  width={1540}
                  height={808}
                  fill={true}
                />
              </AspectRatio>
            </Card>
          </Content.Aside>
        </Content.Wrapper>
      </Content.Root>

      <FeaturesTabs.Root
        values={["item-1", "item-2", "item-3"]}
        autoRotate={6000}
      >
        <Content.Root>
          <Content.Wrapper>
            <Content.Content className="md:col-[1_/_span_9]">
              <Content.ContentWrapper>
                <FeaturesTabs.List>
                  <FeaturesTabs.Tab value="item-1">
                    <FeaturesTabs.Title>Deploy Instantly</FeaturesTabs.Title>

                    <FeaturesTabs.Description>
                      Veryfront enables instant deployment, streamlining the
                      process from development to live updates in seconds.
                    </FeaturesTabs.Description>
                  </FeaturesTabs.Tab>

                  <FeaturesTabs.Tab value="item-2">
                    <FeaturesTabs.Title>Host Hassle-Free</FeaturesTabs.Title>

                    <FeaturesTabs.Description>
                      Host hassle-free with Veryfront, ensuring seamless and
                      reliable performance without the complexities.
                    </FeaturesTabs.Description>
                  </FeaturesTabs.Tab>

                  <FeaturesTabs.Tab value="item-3">
                    <FeaturesTabs.Title>Export Code Anytime</FeaturesTabs.Title>

                    <FeaturesTabs.Description>
                      With Veryfront you can export code anytime, ensuring
                      flexibility and control over your projects.
                    </FeaturesTabs.Description>
                  </FeaturesTabs.Tab>
                </FeaturesTabs.List>
              </Content.ContentWrapper>
            </Content.Content>

            <Content.Aside className="max-md:px-4 max-md:pb-4">
              <Card className="pl-0.5 py-0.5 lg:pl-0.5 lg:py-0.5 h-full w-full flex flex-col justify-center">
                <FeaturesTabs.Content value="item-1">
                  <AspectRatio className="aspect-[1540/1108] overflow-hidden">
                    <ResponsiveImage
                      src="https://cdn.veryfront.com/5b74466b-ad05-4594-82f6-8ed08ad1c37c/features/studio-feature-deploy-dark.png"
                      alt="Deployment Graphic"
                      width={1540}
                      height={1108}
                      fill={true}
                    />
                  </AspectRatio>
                </FeaturesTabs.Content>

                <FeaturesTabs.Content value="item-2">
                  <AspectRatio className="aspect-[1540/1108] overflow-hidden">
                    <ResponsiveImage
                      src="https://cdn.veryfront.com/5b74466b-ad05-4594-82f6-8ed08ad1c37c/features/studio-feature-hosting-dark.png"
                      alt="Hosting / Environments Graphic"
                      width={1540}
                      height={1108}
                      fill={true}
                    />
                  </AspectRatio>
                </FeaturesTabs.Content>

                <FeaturesTabs.Content value="item-3">
                  <AspectRatio className="aspect-[1540/1108] overflow-hidden">
                    <ResponsiveImage
                      src="https://cdn.veryfront.com/5b74466b-ad05-4594-82f6-8ed08ad1c37c/features/studio-feature-export-dark.png"
                      alt="Export Code Graphic"
                      width={1540}
                      height={1108}
                      fill={true}
                    />
                  </AspectRatio>
                </FeaturesTabs.Content>
              </Card>
            </Content.Aside>
          </Content.Wrapper>
        </Content.Root>
      </FeaturesTabs.Root>
    </>
  )
}
