import { Button } from "@/shared/ui/Button"
import { Container } from "@/shared/ui/Container"
import * as Section from "@/shared/ui/Section"
import * as Card from "@/shared/ui/Card"
import * as Content from "@/shared/ui/Content"
import * as FeaturesTabs from "@/shared/ui/FeaturesTabs"
import { ResponsiveImage } from "@/shared/ui/ResponsiveImage"
import { AspectRatio } from "@/shared/ui/AspectRatio"
import { ButtonGroup } from "@/shared/ui/ButtonGroup"

function ImageWrapper({ children }) {
  return (
    <div className="pt-4 lg:pt-5 pb-2 w-full max-md:max-w-[400px]">
      {children}
    </div>
  )
}

export function HomeFeatures() {
  return (
    <Section.Root>
      <Container>
        <Section.Header layout={{ base: "center" }}>
          <Section.Title>All In One Coding Platform</Section.Title>

          <Section.Description>
            Everything you need to build and deploy web apps.
          </Section.Description>

          <ButtonGroup className="pt-2" layout={{ base: "start" }}>
            <Button asChild variant="primary">
              <a href="/studio">Veryfront Studio</a>
            </Button>
          </ButtonGroup>
        </Section.Header>
      </Container>

      <FeaturesTabs.Root
        values={["item-1", "item-2", "item-3"]}
        autoRotate={6000}
      >
        <div>
          <Content.Wrapper>
            <Content.Content className="md:col-[1_/_span_9]">
              <Content.ContentWrapper>
                <FeaturesTabs.List>
                  <FeaturesTabs.Tab value="item-1">
                    <FeaturesTabs.Title>Code in Browser</FeaturesTabs.Title>

                    <FeaturesTabs.Description>
                      Code in the browser. Collaborate with your team.
                    </FeaturesTabs.Description>
                  </FeaturesTabs.Tab>

                  <FeaturesTabs.Tab value="item-2">
                    <FeaturesTabs.Title>Deploy Instantly</FeaturesTabs.Title>

                    <FeaturesTabs.Description>
                      Deploy changes instantly with hassle-free hosting.
                    </FeaturesTabs.Description>
                  </FeaturesTabs.Tab>

                  <FeaturesTabs.Tab value="item-3">
                    <FeaturesTabs.Title>Export Anytime</FeaturesTabs.Title>

                    <FeaturesTabs.Description>
                      Export your code anytime. No vendor lock-in.
                    </FeaturesTabs.Description>
                  </FeaturesTabs.Tab>
                </FeaturesTabs.List>
              </Content.ContentWrapper>
            </Content.Content>

            <Content.Aside className="max-md:px-4 max-md:pb-4">
              <Card className="pl-0.5 py-0.5 lg:pl-0.5 lg:py-0.5 h-full w-full flex flex-col justify-center">
                <FeaturesTabs.Content value="item-1">
                  <AspectRatio className="aspect-[560/366] overflow-hidden">
                    <ResponsiveImage
                      src="https://cdn.veryfront.com/5b74466b-ad05-4594-82f6-8ed08ad1c37c/images/code.png"
                      alt="Deployment Graphic"
                      width={560}
                      height={366}
                      fill={true}
                      className="rounded-sm"
                    />
                  </AspectRatio>
                </FeaturesTabs.Content>

                <FeaturesTabs.Content value="item-2">
                  <AspectRatio className="aspect-[560/366] overflow-hidden">
                    <ResponsiveImage
                      src="https://cdn.veryfront.com/5b74466b-ad05-4594-82f6-8ed08ad1c37c/images/deploy.png"
                      alt="Hosting / Environments Graphic"
                      width={560}
                      height={366}
                      fill={true}
                      className="rounded-sm"
                    />
                  </AspectRatio>
                </FeaturesTabs.Content>

                <FeaturesTabs.Content value="item-3">
                  <AspectRatio className="aspect-[560/366] overflow-hidden">
                    <ResponsiveImage
                      src="https://cdn.veryfront.com/5b74466b-ad05-4594-82f6-8ed08ad1c37c/images/export.png"
                      alt="Export Code Graphic"
                      width={560}
                      height={366}
                      fill={true}
                      className="rounded-sm"
                    />
                  </AspectRatio>
                </FeaturesTabs.Content>
              </Card>
            </Content.Aside>
          </Content.Wrapper>
        </div>
      </FeaturesTabs.Root>
    </Section.Root>
  )
}
