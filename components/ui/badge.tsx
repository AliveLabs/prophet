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
        variant === "default" && "border-zinc-200 text-zinc-600",
        variant === "success" && "border-emerald-200 text-emerald-700",
        variant === "warning" && "border-amber-200 text-amber-700",
        className
      )}
      {...props}
    />
  )
}
