import { describe, it, expect } from "vitest"
import { isInAppBrowserUA } from "@/lib/auth/in-app-browser"

// The reason this detector exists: Google refuses OAuth inside embedded
// webviews, and paid Meta traffic arrives through exactly those. A miss in
// either direction has a real cost — a false negative shows a button that can
// only error, a false positive hides Google from a working browser.

const REAL_BROWSERS = {
  "iOS Safari":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  "iOS Chrome":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/125.0.6422.51 Mobile/15E148 Safari/604.1",
  "iOS Firefox":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/126.1 Mobile/15E148 Safari/605.1.15",
  "Android Chrome":
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.6422.53 Mobile Safari/537.36",
  "desktop Chrome":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "desktop Safari":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  "desktop Firefox":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:126.0) Gecko/20100101 Firefox/126.0",
}

const IN_APP_BROWSERS = {
  "Facebook iOS (FBAN)":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21E236 [FBAN/FBIOS;FBAV/460.0.0.36.107;FBBV/577022824;FBDV/iPhone15,2]",
  "Facebook Android (FB_IAB)":
    "Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.114 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/463.1.0.55.85;]",
  "Instagram iOS":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 334.0.4.32.98 (iPhone15,3; iOS 17_5; en_US; en; scale=3.00; 1290x2796; 591247486)",
  "Instagram Android":
    "Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A.230901.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.114 Mobile Safari/537.36 Instagram 334.0.0.42.95 Android",
  "generic Android WebView":
    "Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A.230901.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.114 Mobile Safari/537.36",
  "iOS webview (no Safari token, e.g. Gmail)":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  "TikTok Android":
    "Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A.230901.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.0.0 Mobile Safari/537.36 musical_ly_2022803040 JsSdk/1.0 NetType/WIFI Channel/googleplay",
  "LINE iOS":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1 Line/14.8.0",
}

describe("isInAppBrowserUA", () => {
  for (const [name, ua] of Object.entries(REAL_BROWSERS)) {
    it(`lets ${name} through`, () => {
      expect(isInAppBrowserUA(ua)).toBe(false)
    })
  }

  for (const [name, ua] of Object.entries(IN_APP_BROWSERS)) {
    it(`detects ${name}`, () => {
      expect(isInAppBrowserUA(ua)).toBe(true)
    })
  }

  it("treats an empty UA as a real browser (fail open: never hide a working button on no evidence)", () => {
    expect(isInAppBrowserUA("")).toBe(false)
  })
})
