/**
 * The shapes the Go desktop service sends across the bridge.
 *
 * These mirror the DTOs in cmd/cloudslash-desktop/service.go rather than the
 * engine's internal types, so the UI never depends on graph internals and the
 * payload stays small (edge count instead of every edge).
 */

export type ScanStatus = "ready" | "scanning" | "complete" | "cancelled" | "failed";

/** What could be inferred about AWS on this machine, without being asked. */
export interface AwsEnvironment {
  Profiles: string[];
  /** The profile to use when there is no choice to make. */
  Profile: string;
  Region: string;
  /** Human-readable note on where the region came from. */
  Source: string;
  Error: string;
}

export interface Finding {
  ID: string;
  Type: string;
  Region: string;
  Reason: string;
  Owner: string;
  Reachability: string;
  Cost: number;
  Risk: number;
  Ignored: boolean;
  Properties: Record<string, unknown> | null;
}

export interface Snapshot {
  Status: ScanStatus;
  Region: string;
  TotalNodes: number;
  WasteCount: number;
  IgnoredCount: number;
  MonthlyWaste: number;
  Findings: Finding[] | null;
  EdgeCount: number;
  Partial: boolean;
  FailedScopeCount: number;
  Error: string;
  /** RFC3339, empty when unknown. */
  StartedAt: string;
  FinishedAt: string;
}

export interface Artifact {
  Name: string;
  Size: number;
  ModTime: string;
  Kind: ArtifactKind;
}

export type ArtifactKind =
  | "json"
  | "csv"
  | "markdown"
  | "remediation"
  | "dashboard"
  | "report"
  | "other";

/** One artifact the engine can produce. Nothing here is gated: it is all free. */
export interface ExportSpec {
  Kind: ArtifactKind;
  Label: string;
  FileName: string;
  Description: string;
  /** True once the engine can produce it (i.e. a scan has completed). */
  Ready: boolean;
}

export interface Profile {
  /** Stable per-install identifier. Used as the RevenueCat app user id. */
  UserID: string;
  Version: string;
  License: string;
  OutputDir: string;
  DataDir: string;
  Platform: string;
}

/**
 * Whether the optional, server-side entitlement check is available on this
 * machine, and what to set if it is not. The secret key never crosses the
 * bridge, so this carries no key material, not even a prefix.
 */
export interface VerificationStatus {
  Available: boolean;
  Reason: string;
  EnvVar: string;
  EntitlementID: string;
  AppUserID: string;
}

/** RevenueCat's authoritative answer for this customer. */
export interface Verification {
  Checked: boolean;
  Active: boolean;
  Source: string;
  EntitlementID: string;
  ProductID: string;
  ExpiresAt: string;
  ManagementURL: string;
  AppUserID: string;
  CheckedAt: string;
  Error: string;
}

export interface Prefs {
  Region: string;
  Demo: boolean;
  /** Name of the AWS CLI profile to scan with. Empty means the default chain. */
  Profile: string;

  // Scope
  AllProfiles: boolean;
  TFStatePath: string;

  // Analysis
  DisableCWMetrics: boolean;
  MaxConcurrency: number;
  DiscountRate: number;
  StrictMode: boolean;

  // Governance
  RulesFile: string;
  RequiredTags: string;

  // Cost history
  HistoryURL: string;

  // Notifications
  SlackWebhook: string;
  SlackChannel: string;

  // Telemetry
  OtelEndpoint: string;

  // Output
  OutputDir: string;
}

export function defaultPrefs(): Prefs {
  return {
    Region: "us-east-1",
    // A live account is the default. Demo mode is synthetic data, so it is opted
    // into rather than assumed.
    Demo: false,
    Profile: "",
    AllProfiles: false,
    TFStatePath: "",
    DisableCWMetrics: false,
    MaxConcurrency: 20,
    DiscountRate: 0,
    StrictMode: false,
    RulesFile: "",
    RequiredTags: "",
    HistoryURL: "",
    SlackWebhook: "",
    SlackChannel: "",
    OtelEndpoint: "",
    OutputDir: "cloudslash-out",
  };
}

/** Profiles found in the user's AWS configuration. */
export interface AwsProfiles {
  Profiles: string[];
  /** Set when no profiles could be read, with the reason. */
  Error: string;
}

/** The result of checking whether a profile can actually be used. */
export interface AwsIdentity {
  Connected: boolean;
  Account: string;
  Profile: string;
  Region: string;
  Error: string;
}

/** What came back from running one of the generated remediation scripts. */
export interface RemediationResult {
  Ran: boolean;
  Script: string;
  Output: string;
  Error: string;
  ExitCode: number;
  DurationMS: number;
}

export interface ScanResult {
  Status: ScanStatus;
  Error: string;
}

export const emptySnapshot = (): Snapshot => ({
  Status: "ready",
  Region: "",
  TotalNodes: 0,
  WasteCount: 0,
  IgnoredCount: 0,
  MonthlyWaste: 0,
  Findings: [],
  EdgeCount: 0,
  Partial: false,
  FailedScopeCount: 0,
  Error: "",
  StartedAt: "",
  FinishedAt: "",
});
