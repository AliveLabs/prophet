// In-app browser detection for the auth pages. Google refuses to run OAuth
// inside embedded webviews (its disallowed_useragent policy), and paid social
// traffic arrives almost exclusively through them: a Meta ad click opens in the
// Facebook/Instagram in-app browser, never the visitor's real browser. The
// Google button can only error there, so the auth pages swap it for a note
// pointing at the email-code path, which never leaves the page.
//
// Pure function on the UA string so it can be unit-tested; callers read
// navigator.userAgent client-side.

// App-specific tokens first: the Meta family plus the other apps whose in-app
// browsers this audience actually arrives through.
const IN_APP_TOKENS =
  /FBAN|FBAV|FB_IAB|FBIOS|Instagram|Messenger|Snapchat|TikTok|musical_ly|BytedanceWebview|Pinterest|LinkedInApp|Line\/|MicroMessenger/i

// Android WebView stamps "; wv)" into the UA. Any webview is blocked by
// Google's policy, not just the ones named above.
const ANDROID_WEBVIEW = /; wv\)/

export function isInAppBrowserUA(ua: string): boolean {
  if (!ua) return false
  if (IN_APP_TOKENS.test(ua)) return true
  if (ANDROID_WEBVIEW.test(ua)) return true
  // iOS webviews omit the "Safari/" token that every real iOS browser carries
  // (Chrome and Firefox on iOS include it too). An iOS UA without it is an
  // embedded webview: Gmail, Meta apps with the tokens stripped, and the rest.
  if (/iPhone|iPod|iPad/.test(ua) && !/Safari\//.test(ua)) return true
  return false
}
