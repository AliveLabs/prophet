"use server"

import {
  sendMagicLinkAction as sendMagicLinkFromLogin,
  signInWithGoogleAction as signInWithGoogleFromLogin,
} from "../login/actions"

export async function sendMagicLinkAction(formData: FormData) {
  return sendMagicLinkFromLogin(formData)
}

export async function signInWithGoogleAction() {
  return signInWithGoogleFromLogin()
}
