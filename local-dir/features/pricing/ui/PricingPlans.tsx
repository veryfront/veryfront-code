import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/Tabs"
import { AVAILABLE_PLANS, getDisplayPrice } from "@/shared/utils/plansConfig"
import { Button } from "@/shared/ui/Button"
import { Check } from "https://esm.sh/lucide-react"
import { Container } from "@/shared/ui/Container"

function getButtonProps(plan, cycle) {
  if (plan.isDefault) {
    return {
      label: "Get Started",
      href: "https://new.veryfront.com?prompt=forked",
    }
  }

  if (plan.id === "Enterprise") {
    return {
      label: "Contact Sales",
      href: "https://veryfront.com/contact/sales",
    }
  }

  return {
    label: `Upgrade to ${plan.title}`,
    href: `https://veryfront.com/dashboard/settings`,
  }
}

const PlanCard = ({ plan, cycle }) => {
  const button = getButtonProps(plan, cycle)

  return (
    <div className="relative p-6 rounded-lg border border-foreground/20 text-left">
      <div className="flex flex-col">
        <div className="flex flex-col gap-3 min-h-24">
          <h2 className="font-semibold text-2xl">{plan.title}</h2>
          <p className="text-foreground/60 text-sm text-balance">
            {plan.description} {plan.scenario}
          </p>
        </div>
        <div className="flex items-center text-4xl font-medium mb-3 min-h-14 tracking-wide">
          <p>
            {getDisplayPrice(
              cycle === "annually" ? plan.priceYearly : plan.priceMonthly,
            )}
          </p>
        </div>
        <Button size="lg" asChild>
          <a
            href={button.href}
            onClick={() => {
              window.dataLayer?.push({
                event: "custom_event",
                section: "plan",
                category: "link",
                action: "clicked",
                label: button.label,
              })
            }}
          >
            {button.label}
          </a>
        </Button>

        <ul className="flex flex-col gap-2.5 text-sm leading-snug mt-6">
          {plan.features?.map((item) => (
            <li key={item} className="flex flex-row">
              <Check className="mr-2 size-6 text-foreground" />
              <div className="text-left">{item}</div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

const Plans = ({ plans, cycle }) => {
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8 justify-start">
        {Object.values(plans)?.map((plan) => {
          return <PlanCard key={plan.id} plan={plan} cycle={cycle} />
        })}
      </div>
      <p className="text-sm text-foreground/60 text-center mt-6">
        * Additional AI credits can be purchased as an add-on
      </p>
    </>
  )
}

export function PricingPlans() {
  return (
    <Container>
      <Tabs defaultValue="monthly" className="w-full">
        <div className="xs:flex flex-col items-center">
          <TabsList>
            <TabsTrigger value="monthly">Monthly</TabsTrigger>

            <TabsTrigger value="annually">Annually</TabsTrigger>
          </TabsList>
        </div>

        <div className="mt-8">
          <TabsContent value="monthly">
            <Plans plans={AVAILABLE_PLANS} cycle="monthly" />
          </TabsContent>

          <TabsContent value="annually">
            <Plans plans={AVAILABLE_PLANS} cycle="annually" />
          </TabsContent>
        </div>
      </Tabs>
    </Container>
  )
}
