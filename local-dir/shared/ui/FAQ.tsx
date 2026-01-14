import { Container } from "@/shared/ui/Container"
import { Heading } from "@/shared/ui/Heading"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/shared/ui/Accordion"

export function FAQAccordion() {
  return (
    <Accordion type="single" collapsible>
      <AccordionItem value="item-0">
        <AccordionTrigger>How does Veryfront's pricing work?</AccordionTrigger>

        <AccordionContent>
          Veryfront is free to use with our Starter plan, which includes
          unlimited private apps. When you're ready to make your apps public,
          you'll need a Professional subscription at $29/month which includes 5
          public apps with custom domains. Additional public apps can be
          purchased if needed.
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="item-1">
        <AccordionTrigger>
          What's the difference between private and public apps?
        </AccordionTrigger>

        <AccordionContent>
          Private apps are accessible via Veryfront URLs and are perfect for
          development and testing. Public apps have custom domains, no Veryfront
          branding, and are designed for production use. Both types support
          unlimited deployments.
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="item-2">
        <AccordionTrigger>
          Are there any limits on the Starter plan?
        </AccordionTrigger>

        <AccordionContent>
          You can create unlimited private apps on the Starter plan. The
          limitations include:
          <ul className="list-disc pl-5 mt-2">
            <li>No public apps or custom domains</li>
            <li>Veryfront branding is displayed</li>
            <li>Limited to 10 free AI completions</li>
            <li>Only one team member</li>
            <li>1GB total storage</li>
            <li>10GB/month bandwidth</li>
            <li>100K/month API calls</li>
            <li>300/month release builds</li>
          </ul>
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="item-3">
        <AccordionTrigger>How do AI credits work?</AccordionTrigger>

        <AccordionContent>
          Starter users get 10 free AI completions. Professional subscribers get
          50 AI credits per month included in their subscription. Each AI
          interaction costs 1 credit, regardless of whether you're using it for:
          <ul className="list-disc pl-5 mt-2">
            <li>Code generation</li>
            <li>Chat completions</li>
            <li>Code editing</li>
            <li>Code explanations</li>
          </ul>
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="item-4">
        <AccordionTrigger>
          Can I convert a private app to a public app?
        </AccordionTrigger>

        <AccordionContent>
          Yes! You can upgrade any private app to a public app at any time if
          you have available public app slots in your Professional subscription
          or purchase additional slots.
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="item-5">
        <AccordionTrigger>
          Can I try Veryfront before signing up?
        </AccordionTrigger>

        <AccordionContent>
          Yes! You can use the instant demo on our homepage without even
          creating an account. You'll get 5 free AI completions to explore the
          platform.
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="item-6">
        <AccordionTrigger>Is there a long-term commitment?</AccordionTrigger>

        <AccordionContent>
          No. Professional subscriptions are month-to-month, and you can cancel
          anytime. You can save 20% by choosing annual billing.
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}

export function FAQ() {
  return (
    <section className="bg-highlight py-12 md:py-16 lg:py-20 xl:py-24">
      <Container className="max-w-[1050px]">
        <header className="mb-2 md:mb-4 lg:mb-6">
          <Heading>Frequently Asked Questions</Heading>
        </header>
        <FAQAccordion />
      </Container>
    </section>
  )
}
