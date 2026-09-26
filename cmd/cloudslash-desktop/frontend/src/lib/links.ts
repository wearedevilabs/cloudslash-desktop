/**
 * Every outbound URL the product can open, in one place.
 *
 * Rules of the road:
 *  - Nothing navigates the webview. External links are handed to the OS browser
 *    through the Go service, so the app shell can never be replaced by a web page.
 *  - Only hosts on the allowlist below can be opened. A finding's properties are
 *    attacker-influenced data; they must never be able to produce a live link.
 *  - Billing is RevenueCat's job. The app never renders a card form, never stores
 *    a key, and never talks to Stripe directly.
 *
 * The paths below are placeholders until cloudslash.dev defines its routes. They
 * are referenced only from this block, so this is the single edit point.
 */

const SITE = "https://cloudslash.dev";

/**
 * cloudslash.dev currently answers with the same page for every path, so a deep
 * link lands on the homepage and reads as broken. Everything points at the root
 * until the site has real routes; this is still the single edit point.
 */
const PAGE = SITE;

export const LINKS = {
  site: `${SITE}/`,
  pricing: PAGE,
  docs: PAGE,
  support: PAGE,
  privacy: PAGE,
  terms: PAGE,
  account: PAGE,
  changelog: PAGE,
  /** Where "report a false positive" goes, pre-filled by the app where possible. */
  feedback: PAGE,
} as const;

/** Hosts the app is willing to hand to the operating system. */
const ALLOWED_HOSTS = [
  "cloudslash.dev",
  "www.cloudslash.dev",
  "revenuecat.com",
  "www.revenuecat.com",
  "api.revenuecat.com",
  "pay.revenuecat.com",
  "app.revenuecat.com",
];

export function isAllowedExternal(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  return ALLOWED_HOSTS.some(
    (host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`),
  );
}

/**
 * RevenueCat returns a hosted management URL for the customer. It is not always
 * on a revenuecat.com host (RevenueCat can front a custom domain), so it gets a
 * narrow exception: it must be https and it must have come from RevenueCat's own
 * customer info response, never from a user-editable field.
 */
export function isTrustedManagementURL(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}
