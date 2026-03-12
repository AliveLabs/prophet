import type { HTMLAttributes } from "react"
import { cn } from "@/lib/utils"

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  variant?: "default" | "success" | "warning"
}

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold",
        variant === "default" && "border-[#E8E4FF] bg-pale-lavender/50 text-deep-violet",
        variant === "success" && "border-precision-teal/30 bg-precision-teal-light text-precision-teal",
        variant === "warning" && "border-signal-gold/30 bg-signal-gold-light text-signal-gold",
        className
      )}
      {...props}
    />
  )
}
