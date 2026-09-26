/**
 * RevenueCat configuration.
 *
 * Two rules govern this file, and both of them are about what must NOT be here.
 *
 *   1. No secret key. RevenueCat issues publishable keys (project keys and Web
 *      Billing `rcb_` keys) and secret keys (`sk_`). Only a publishable key may
 *      exist in a client, because a client can be read by anyone who has it. A
 *      secret key grants full control of the RevenueCat project: every customer,
 *      every transaction, every refund.
 *
 *   2. Nothing payment-shaped lives in this application. There is no card form,
 *      no Stripe call, and no receipt handling. The SDK hands off to RevenueCat's
 *      hosted checkout, which owns all of that.
 *
 * The key arrives from the environment at build time, so a fork or a CI job can
 * point at a different RevenueCat project without editing source. Everything
 * below is either non-secret or derived from the key itself.
 *
 *   VITE_REVENUECAT_WEB_API_KEY      rcb_…   required to enable billing
 *   VITE_REVENUECAT_ENTITLEMENT_ID   default cloudslash_pro
 *   VITE_REVENUECAT_OFFERING_ID      optional, defaults to the current offering
 *   VITE_REVENUECAT_CURRENCY         optional ISO 4217, defaults to the buyer's
 *
 * See .env.example for the copy-paste version.
 */

import { LINKS } from "../lib/links";

/** Prefixes the SDK in the client refuses outright. */
export const SECRET_PREFIX = "sk_";

export type Environment = "live" | "sandbox" | "test" | "unknown";

/**
 * The key shapes RevenueCat accepts in a client, and the environment each one
 * implies. Longest prefix first: `rcb_sb_` has to be matched before `rcb_`, or
 * a sandbox key reads as live.
 *
 * `test_` is the Test Store: purchases are simulated end to end, no money moves
 * and no payment processor is involved, so the whole flow can be demonstrated
 * without a live account.
 */
const PUBLISHABLE_PREFIXES: Array<[string, Environment]> = [
  ["rcb_sb_", "sandbox"],
  ["rcb_", "live"],
  ["strp_sb_", "sandbox"],
  ["strp_", "live"],
  ["pdl_sb_", "sandbox"],
  ["pdl_sdbx_", "sandbox"],
  ["pdl_", "live"],
  ["test_", "test"],
  ["pk_", "unknown"],
];

const rawKey = (import.meta.env.VITE_REVENUECAT_WEB_API_KEY ?? "").trim();
const rawEntitlement = (import.meta.env.VITE_REVENUECAT_ENTITLEMENT_ID ?? "").trim();
const rawOffering = (import.meta.env.VITE_REVENUECAT_OFFERING_ID ?? "").trim();
const rawCurrency = (import.meta.env.VITE_REVENUECAT_CURRENCY ?? "").trim();

/* ---------------------------------------------------------------------------
 * Fill these in once, then rebuild.
 *
 * Every value below has an environment variable equivalent (listed in
 * .env.example) which wins over the constant, so a CI build can override any of
 * them without editing source. For a single build, editing here is enough.
 * ------------------------------------------------------------------------ */

/**
 * The Web Billing publishable key.
 *
 * A publishable key is readable by anyone who has the app, so it is safe in a
 * repository: it is inside every binary either way. A secret key (sk_...) is
 * refused outright, see judgeKey below.
 *
 * This is the fallback, so a build with no environment file is still configured.
 * VITE_REVENUECAT_WEB_API_KEY wins over it when set.
 */
const COMMITTED_KEY = "pdl_fFXerNBtFvhbRgQcaBQiGHWonBVy";

/**
 * The entitlement that counts as a supporter. Must match the identifier set on
 * the entitlement in the RevenueCat dashboard.
 */
const COMMITTED_ENTITLEMENT_ID = "cloudslash_pro";

/** Pin the app to one offering. Empty uses whichever offering is current. */
const COMMITTED_OFFERING_ID = "devilabs";

/**
 * A hosted checkout, used when the SDK cannot take the payment: no key, or a
 * webview that will not run the checkout. A RevenueCat Web Purchase Link or a
 * Stripe Payment Link both work, and this path needs no key at all.
 */
const COMMITTED_SUPPORT_URL = "";

/**
 * Donation pages offered alongside the plans — Patreon, Open Collective and the
 * like. The way to accept support with no payment gateway involved. Every host
 * here has to be on the allowlist in lib/links.ts and in the Go service.
 */
const COMMITTED_DONATION_LINKS: Array<{ label: string; url: string }> = [
  { label: "Patreon", url: "https://patreon.com/DrSkyle" },
  { label: "Open Collective", url: "https://opencollective.com/wearedevilabs" },
];

/* ------------------------------------------------------------------------ */

const rawSupport = (import.meta.env.VITE_SUPPORT_URL ?? "").trim();
const SUPPORT_URL = rawSupport || COMMITTED_SUPPORT_URL || LINKS.support;

export interface RevenueCatConfig {
  webApiKey: string;
  entitlementId: string;
  offeringId: string | null;
  currency: string | null;
  /** Shown in the paywall and used for the trial line. */
  trialDays: number;
  /** Hosted checkout, used when the SDK cannot take the payment. */
  supportUrl: string;
  /** Donation pages, offered alongside the plans. Empty hides them. */
  donationLinks: Array<{ label: string; url: string }>;
  urls: { manage: string; terms: string; privacy: string };
}

export const REVENUECAT: RevenueCatConfig = {
  webApiKey: rawKey || COMMITTED_KEY,
  entitlementId: rawEntitlement || COMMITTED_ENTITLEMENT_ID || "cloudslash_pro",
  offeringId: rawOffering || COMMITTED_OFFERING_ID || null,
  currency: rawCurrency || null,
  trialDays: 7,
  supportUrl: SUPPORT_URL,
  donationLinks: COMMITTED_DONATION_LINKS,
  urls: {
    manage: LINKS.account,
    terms: LINKS.terms,
    privacy: LINKS.privacy,
  },
};

export type KeyVerdict =
  | { ok: true; environment: Environment }
  | { ok: false; reason: "missing" | "secret" | "unrecognised" };

/**
 * Judge the configured key before it is ever handed to the SDK.
 *
 * The middle case is the important one: if someone pastes a secret key into the
 * build environment, the app has to refuse it and say why, rather than shipping a
 * key that can drain their RevenueCat project. Everything else that carries a
 * recognisable prefix is a publishable key and is safe in a client.
 */
export function judgeKey(key: string = REVENUECAT.webApiKey): KeyVerdict {
  const value = key.trim();
  if (!value) return { ok: false, reason: "missing" };
  if (value.startsWith(SECRET_PREFIX)) return { ok: false, reason: "secret" };

  for (const [prefix, environment] of PUBLISHABLE_PREFIXES) {
    if (value.startsWith(prefix)) return { ok: true, environment };
  }
  return { ok: false, reason: "unrecognised" };
}

/** The environment the built-in key points at, for the interface to display. */
export function environment(): Environment {
  const verdict = judgeKey();
  return verdict.ok ? verdict.environment : "unknown";
}

export function billingConfigured(): boolean {
  return judgeKey().ok;
}
