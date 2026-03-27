"use client"

import { useEffect } from "react"
import { toast } from "sonner"

export function UpgradeSuccessToast() {
  useEffect(() => {
    toast.success("Subscription activated! Welcome to your new plan.", {
      duration: 5000,
    })
  }, [])

  return null
}
