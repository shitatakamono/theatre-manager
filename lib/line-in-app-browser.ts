export const LINE_EXTERNAL_BROWSER_GUIDANCE =
  "この画面ではGoogleログインを完了できません。右下のメニュー（︙）から「ブラウザで開く」を選び、SafariまたはChromeで続けてください。";

export function isLineInAppBrowser(userAgent: string): boolean {
  return /\bLine\/[\d.]+/i.test(userAgent) || /\bLIFF\b/i.test(userAgent);
}

export function shouldRemoveLineAccountLinkQuery(lineInAppBrowser: boolean): boolean {
  return !lineInAppBrowser;
}

export function shouldUseFirebaseRedirectFallback(input: {
  errorCode: string;
  allowRedirectFallback: boolean;
}): boolean {
  return input.allowRedirectFallback && [
    "auth/popup-blocked",
    "auth/operation-not-supported-in-this-environment",
    "auth/web-storage-unsupported",
  ].includes(input.errorCode);
}
