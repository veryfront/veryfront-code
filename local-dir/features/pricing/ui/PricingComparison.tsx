import * as Section from "@/shared/ui/Section"
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/Table"
import { Heading } from "@/shared/ui/Heading"
import { Text } from "@/shared/ui/Text"
import { Container } from "@/shared/ui/Container"
import React from "react"
import { Check } from "https://esm.sh/lucide-react"

const planComparisonData = [
  {
    category: "App Development",
    features: [
      {
        feature: "Private apps",
        Starter: "Unlimited",
        Professional: "Unlimited",
        Enterprise: "Unlimited",
      },
      {
        feature: "Component library",
        Starter: true,
        Professional: true,
        Enterprise: true,
      },
      {
        feature: "Starter templates",
        Starter: true,
        Professional: true,
        Enterprise: true,
      },
      {
        feature: "Veryfront Figma UI kit",
        Starter: true,
        Professional: true,
        Enterprise: true,
      },
      {
        feature: "Deployments",
        Starter: "Unlimited",
        Professional: "Unlimited",
        Enterprise: "Unlimited",
      },
    ],
  },
  {
    category: "Public Presence",
    features: [
      {
        feature: "Public apps",
        Starter: "-",
        Professional: "5 included",
        Enterprise: "Unlimited",
      },
      {
        feature: "Custom domains",
        Starter: "-",
        Professional: true,
        Enterprise: true,
      },
      {
        feature: "Remove branding",
        Starter: "-",
        Professional: true,
        Enterprise: true,
      },
      {
        feature: "Code exports",
        Starter: "-",
        Professional: true,
        Enterprise: true,
      },
    ],
  },
  {
    category: "Resources",
    features: [
      {
        feature: "Storage",
        Starter: "1GB total",
        Professional: "5GB per app",
        Enterprise: "Custom",
      },
      {
        feature: "Bandwidth",
        Starter: "10GB/month",
        Professional: "100GB/month",
        Enterprise: "Custom",
      },
      {
        feature: "API calls",
        Starter: "100K/month",
        Professional: "1M/month",
        Enterprise: "Custom",
      },
      {
        feature: "Release builds",
        Starter: "300/month",
        Professional: "1,000/month",
        Enterprise: "Custom",
      },
    ],
  },
  {
    category: "AI Assistance",
    features: [
      {
        feature: "Free AI completions",
        Starter: "10",
        Professional: "-",
        Enterprise: "-",
      },
      {
        feature: "Monthly AI credits",
        Starter: "-",
        Professional: "50 included",
        Enterprise: "Custom",
      },
      {
        feature: "Additional AI credits",
        Starter: "-",
        Professional: "From $20",
        Enterprise: "Custom",
      },
    ],
  },
  {
    category: "Team",
    features: [
      {
        feature: "Team members",
        Starter: "1",
        Professional: "Unlimited",
        Enterprise: "Unlimited",
      },
      {
        feature: "Team collaboration",
        Starter: "-",
        Professional: true,
        Enterprise: true,
      },
    ],
  },
  {
    category: "Support",
    features: [
      {
        feature: "Community support",
        Starter: true,
        Professional: true,
        Enterprise: true,
      },
      {
        feature: "Email support",
        Starter: "-",
        Professional: true,
        Enterprise: true,
      },
      {
        feature: "Priority support",
        Starter: "-",
        Professional: "$25/month",
        Enterprise: true,
      },
      {
        feature: "Dedicated support",
        Starter: "-",
        Professional: "-",
        Enterprise: true,
      },
    ],
  },
]

export function PricingComparison() {
  return (
    <Section.Root>
      <Container>
        <Section.Header>
          <Heading>Compare features</Heading>

          <Text>Evaluate and choose the best option.</Text>
        </Section.Header>

        <Table className="rounded-lg mx-auto max-w-4xl">
          <TableHeader>
            <TableRow>
              <TableHead>
                <span className="text-foreground text-semibold">Feature</span>
              </TableHead>
              <TableHead>
                <span className="text-foreground text-semibold">Starter</span>
              </TableHead>
              <TableHead>
                <span className="text-foreground text-semibold">
                  Professional
                </span>
              </TableHead>
              <TableHead>
                <span className="text-foreground text-semibold">Custom</span>
              </TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {planComparisonData.map((item, index) => (
              <React.Fragment key={item.category}>
                <TableRow>
                  <TableCell colspan="4" className="py-2.5">
                    <span className="text-foreground/60 font-medium">
                      {item.category}
                    </span>
                  </TableCell>
                </TableRow>
                {item.features.map((feature, index) => (
                  <TableRow key={index}>
                    <TableCell>{feature.feature}</TableCell>
                    <TableCell>
                      {feature.Starter === true ? (
                        <Check className="size-6" />
                      ) : typeof feature.Starter === "string" ? (
                        feature.Starter
                      ) : (
                        ""
                      )}
                    </TableCell>
                    <TableCell>
                      {feature.Professional === true ? (
                        <Check className="size-6" />
                      ) : typeof feature.Professional === "string" ? (
                        feature.Professional
                      ) : (
                        ""
                      )}
                    </TableCell>
                    <TableCell>
                      {feature.Enterprise === true ? (
                        <Check className="size-6" />
                      ) : typeof feature.Enterprise === "string" ? (
                        feature.Enterprise
                      ) : (
                        ""
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </React.Fragment>
            ))}
          </TableBody>
        </Table>
      </Container>
    </Section.Root>
  )
}
