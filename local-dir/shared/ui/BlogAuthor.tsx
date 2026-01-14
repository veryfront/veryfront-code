import * as Person from "@/shared/ui/Person"
import { ResponsiveImage } from "@/shared/ui/ResponsiveImage"

export function BlogAuthor(props) {
  return (
    <Person.Root className="not-prose -my-2">
      <Person.Avatar className="w-[38px]">
        <ResponsiveImage
          src={props.imageSrc}
          alt={props.name}
          width={38}
          height={38}
          fill={true}
          sizes="38px"
        />
      </Person.Avatar>

      <Person.Info>
        <Person.Title>{props.name}</Person.Title>

        <Person.Subtitle className="text-foreground/50">
          {props.byline}
        </Person.Subtitle>
      </Person.Info>
    </Person.Root>
  )
}
