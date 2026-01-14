export const AVAILABLE_PLANS = {
  Starter: {
    id: "Starter",
    isDefault: true,
    title: "Starter",
    priceMonthly: 0,
    priceYearly: 0,
    description: "Create and develop unlimited projects.",
    scenario: "Perfect for experimentation and learning.",
    featuresTitle: "",
    features: [
      "Unlimited private apps",
      "Veryfront branding",
      "10 free AI credits *",
      "Component library",
      "Starter templates",
      "Veryfront Figma UI kit",
    ],
  },
  Professional: {
    id: "Professional",
    isDefault: false,
    title: "Professional",
    priceMonthly: 29,
    priceYearly: 20,
    description: "Unlock public-facing features for your projects.",
    scenario: "Everything you need to go live.",
    featuresTitle: "Everything in Free, plus",
    features: [
      "Everything in Free, plus:",
      "5 public apps with custom domains",
      "No Veryfront branding",
      "Code exports",
      "50 AI credits/month *",
      "SSL certificates",
      "Email support",
    ],
  },
  Enterprise: {
    id: "Enterprise",
    isDefault: false,
    title: "Enterprise",
    priceMonthly: "",
    priceYearly: "",
    description:
      "For teams requiring advanced security, controls, and support.",
    featuresTitle: "",
    features: [
      "Everything in Professional, plus:",
      "Unlimited public apps",
      "Custom contracts & SLA",
      "SSO & advanced security",
      "Dedicated support",
      "Priority feature development",
      "Unlimited team members",
    ],
  },
}

export function getDisplayPrice(price) {
  return typeof price === "number" ? `$${price}` : price
}
