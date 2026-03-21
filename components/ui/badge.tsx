import type { HTMLAttributes } from "react"
import { cn } from "@/lib/utils"

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  variant?: "default" | "success" | "warning"
}

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold tracking-wide uppercase",
        variant === "default" && "bg-secondary text-secondary-foreground",
        variant === "success" && "bg-precision-teal/15 text-precision-teal",
        variant === "warning" && "bg-signal-gold/15 text-signal-gold",
        className
      )}
      {...props}
    />
  )
}
