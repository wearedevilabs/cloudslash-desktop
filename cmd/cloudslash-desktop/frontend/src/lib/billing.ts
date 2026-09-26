import { Purchases, type CustomerInfo, type Package } from "@revenuecat/purchases-js";

import { REVENUECAT, judgeKey, environment as keyEnvironment, type Environment, type KeyVerdict } from "../config/revenuecat";

/**
 * Plan and entitlement state, resolved by the RevenueCat web SDK.
 *
 * All money logic lives here: a publishable key, and a checkout hosted by
 * RevenueCat. The app never holds a secret, never sees a card number, and never
 * writes a receipt.
 */

export interface PlanPackage {
  id: string;
  title: string;
  price: string;
  description: string;
  /** "per month", "per year", "once" — read from the product title where possible. */
  period: string;
  webCheckoutURL: string | null;
}

export type KeyProblem = "missing" | "secret" | "unrecognised" | "";

export interface PlanState {
  /** A usable publishable key is present. */
  configured: boolean;
  /** Why billing is unavailable, when it is. */
  keyProblem: KeyProblem;
  loading: boolean;
  checking: boolean;
  purchasing: boolean;
  purchasingId: string | null;
  error: string;
  pro: boolean;
  /** Running against a sandbox key. Surfaced in the interface, loudly. */
  sandbox: boolean;
  /**
   * Which environment the compiled-in key points at, read from its prefix rather
   * than trusted from the network, so the interface can say so immediately.
   */
  environment: Environment;
  appUserId: string;
  entitlementId: string;
  expiresAt: string | null;
  willRenew: boolean;
  billingIssue: boolean;
  /** RevenueCat's own customer portal, once it reports one. */
  managementURL: string | null;
  checkoutURL: string | null;
  packages: PlanPackage[];
  checkedAt: string | null;
}

export function initialPlan(): PlanState {
  const verdict = judgeKey();
  return {
    configured: verdict.ok,
    keyProblem: verdict.ok ? "" : (verdict.reason as KeyProblem),
    loading: false,
    checking: false,
    purchasing: false,
    purchasingId: null,
    error: "",
    pro: false,
    sandbox: verdict.ok && verdict.environment !== "live",
    environment: verdict.ok ? verdict.environment : "unknown",
    appUserId: "",
    entitlementId: REVENUECAT.entitlementId,
    expiresAt: null,
    willRenew: false,
    billingIssue: false,
    managementURL: null,
    checkoutURL: null,
    packages: [],
    checkedAt: null,
  };
}

let client: Purchases | null = null;
let cached: PlanState = initialPlan();

export function currentPlan(): PlanState {
  return cached;
}

function commit(next: Partial<PlanState>): PlanState {
  cached = { ...cached, ...next };
  return cached;
}

function verdictOrProblem(): KeyVerdict {
  return judgeKey();
}

/** A message that says what to do, not just what went wrong. */
export function keyProblemMessage(problem: KeyProblem): string {
  switch (problem) {
    case "missing":
      return "Support is not set up in this build, so there is nothing to offer here. Everything else in the app works.";
    case "secret":
      return "A RevenueCat secret key was supplied. It has been refused: a secret key controls the whole project and must never ship inside an application. Use the rcb_ Web Billing publishable key instead.";
    case "unrecognised":
      return "The configured RevenueCat key is not a recognised Web Billing publishable key (expected an rcb_ prefix).";
    default:
      return "";
  }
}

/* --------------------------------------------------------------- reading */

function readManagementURL(info: CustomerInfo): string | null {
  const raw = info as unknown as Record<string, unknown>;
  for (const key of ["managementURL", "managementUrl"]) {
    const value = raw[key];
    if (typeof value === "string" && value.startsWith("https://")) return value;
  }
  return null;
}

function readExpiry(info: CustomerInfo, entitlementId: string): Date | null {
  const entitlement = info.entitlements?.all?.[entitlementId] as unknown as Record<string, unknown> | undefined;
  const value = entitlement?.["expirationDate"];
  if (value instanceof Date) return value;
  if (typeof value === "string" && value) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function describePeriod(pkg: Package): string {
  const product = pkg.webBillingProduct ?? pkg.rcBillingProduct;
  const title = `${product?.title ?? ""} ${product?.identifier ?? ""} ${pkg.identifier ?? ""}`.toLowerCase();
  if (title.includes("lifetime")) return "once";
  if (title.includes("year") || title.includes("annual")) return "per year";
  if (title.includes("month")) return "per month";
  if (title.includes("week")) return "per week";
  return "";
}

function toPackages(packages: Package[] | undefined): PlanPackage[] {
  if (!packages?.length) return [];
  return packages.map((pkg) => {
    const product = pkg.webBillingProduct ?? pkg.rcBillingProduct;
    return {
      id: pkg.identifier,
      title: product?.title || product?.displayName || pkg.identifier,
      price: product?.price?.formattedPrice ?? "",
      description: product?.description ?? "",
      period: describePeriod(pkg),
      webCheckoutURL: (pkg as unknown as { webCheckoutURL?: string | null }).webCheckoutURL ?? null,
    };
  });
}

function fromCustomer(
  info: CustomerInfo,
  extras: { appUserId: string; packages: PlanPackage[]; checkoutURL: string | null; sandbox: boolean },
): PlanState {
  const entitlement = info.entitlements?.all?.[REVENUECAT.entitlementId];
  const active = Boolean(info.entitlements?.active?.[REVENUECAT.entitlementId]) || Boolean(entitlement?.isActive);

  return commit({
    configured: true,
    keyProblem: "",
    loading: false,
    checking: false,
    purchasing: false,
    purchasingId: null,
    error: "",
    pro: active,
    sandbox: extras.sandbox || Boolean(entitlement?.isSandbox),
    environment: keyEnvironment(),
    appUserId: extras.appUserId,
    entitlementId: REVENUECAT.entitlementId,
    expiresAt: readExpiry(info, REVENUECAT.entitlementId)?.toISOString() ?? null,
    willRenew: Boolean(entitlement?.willRenew),
    billingIssue: Boolean(entitlement?.billingIssueDetectedAt),
    managementURL: readManagementURL(info),
    checkoutURL: extras.checkoutURL,
    packages: extras.packages,
    checkedAt: new Date().toISOString(),
  });
}

/* --------------------------------------------------------------- actions */

function describeError(err: unknown): string {
  const code = (err as { errorCode?: number })?.errorCode;
  const message = (err as { message?: string })?.message;

  switch (code) {
    case 10: // NetworkError
      return "RevenueCat could not be reached. Your last known plan is still shown.";
    case 14: // InvalidAppUserIdError
      return "RevenueCat rejected this install's profile identifier.";
    case 23: // ConfigurationError
      return "RevenueCat rejected this build's publishable key. Check that it is the rcb_ Web Billing key for the right project.";
    case 7901: // BackendGatewaySetupErrorSandboxModeOnly
      return "RevenueCat is in sandbox mode but the project is not fully set up for it. Complete the sandbox configuration in the RevenueCat dashboard.";
    default:
      return message || "RevenueCat returned an error.";
  }
}

/**
 * Configure the SDK and read the current entitlement.
 *
 * Safe to call repeatedly: the SDK permits one configuration per page, so later
 * calls just re-read.
 */
export async function initPlan(appUserId: string): Promise<PlanState> {
  const verdict = verdictOrProblem();
  if (!verdict.ok) {
    return commit({ ...initialPlan(), appUserId, loading: false });
  }
  if (!appUserId) {
    return commit({ ...initialPlan(), configured: true, error: "No profile identifier is available yet." });
  }

  commit({ loading: true, appUserId });

  try {
    if (!Purchases.isConfigured()) {
      client = Purchases.configure({
        apiKey: REVENUECAT.webApiKey,
        appUserId,
        flags: {
          autoCollectUTMAsMetadata: true,
          collectAnalyticsEvents: true,
          hideBackButton: false,
        },
      });
    }
    if (!client) {
      return commit({ loading: false, error: "The billing client could not start." });
    }

    const offerings = await client.getOfferings({
      ...(REVENUECAT.currency ? { currency: REVENUECAT.currency } : {}),
      ...(REVENUECAT.offeringId ? { offeringIdentifier: REVENUECAT.offeringId } : {}),
    });
    const info = await client.getCustomerInfo();
    const current = offerings?.current ?? null;

    return fromCustomer(info, {
      appUserId: client.getAppUserId(),
      packages: toPackages(current?.availablePackages),
      checkoutURL: current?.webCheckoutURL ?? null,
      sandbox: client.isSandbox(),
    });
  } catch (err) {
    return commit({ loading: false, error: describeError(err) });
  }
}

export interface PurchaseOutcome {
  kind: "purchased" | "cancelled" | "pending" | "handoff" | "failed";
  message?: string;
  checkoutURL?: string;
}

/** Start a purchase. RevenueCat owns the checkout; we only react to the result. */
export async function purchasePlan(packageId: string): Promise<PurchaseOutcome> {
  if (!client) {
    return { kind: "failed", message: "The billing client is not available. Reopen the window and try again." };
  }

  commit({ purchasing: true, purchasingId: packageId, error: "" });

  // Held outside the try so the webview fallback can still reach it.
  let checkoutURL: string | null = null;

  try {
    const offerings = await client.getOfferings({
      ...(REVENUECAT.offeringId ? { offeringIdentifier: REVENUECAT.offeringId } : {}),
    });
    const pkg = offerings?.current?.availablePackages?.find((candidate) => candidate.identifier === packageId);
    if (!pkg) {
      commit({ purchasing: false, purchasingId: null });
      return { kind: "failed", message: "That plan is no longer offered. Refresh to see current plans." };
    }

    checkoutURL = (pkg as unknown as { webCheckoutURL?: string | null }).webCheckoutURL ?? cached.checkoutURL;

    const result = await client.purchase({ rcPackage: pkg });
    fromCustomer(result.customerInfo, {
      appUserId: client.getAppUserId(),
      packages: cached.packages,
      checkoutURL: cached.checkoutURL,
      sandbox: client.isSandbox(),
    });
    return { kind: "purchased" };
  } catch (err) {
    commit({ purchasing: false, purchasingId: null });
    const code = (err as { errorCode?: number })?.errorCode;

    // Backing out of a checkout is a decision, not a failure.
    if (code === 1) return { kind: "cancelled" };
    if (code === 20) return { kind: "pending", message: "Payment is pending. Access unlocks when it clears." };

    // Some embedded webviews cannot host the checkout. Fall back to the hosted
    // page in the system browser; the entitlement is re-read on return.
    if ((code === 24 || code === 23) && checkoutURL) {
      return { kind: "handoff", checkoutURL };
    }

    const message = describeError(err);
    commit({ error: message });
    return { kind: "failed", message };
  }
}

/**
 * Re-read the entitlement. There is no separate "restore" call on the web SDK:
 * reading customer info against the same app user id *is* the restore path, since
 * RevenueCat already holds the purchase against that identity.
 */
export async function recheckPlan(): Promise<PlanState> {
  if (!client) {
    return commit({ error: cached.error || "The billing client is not available." });
  }
  commit({ checking: true });
  try {
    const info = await client.getCustomerInfo();
    return fromCustomer(info, {
      appUserId: client.getAppUserId(),
      packages: cached.packages,
      checkoutURL: cached.checkoutURL,
      sandbox: client.isSandbox(),
    });
  } catch (err) {
    return commit({ checking: false, error: describeError(err) });
  }
}

/** Open RevenueCat's hosted customer portal, where a plan is changed or cancelled. */
export function managementTarget(): string | null {
  return cached.managementURL ?? (cached.pro ? REVENUECAT.urls.manage : null);
}

export function sandboxActive(): boolean {
  return cached.sandbox;
}

/** What to call the current environment in the interface. */
export function environmentLabel(env: Environment): string {
  switch (env) {
    case "test":
      return "test store";
    case "sandbox":
      return "sandbox";
    case "live":
      return "live";
    default:
      return "key unrecognised";
  }
}
