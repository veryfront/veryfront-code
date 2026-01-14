import { Container } from "@/shared/ui/Container"
import { Button } from "@/shared/ui/Button"
import { ButtonGroup } from "@/shared/ui/ButtonGroup"
import * as Card from "@/shared/ui/Card"
import { useRouter } from "@/lib/Router"
import * as Tabs from "https://esm.sh/@radix-ui/react-tabs@1.0.3?external=react,react-dom"
import * as Section from "@/shared/ui/Section"
import { ShowcaseCard } from "@/features/showcase/ui/ShowcaseCard"

const showcaseItems = [
  {
    name: "Pokemon Memory Game",
    slug: "reserved-harrison-zfjil",
    domain: "https://reserved-harrison-zfjil.veryfront.com/",
    title: "reserved-harrison-zfjil",
  },
  {
    name: "Magic Recipe Generator",
    slug: "sleepy-volhard-mxrzy",
    domain: "https://sleepy-volhard-mxrzy.veryfront.com/",
    title: "sleepy-volhard-mxrzy",
  },
  {
    name: "Task Manager",
    slug: "willing-resig-ybnzd",
    domain: "https://willing-resig-ybnzd.veryfront.com/",
    title: "willing-resig-ybnzd",
  },
  {
    name: "TravelPlanner",
    slug: "versatile-noether-mgayz",
    domain: "https://versatile-noether-mgayz.veryfront.com/",
    title: "versatile-noether-mgayz",
  },
  {
    name: "Stuttgart.gg",
    slug: "impartial-chandrasekhar-qsohb",
    domain: "https://impartial-chandrasekhar-qsohb.veryfront.com/",
    title: "impartial-chandrasekhar-qsohb",
  },
  {
    name: "PaintMatcher",
    slug: "adventurous-murdock-twloe",
    domain: "https://adventurous-murdock-twloe.veryfront.com/",
    title: "adventurous-murdock-twloe",
  },
  {
    name: "Biesdorf Smasher",
    slug: "compassionate-wilson-lxrrl",
    domain: "https://compassionate-wilson-lxrrl.veryfront.com/",
    title: "compassionate-wilson-lxrrl",
  },
  {
    name: "PitchPerfect",
    slug: "humorous-dijkstra-czxzt",
    domain: "https://humorous-dijkstra-czxzt.veryfront.com/",
    title: "humorous-dijkstra-czxzt",
  },
  {
    name: "PawTrails",
    slug: "determined-noyce-naamq",
    domain: "https://determined-noyce-naamq.veryfront.com/",
    title: "determined-noyce-naamq",
  },
  {
    name: "PitchPerfect",
    slug: "persistent-golick-qsavy",
    domain: "https://persistent-golick-qsavy.veryfront.com/",
    title: "persistent-golick-qsavy",
  },
]

const categories = [{ id: "all", name: "All", items: showcaseItems }]

export function Showcase() {
  return (
    <Section.Root className="py-10 sm:py-14 md:py-16 lg:py-20 xl:py-24">
      <Container>
        <Tabs.Root defaultValue={categories.at(0).id}>
          <div className="flex flex-col xs:flex-row gap-2.5 justify-between mb-6">
            <div>
              <h3 className="text-balance font-medium xl:text-lg max-w-xl">
                From the community
              </h3>
              <p className="max-md:text-sm text-card-foreground/50 mt-0.5">
                See what others have been building
              </p>
            </div>

            {categories.length > 1 && (
              <Tabs.List className="text-sm font-medium flex items-center flex-nowrap scrollbar-hide overflow-x-scroll gap-2.5 space-y-0">
                {categories?.map((category) => (
                  <Tabs.Trigger
                    key={category.id}
                    value={category.id}
                    className="py-1.5 px-3 rounded-md block hover:text-primary focus-visible:text-primary data-[state=active]:bg-muted outline-none"
                  >
                    {category.name}
                  </Tabs.Trigger>
                ))}
              </Tabs.List>
            )}
          </div>

          {categories?.map((category) => (
            <Tabs.Content
              key={category.id}
              value={category.id}
              className="w-full"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
                {category.items
                  .filter((t) => !t.isDisabled)
                  .map((template) => (
                    <ShowcaseCard
                      key={template.slug}
                      href={`https://new.veryfront.com?template=${template.slug}&prompt=forked`}
                      title={template.name}
                      subtitle={template.slug}
                      iframeSrc={template.domain}
                      fullscreen={template.fullscreen}
                    />
                  ))}
              </div>
            </Tabs.Content>
          ))}
        </Tabs.Root>
      </Container>
    </Section.Root>
  )
}
