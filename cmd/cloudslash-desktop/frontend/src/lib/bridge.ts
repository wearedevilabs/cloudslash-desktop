import { Call } from "@wailsio/runtime";

import { emptySnapshot, type Artifact, type AwsEnvironment, type AwsIdentity, type AwsProfiles, type ExportSpec, type Prefs, type Profile, type RemediationResult, type Snapshot, type Verification, type VerificationStatus } from "./types";
import { mockBackend } from "./mock";

/**
 * The contract the UI depends on. The native implementation talks to the Go
 * service over Wails IPC; the preview implementation serves synthetic data so
 * the interface can be built, reviewed and screenshotted in a plain browser.
 */
export interface Backend {
  readonly mode: "native" | "preview";
  profile(): Promise<Profile>;
  prefs(): Promise<Prefs>;
  savePrefs(prefs: Prefs): Promise<void>;
  snapshot(): Promise<Snapshot>;
  startScan(region: string, demo: boolean): Promise<void>;
  /** Stop a run in progress. */
  cancelScan(): Promise<void>;
  artifacts(): Promise<Artifact[]>;
  exportSpecs(): Promise<ExportSpec[]>;
  exportArtifact(kind: string): Promise<string>;
  ignoreFinding(id: string): Promise<void>;
  openArtifact(name: string): Promise<void>;
  openOutputDir(): Promise<void>;
  /** Native folder picker. An empty string means the operator cancelled. */
  chooseDirectory(title: string, startIn: string): Promise<string>;
  openExternal(url: string): Promise<void>;
  /** Record the last known entitlement so the plan survives going offline. */
  cacheEntitlement(active: boolean, expiresAt: string, source: string): Promise<void>;
  /** Whether the optional server-side check can run, and what to set if not. */
  verificationStatus(): Promise<VerificationStatus>;
  /** Ask RevenueCat directly, using the secret key from the environment. */
  verifyEntitlement(): Promise<Verification>;
  /** Profiles available in the local AWS configuration. */
  awsProfiles(): Promise<AwsProfiles>;
  /** Profiles plus the region and profile that would be used by default. */
  detectAws(): Promise<AwsEnvironment>;
  /** Confirm a profile works, by asking STS who it is. */
  verifyAws(profile: string, region: string): Promise<AwsIdentity>;
  /** Run a generated remediation script, capturing what it printed. */
  runRemediation(script: string): Promise<RemediationResult>;
}

/**
 * Wails addresses a bound method as "<package path>.<Type>.<Method>", built from
 * reflection in pkg/application/bindings.go — and for a main package the
 * package path is literally "main", not the module path. The app logs the prefix
 * it actually registered ("cloudslash: services bound as main.Desktop.<Method>")
 * so a drift between this constant and reality is a one-glance fix in the log
 * rather than a mystery.
 *
 * If it is ever wrong, the native calls reject and the interface falls back to
 * preview data, which it then announces loudly instead of hiding.
 */
const SERVICE = "main.Desktop";

const nativeBackend: Backend = {
  mode: "native",
  profile: () => Call.ByName(`${SERVICE}.Profile`) as Promise<Profile>,
  prefs: () => Call.ByName(`${SERVICE}.Prefs`) as Promise<Prefs>,
  savePrefs: (prefs) => Call.ByName(`${SERVICE}.SavePrefs`, prefs),
  snapshot: () => Call.ByName(`${SERVICE}.Snapshot`) as Promise<Snapshot>,
  startScan: (region, demo) => Call.ByName(`${SERVICE}.StartScan`, region, demo),
  cancelScan: () => Call.ByName(`${SERVICE}.CancelScan`),
  artifacts: () => Call.ByName(`${SERVICE}.Artifacts`) as Promise<Artifact[]>,
  exportSpecs: () => Call.ByName(`${SERVICE}.ExportSpecs`) as Promise<ExportSpec[]>,
  exportArtifact: (kind) => Call.ByName(`${SERVICE}.Export`, kind) as Promise<string>,
  ignoreFinding: (id) => Call.ByName(`${SERVICE}.Ignore`, id),
  openArtifact: (name) => Call.ByName(`${SERVICE}.OpenArtifact`, name),
  openOutputDir: () => Call.ByName(`${SERVICE}.OpenOutputDir`),
  chooseDirectory: (title, startIn) => Call.ByName(`${SERVICE}.ChooseDirectory`, title, startIn) as Promise<string>,
  openExternal: (url) => Call.ByName(`${SERVICE}.OpenExternal`, url),
  cacheEntitlement: (active, expiresAt, source) =>
    Call.ByName(`${SERVICE}.CacheEntitlement`, active, expiresAt, source),
  verificationStatus: () => Call.ByName(`${SERVICE}.VerificationStatus`) as Promise<VerificationStatus>,
  verifyEntitlement: () => Call.ByName(`${SERVICE}.VerifyEntitlement`) as Promise<Verification>,
  awsProfiles: () => Call.ByName(`${SERVICE}.AwsProfiles`) as Promise<AwsProfiles>,
  detectAws: () => Call.ByName(`${SERVICE}.DetectAws`) as Promise<AwsEnvironment>,
  verifyAws: (profile, region) => Call.ByName(`${SERVICE}.VerifyAws`, profile, region) as Promise<AwsIdentity>,
  runRemediation: (script) => Call.ByName(`${SERVICE}.RunRemediation`, script) as Promise<RemediationResult>,
};

let backend: Backend | null = null;

/**
 * Decide which backend to use by asking the native one a cheap question. If the
 * Go service is not there (a browser preview), fall back to synthetic data
 * rather than rendering an empty shell.
 */
export async function initBackend(): Promise<Backend> {
  if (backend) return backend;

  // An explicit opt-in wins, for reviewing the interface without a build.
  const forcedPreview = new URLSearchParams(window.location.search).get("preview") === "1";
  if (forcedPreview) {
    backend = mockBackend;
    return backend;
  }

  try {
    const profile = await nativeBackend.profile();
    if (!profile || typeof profile.UserID !== "string") throw new Error("bad profile");
    backend = nativeBackend;
  } catch {
    backend = mockBackend;
  }
  return backend;
}

export function api(): Backend {
  if (!backend) throw new Error("backend not initialised");
  return backend;
}

export { emptySnapshot };
