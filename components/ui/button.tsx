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
        "inline-flex items-center justify-center rounded-full font-semibold transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vatic-indigo/40 disabled:cursor-not-allowed disabled:opacity-60",
        variant === "primary" &&
          "bg-vatic-indigo text-white shadow-sm hover:-translate-y-0.5 hover:bg-deep-indigo",
        variant === "secondary" &&
          "border border-[#E8E4FF] bg-white text-near-black hover:-translate-y-0.5 hover:border-vatic-indigo/30 hover:bg-pale-lavender",
        variant === "ghost" && "text-deep-violet hover:text-vatic-indigo",
        size === "sm" && "h-9 px-4 text-sm",
        size === "md" && "h-11 px-6 text-sm",
        size === "lg" && "h-12 px-7 text-base",
        className
      )}
      {...props}
    />
  )
}
