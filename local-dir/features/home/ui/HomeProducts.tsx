import { Container } from "@/shared/ui/Container"
import * as Section from "@/shared/ui/Section"
import { AspectRatio } from "@/shared/ui/AspectRatio"
import { ResponsiveImage } from "@/shared/ui/ResponsiveImage"

const products = [
  {
    id: 5,
    title: "Studio",
    description: "Agentic IDE for developer and agent collaboration",
    imageSrc:
      "https://cdn.veryfront.com/5b74466b-ad05-4594-82f6-8ed08ad1c37c/products/vf-products-studio.png",
    imageAspect: "aspect-[702/414]",
    imageWidth: 702,
    imageHeight: 414,
    imageAlt: "Veryfront Studio",
  },
  {
    id: 6,
    title: "Agents",
    description: "A team of AI agents that write, test, review and deploy code",
    imageSrc:
      "https://cdn.veryfront.com/5b74466b-ad05-4594-82f6-8ed08ad1c37c/products/vf-products-agents.png",
    imageAspect: "aspect-[702/414]",
    imageWidth: 702,
    imageHeight: 414,
    imageAlt: "Veryfront Studio",
  },
  {
    id: 7,
    title: "Runtimes",
    description:
      "Secure environments for code execution with microVM isolation",
    imageSrc:
      "https://cdn.veryfront.com/5b74466b-ad05-4594-82f6-8ed08ad1c37c/products/vf-products-runtimes.png",
    imageAspect: "aspect-[702/414]",
    imageWidth: 702,
    imageHeight: 414,
    imageAlt: "Veryfront Studio",
  },
  {
    id: 8,
    title: "Deployments",
    description:
      "K8s-native, delivered via Helm Charts for enterprise use (on-prem, private cloud or hybrid)",
    imageSrc:
      "https://cdn.veryfront.com/5b74466b-ad05-4594-82f6-8ed08ad1c37c/products/vf-products-runtimes.png",
    imageAspect: "aspect-[702/414]",
    imageWidth: 702,
    imageHeight: 414,
    imageAlt: "Veryfront Studio",
  },
]

export function HomeProducts() {
  return (
    <Container>
      {false && (
        <Section.Header layout={{ base: "left", xs: "left", md: "left" }}>
          <Section.Title className="text-balance text-2xl sm:text-3xl md:text-3xl lg:text-4xl">
            Vibe Coding for Enterprise AI
          </Section.Title>

          <Section.Description className="text-balance text-sm md:text-base lg:text-lg max-w-xl">
            Fast, Scalable, Secure
          </Section.Description>
        </Section.Header>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 border border-solid border-border/80 rounded-md divide-y sm:divide-y-0 sm:divide-x divide-border/80">
        {products.slice(0, 3).map((item) => (
          <article
            key={item.id}
            className="p-4 md:p-5 lg:p-6 h-full flex flex-col flex-1 gap-2 "
          >
            <h3 className="md:text-lg lg:text-xl">{item.title}</h3>
            <p className="text-foreground/50 mb-4 md:mb-8 text-balance text-sm md:text-base">
              {item.description}
            </p>
            <div className="grayscale">
              <AspectRatio
                className={
                  "w-full mx-auto rounded-md overflow-hidden mt-auto " +
                  item.imageAspect
                }
              >
                <ResponsiveImage
                  src={item.imageSrc}
                  alt={item.imageAlt}
                  width={item.imageWidth}
                  height={item.imageHeight}
                  fill={true}
                  sizes="(max-width: 768px) 100vw, 50vw"
                />
              </AspectRatio>
            </div>
          </article>
        ))}
      </div>
    </Container>
  )
}
