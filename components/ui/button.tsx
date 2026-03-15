import type { ButtonHTMLAttributes } from "react"
import { cn } from "@/lib/utils"

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost"
  size?: "sm" | "md" | "lg"
}

export function Button({
  className,
  variant = "primary",
  size = "md",
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-lg font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60",
        variant === "primary" &&
          "bg-primary text-primary-foreground shadow-sm hover:bg-deep-indigo hover:shadow-glow-indigo-sm",
        variant === "secondary" &&
          "border border-border bg-secondary text-secondary-foreground hover:bg-secondary/80",
        variant === "ghost" && "bg-transparent text-deep-violet hover:bg-secondary",
        size === "sm" && "h-9 px-4 text-sm",
        size === "md" && "h-11 px-6 text-sm",
        size === "lg" && "h-12 px-7 text-base",
        className
      )}
      {...props}
    />
  )
}
