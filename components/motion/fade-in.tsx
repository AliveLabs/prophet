"use client"

import { motion } from "framer-motion"
import type { HTMLAttributes } from "react"
import { cn } from "@/lib/utils"

type FadeInProps = HTMLAttributes<HTMLDivElement> & {
  delay?: number
}

export function FadeIn({ className, delay = 0, ...props }: FadeInProps) {
  return (
    <motion.div
      className={cn(className)}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: "easeOut", delay }}
      {...props}
    />
  )
}
