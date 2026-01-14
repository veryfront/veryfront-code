import { Button } from "@/shared/ui/Button"
import { Container } from "@/shared/ui/Container"
import { Heading } from "@/shared/ui/Heading"
import { Text } from "@/shared/ui/Text"
import { VideoPlayer } from "@/shared/ui/VideoPlayer"
import { ComponentsIcon } from "@/shared/ui/icons/ComponentsIcon"
import { LightDarkModeIcon } from "@/shared/ui/icons/LightDarkModeIcon"
import { ResponsiveIcon } from "@/shared/ui/icons/ResponsiveIcon"
import * as Features from "@/shared/ui/Features"
import { SectionMarker } from "@/shared/ui/SectionMarker"
import { ResponsiveImage } from "@/shared/ui/ResponsiveImage"
import { AspectRatio } from "@/shared/ui/AspectRatio"
import { ButtonGroup } from "@/shared/ui/ButtonGroup"
import * as Hero from "@/shared/ui/Hero"

const videoSrc = {
  m3u8: "https://cdn.codersociety.com/video/hls/veryfront-figma-kit/manifest.m3u8",
  mp4: "https://cdn.codersociety.com/video/hls/veryfront-figma-kit/veryfront-figma-kit.mp4",
  poster:
    "https://cdn.veryfront.com/5b74466b-ad05-4594-82f6-8ed08ad1c37c/images/veryfront-figma-kit-cover.png",
}

function Video() {
  const videoOptions = {
    autoplay: false,
    controls: true,
    responsive: true,
    fluid: true,
    sources: [
      {
        src: videoSrc.m3u8,
        type: "application/x-mpegURL",
      },
      {
        src: videoSrc.mp4,
        type: "video/mp4",
      },
    ],
  }

  const handlePlayerReady = (player) => {
    player.on("waiting", () => {
      //
    })

    player.on("dispose", () => {
      //
    })
  }

  return (
    <VideoPlayer
      options={videoOptions}
      previewImageSrc={videoSrc.poster}
      previewImageProps={{
        sizes: "98vw, 900px",
      }}
      onReady={handlePlayerReady}
      onPreviewReady={handlePlayerReady}
      aspectRatio="1920:1080"
      rounded={false}
    />
  )
}

export function FigmaKitHero() {
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
                Design websites in minutes
              </Heading>

              <Text level="lead">
                Design stunning websites in minutes with our Figma kit
              </Text>

              <ButtonGroup
                className="pt-2"
                layout={{
                  base: "center",
                }}
              >
                <Button size="lg" asChild>
                  <a href="https://www.figma.com/community/file/1448348825622622559/veryfront-figma-kit">
                    Get it for free
                  </a>
                </Button>
              </ButtonGroup>
            </Hero.ContentWrapper>
          </Hero.Content>

          <Hero.Aside
            layout={{ base: "bottom" }}
            className="px-4 md:px-0 md:col-[13_/_span_13] lg:col-[12_/_span_13]"
          >
            <div className="rounded-md overflow-hidden border-4 border-solid border-[#383842]">
              <Video />
            </div>
          </Hero.Aside>
        </Hero.Wrapper>
      </Hero.Root>

      <Features.Root>
        <Container>
          <Features.Grid>
            <Features.Item>
              <Features.CircleIcon>
                <ComponentsIcon className="size-6 lg:size-7" />
              </Features.CircleIcon>

              <Features.Content>
                <Heading level="3">100+ Components</Heading>
                <Text level="3">
                  A wide array of components at your fingertips.
                </Text>
              </Features.Content>
            </Features.Item>

            <Features.Item>
              <Features.CircleIcon>
                <LightDarkModeIcon className="size-6 lg:size-7 -mt-px" />
              </Features.CircleIcon>

              <Features.Content>
                <Heading level="3">Light & Dark Mode</Heading>
                <Text level="3">Dark and light components ready to use.</Text>
              </Features.Content>
            </Features.Item>

            <Features.Item>
              <Features.CircleIcon>
                <ResponsiveIcon className="size-5 lg:size-6 -mt-px" />
              </Features.CircleIcon>

              <Features.Content>
                <Heading level="3">Fully Responsive</Heading>
                <Text level="3">
                  Fully responsive components for every device.
                </Text>
              </Features.Content>
            </Features.Item>
          </Features.Grid>
        </Container>
      </Features.Root>
    </>
  )
}
