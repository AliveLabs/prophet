"use client"

// The email half of both auth pages: ask for an address, then verify the
// one-time code from the email on the SAME screen. The visitor never has to
// leave the page, which is the point — paid social traffic lives in the
// Facebook/Instagram in-app browser, where a "go open your inbox" round trip
// loses most people (the emailed link still works for everyone else).
//
// Two useActionState hooks drive the steps. The request actions return state
// (never redirect) so the form can advance to code entry in place; the verify
// action redirects on success, which is safe because it runs as a form action,
// not awaited inside a transition (the NEXT_REDIRECT gotcha).

import { useActionState, useState } from "react"
import {
  requestSignInCodeAction,
  requestSignupCodeAction,
  verifyEmailCodeAction,
  type EmailAuthState,
} from "./login/actions"
import { AuthMailIcon, AuthErrorIcon, AuthOkIcon } from "./login/auth-icons"

const INITIAL_STATE: EmailAuthState = { step: "email" }

function EmailCodeSteps({
  mode,
  initialError,
  onReset,
}: {
  mode: "signin" | "signup"
  initialError?: string
  onReset: () => void
}) {
  const requestCodeAction =
    mode === "signup" ? requestSignupCodeAction : requestSignInCodeAction
  const [requestState, requestAction, requestPending] = useActionState(
    requestCodeAction,
    INITIAL_STATE
  )
  const [verifyState, verifyAction, verifyPending] = useActionState(
    verifyEmailCodeAction,
    INITIAL_STATE
  )
  // Counts "Send a new code" submissions so the confirmation only shows after a
  // deliberate resend, not on first arrival at the code step.
  const [resends, setResends] = useState(0)

  // A failed verify can demote to step "email" (lost hidden field); treat that
  // as a reset too. Reference equality against the initial object matters:
  // before the first verify runs, verifyState IS the initial {step: "email"}
  // and must not read as a demotion.
  const demoted = verifyState.step === "email" && verifyState !== INITIAL_STATE
  const atCodeStep = requestState.step === "code" && !demoted
  const email = requestState.step === "code" ? requestState.email : ""

  // One message slot, most recent problem first. The URL error (a failed
  // Google/OAuth or callback round trip) only matters before any interaction.
  const error =
    verifyState.error ??
    requestState.error ??
    (requestState.step === "email" ? initialError : undefined)

  if (!atCodeStep) {
    return (
      <>
        {error ? (
          <p className="auth-msg auth-msg--error" role="alert">
            <AuthErrorIcon />
            <span>{error}</span>
          </p>
        ) : null}

        <form action={requestAction} className="auth-form">
          <label className="auth-label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            className="auth-input"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="you@restaurant.com"
          />
          <button type="submit" className="auth-submit" disabled={requestPending}>
            <AuthMailIcon />
            {requestPending ? "Sending your code..." : "Email me a code"}
          </button>
        </form>
      </>
    )
  }

  return (
    <>
      {error ? (
        <p className="auth-msg auth-msg--error" role="alert">
          <AuthErrorIcon />
          <span>{error}</span>
        </p>
      ) : (
        <p className="auth-msg auth-msg--ok" role="status">
          <AuthOkIcon />
          <span>
            {resends > 0
              ? `New code sent to ${email}. The newest one wins.`
              : `Code sent to ${email}. The email has a sign-in link too, if that's easier.`}
          </span>
        </p>
      )}

      <form action={verifyAction} className="auth-form">
        <input type="hidden" name="email" value={email} />
        <label className="auth-label" htmlFor="code">
          Enter the code
        </label>
        {/* No placeholder or maxLength pinned to a digit count: Supabase owns
            the code length (8 today, a dashboard setting). See lib/auth/email-code. */}
        <input
          id="code"
          className="auth-input auth-input--code"
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={12}
          required
          autoFocus
        />
        <button type="submit" className="auth-submit" disabled={verifyPending}>
          {verifyPending
            ? "Checking..."
            : mode === "signup"
              ? "Create my account"
              : "Sign in"}
        </button>
      </form>

      <div className="auth-code-actions">
        <form
          action={requestAction}
          onSubmit={() => setResends((n) => n + 1)}
        >
          <input type="hidden" name="email" value={email} />
          <button type="submit" className="auth-linkbtn" disabled={requestPending}>
            {requestPending ? "Sending..." : "Send a new code"}
          </button>
        </form>
        <button type="button" className="auth-linkbtn" onClick={onReset}>
          Use a different email
        </button>
      </div>
    </>
  )
}

export function AuthEmailForm({
  mode,
  initialError,
}: {
  mode: "signin" | "signup"
  initialError?: string
}) {
  // useActionState has no reset; remounting with a fresh key is the supported
  // way to start the flow over ("Use a different email").
  const [generation, setGeneration] = useState(0)
  return (
    <EmailCodeSteps
      key={generation}
      mode={mode}
      // The URL error is about the visit, not the retry: don't resurrect it
      // after a manual reset.
      initialError={generation === 0 ? initialError : undefined}
      onReset={() => setGeneration((g) => g + 1)}
    />
  )
}
