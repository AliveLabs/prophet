import type { HTMLAttributes } from "react"
import { cn } from "@/lib/utils"

export function Separator({ className, ...props }: HTMLAttributes<HTMLHRElement>) {
  return (
    <hr
      className={cn("border-0 border-t border-zinc-200/70", className)}
      {...props}
    />
  )
}
