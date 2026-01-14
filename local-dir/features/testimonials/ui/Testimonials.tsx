import { Container } from "@/shared/ui/Container"
import * as Section from "@/shared/ui/Section"
import { Card } from "@/shared/ui/Card"
import * as Person from "@/shared/ui/Person"
import { ResponsiveImage } from "@/shared/ui/ResponsiveImage"

const testimonialsData = [
  {
    id: 1,
    quote:
      "Veryfront feels like my local environment, reducing our development time with its automation features and MDX integration.",
    name: "Sarah Thompson",
    position: "Senior Developer at Tech Innovators",
    imageSrc:
      "https://cdn.veryfront.com/5b74466b-ad05-4594-82f6-8ed08ad1c37c/images/testimonials/sarah.jpeg",
  },
  {
    id: 2,
    quote:
      "Veryfront makes coding in the cloud work perfectly. With ready-made UI components and realtime previews, we launched our app in record time.",
    name: "Michael Lee",
    position: "Product Manager at Web Solutions",
    imageSrc:
      "https://cdn.veryfront.com/5b74466b-ad05-4594-82f6-8ed08ad1c37c/images/testimonials/michael.jpeg",
  },
  {
    id: 3,
    quote:
      "It's such a huge productivity boost. The simplicity and efficiency, coupled with MDX integration, make it our go-to tool.",
    name: "Emily Davis",
    position: "Frontend Engineer at Creative Co.",
    imageSrc:
      "https://cdn.veryfront.com/5b74466b-ad05-4594-82f6-8ed08ad1c37c/images/testimonials/emily.jpeg",
  },
  {
    id: 4,
    quote:
      "Veryfront's ready-made UI components and realtime previews are game-changers for rapid prototyping.",
    name: "Daniel Kim",
    position: "UI/UX Designer at Pixel Perfect",
    imageSrc:
      "https://cdn.veryfront.com/5b74466b-ad05-4594-82f6-8ed08ad1c37c/images/testimonials/daniel.jpeg",
  },
  {
    id: 5,
    quote:
      "The efficiency gains with Veryfront are unparalleled. It makes coding in the cloud just work, especially with MDX integration.",
    name: "Anna Johnson",
    position: "Engineering Manager at CodeCraft",
    imageSrc:
      "https://cdn.veryfront.com/5b74466b-ad05-4594-82f6-8ed08ad1c37c/images/testimonials/anna.jpeg",
  },
  {
    id: 6,
    quote:
      "Deploying web apps is a breeze with Veryfront. The automation features save us so much time and it's a huge productivity boost.",
    name: "Chis Brown",
    position: "Software Engineer at Cloud Dynamics",
    imageSrc:
      "https://cdn.veryfront.com/5b74466b-ad05-4594-82f6-8ed08ad1c37c/images/testimonials/chris.jpeg",
  },
]

export function Testimonials() {
  return (
    <Section.Root>
      <Container>
        <Section.Header>
          <Section.Title>Ready to Start Building?</Section.Title>

          <Section.Description>
            Join the future of coding. Get started with free account.
          </Section.Description>
        </Section.Header>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {testimonialsData?.map((testimonial) => (
            <Card key={testimonial.id}>
              <div className="flex flex-col flex-1 items-start gap-2.5 lg:gap-3.5 p-5 md:p-6 lg:p-7 h-full">
                <p className="flex-1">{testimonial.quote}</p>

                <Person.Root className="pt-4 mt-auto gap-3.5">
                  <Person.Avatar className="w-[38px]">
                    <ResponsiveImage
                      src={testimonial.imageSrc}
                      alt={testimonial.title}
                      width={38}
                      height={38}
                      fill={true}
                      className="grayscale"
                      sizes="38px"
                    />
                  </Person.Avatar>

                  <Person.Info>
                    <Person.Title>{testimonial.name}</Person.Title>

                    <Person.Subtitle className="text-card-foreground">
                      {testimonial.position}
                    </Person.Subtitle>
                  </Person.Info>
                </Person.Root>
              </div>
            </Card>
          ))}
        </div>
      </Container>
    </Section.Root>
  )
}
