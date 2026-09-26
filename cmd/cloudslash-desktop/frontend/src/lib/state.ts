import { api, initBackend, type Backend } from "./bridge";
import { SEVERITY_FLOOR, friendlyType, severity, type Severity } from "./format";
import { initialPlan, initPlan, type PlanState } from "./billing";
import { emptySnapshot, defaultPrefs, type Artifact, type AwsEnvironment, type AwsIdentity, type ExportSpec, type Finding, type Prefs, type Profile, type RemediationResult, type Snapshot, type Verification, type VerificationStatus } from "./types";

export type ScreenID = "statement" | "register" | "topology" | "artifacts" | "account" | "settings";

/** The paywall is modal state, kept here so it re-renders through one path. */
export interface PaywallState {
  open: boolean;
  reason: string;
  selected: string | null;
}

export interface Filters {
  query: string;
  severity: "all" | "critical" | "high" | "medium";
  sort: "cost" | "risk" | "name";
  /**
   * Suppressed findings leave the totals, so they leave the register by default
   * too. "suppressed" is the dedicated view of them.
   */
  suppressed: "active" | "suppressed" | "all";
}

export interface Toast {
  kind: "info" | "success" | "error";
  title: string;
  body: string;
  /** Optional outbound link shown as a secondary action. */
  link?: { label: string; url: string };
}

export interface AppState {
  ready: boolean;
  mode: "native" | "preview";
  screen: ScreenID;
  profile: Profile | null;
  prefs: Prefs;
  snapshot: Snapshot;
  artifacts: Artifact[];
  exports: ExportSpec[];
  filters: Filters;
  selectedId: string | null;
  scanning: boolean;
  exporting: string | null;
  toast: Toast | null;
  plan: PlanState;
  paywall: PaywallState;
  /** Availability of the optional server-side check. Carries no key material. */
  verificationStatus: VerificationStatus | null;
  /** The last authoritative answer, when one has been asked for. */
  verification: Verification | null;
  verifying: boolean;
  /** AWS profiles found on this machine, and why not when there are none. */
  awsProfiles: string[];
  awsProfilesError: string;
  /** What could be inferred about AWS here, without being asked. */
  awsDetected: AwsEnvironment | null;
  /** The last confirmed AWS identity. */
  awsIdentity: AwsIdentity | null;
  verifyingAws: boolean;
  /** Which generated script is waiting on a confirmation, if any. */
  remediation: RemediationState;
  /** What the last script printed. */
  remediationResult: RemediationResult | null;
}

export interface RemediationState {
  script: string;
  stage: "idle" | "confirm" | "running";
}

const initial: AppState = {
  ready: false,
  mode: "preview",
  screen: "statement",
  profile: null,
  prefs: defaultPrefs(),
  snapshot: emptySnapshot(),
  artifacts: [],
  exports: [],
  filters: { query: "", severity: "all", sort: "cost", suppressed: "active" },
  selectedId: null,
  scanning: false,
  exporting: null,
  toast: null,
  plan: initialPlan(),
  paywall: { open: false, reason: "", selected: null },
  verificationStatus: null,
  verification: null,
  verifying: false,
  awsProfiles: [],
  awsProfilesError: "",
  awsDetected: null,
  awsIdentity: null,
  verifyingAws: false,
  remediation: { script: "", stage: "idle" },
  remediationResult: null,
};

export const state: AppState = { ...initial };

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribe(fn: Listener): void {
  listeners.add(fn);
}

let frame = 0;
/** Coalesce bursts of change into one render per frame. */
export function emit(): void {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    for (const fn of listeners) fn();
  });
}

function set(patch: Partial<AppState>): void {
  Object.assign(state, patch);
  emit();
}

export function toast(kind: Toast["kind"], title: string, body: string, link?: Toast["link"]): void {
  set({ toast: { kind, title, body, link } });
}

export function dismissToast(): void {
  set({ toast: null });
}

export function setScreen(screen: ScreenID): void {
  if (state.screen !== screen) set({ screen });
}

/* ------------------------------------------------------------- paywall */

/** Open the paywall, saying which capability was asked for and why it is gated. */
export function openPaywall(reason: string): void {
  set({ paywall: { open: true, reason, selected: null } });
}

export function closePaywall(): void {
  set({ paywall: { ...state.paywall, open: false } });
}

export function selectPlanPackage(id: string): void {
  set({ paywall: { ...state.paywall, selected: id } });
}

export function setFilter(patch: Partial<Filters>): void {
  set({ filters: { ...state.filters, ...patch } });
}

/**
 * Open the register pre-filtered to what the operator clicked. Called by the
 * charts and by the ranked rows.
 */
export function filterToRegister(query: string): void {
  set({
    filters: { query, severity: "all", sort: "cost", suppressed: "active" },
    selectedId: null,
    screen: "register",
  });
}

/** Open the register showing only the findings that were suppressed. */
export function showSuppressed(): void {
  set({
    filters: { query: "", severity: "all", sort: "cost", suppressed: "suppressed" },
    selectedId: null,
    screen: "register",
  });
}

export function selectFinding(id: string | null): void {
  set({ selectedId: id });
}

/* ------------------------------------------------------------ derived */

export function filteredFindings(): Finding[] {
  const { query, severity: floorKey, sort, suppressed } = state.filters;
  const needle = query.trim().toLowerCase();
  const floor = SEVERITY_FLOOR[floorKey] ?? 0;

  const rows = (state.snapshot.Findings ?? []).filter((f) => {
    if (suppressed === "active" && f.Ignored) return false;
    if (suppressed === "suppressed" && !f.Ignored) return false;
    if (floor > 0 && f.Risk < floor) return false;
    if (!needle) return true;
    return (
      f.ID.toLowerCase().includes(needle) ||
      f.Type.toLowerCase().includes(needle) ||
      friendlyType(f.Type).toLowerCase().includes(needle) ||
      f.Region.toLowerCase().includes(needle) ||
      f.Owner.toLowerCase().includes(needle)
    );
  });

  const sorted = [...rows];
  switch (sort) {
    case "risk":
      sorted.sort((a, b) => b.Risk - a.Risk || b.Cost - a.Cost);
      break;
    case "name":
      sorted.sort((a, b) => a.ID.localeCompare(b.ID));
      break;
    default:
      sorted.sort((a, b) => b.Cost - a.Cost || b.Risk - a.Risk);
  }
  return sorted;
}

export function selectedFinding(): Finding | null {
  const rows = filteredFindings();
  if (!rows.length) return null;
  const found = rows.find((f) => f.ID === state.selectedId);
  return found ?? rows[0];
}

export interface ServiceAggregate {
  name: string;
  type: string;
  cost: number;
  count: number;
  criticalCount: number;
  /** The worst severity band present, which is what colours the bar. */
  worst: Severity;
  /** Cost sitting in the critical band, for the "how much is urgent" reading. */
  criticalCost: number;
}

/** Waste aggregated by resource type, which is the unit operators act on. */
export function byService(): ServiceAggregate[] {
  const groups = new Map<string, ServiceAggregate>();
  const rank: Record<Severity, number> = { low: 0, medium: 1, high: 2, critical: 3 };

  for (const f of state.snapshot.Findings ?? []) {
    if (f.Ignored) continue;
    const name = friendlyType(f.Type);
    const band = severity(f.Risk).key;
    const existing = groups.get(name);

    if (!existing) {
      groups.set(name, {
        name,
        type: f.Type,
        cost: f.Cost,
        count: 1,
        criticalCount: band === "critical" ? 1 : 0,
        criticalCost: band === "critical" ? f.Cost : 0,
        worst: band,
      });
      continue;
    }

    existing.cost += f.Cost;
    existing.count += 1;
    if (band === "critical") {
      existing.criticalCount += 1;
      existing.criticalCost += f.Cost;
    }
    if (rank[band] > rank[existing.worst]) existing.worst = band;
  }

  return [...groups.values()].sort((a, b) => b.cost - a.cost);
}

export interface RegionAggregate {
  region: string;
  cost: number;
  count: number;
}

export function byRegion(): RegionAggregate[] {
  const groups = new Map<string, RegionAggregate>();
  for (const f of state.snapshot.Findings ?? []) {
    if (f.Ignored) continue;
    const region = f.Region.trim() || "global";
    const existing = groups.get(region);
    if (existing) {
      existing.cost += f.Cost;
      existing.count += 1;
    } else {
      groups.set(region, { region, cost: f.Cost, count: 1 });
    }
  }
  return [...groups.values()].sort((a, b) => b.cost - a.cost);
}

export function severityHistogram(): { key: "critical" | "high" | "medium" | "low"; count: number; cost: number }[] {
  const bands = [
    { key: "critical" as const, count: 0, cost: 0 },
    { key: "high" as const, count: 0, cost: 0 },
    { key: "medium" as const, count: 0, cost: 0 },
    { key: "low" as const, count: 0, cost: 0 },
  ];
  for (const f of state.snapshot.Findings ?? []) {
    if (f.Ignored) continue;
    const band = bands.find((b) => b.key === severity(f.Risk).key);
    if (band) {
      band.count += 1;
      band.cost += f.Cost;
    }
  }
  return bands;
}

/* ------------------------------------------------------------ actions */

export async function boot(): Promise<void> {
  const backend: Backend = await initBackend();
  set({ mode: backend.mode });

  const [profile, prefs] = await Promise.all([backend.profile(), backend.prefs()]);
  set({ profile, prefs, ready: true, mode: backend.mode });

  await Promise.all([refreshSnapshot(), refreshArtifacts()]);

  // Deep link straight to a section; harmless for a normal launch.
  const requested = new URLSearchParams(window.location.search).get("screen");
  if (requested && isScreenID(requested)) set({ screen: requested });

  // Nothing is read on launch. A scan of a live account reaches out to AWS, so it
  // only happens when the operator asks for it; the interface opens on a
  // statement of nothing, with the way to start one in front of them.
  void detectAws();

  // Entitlement resolution is RevenueCat's job, and it happens with a public
  // key against the hosted checkout. There is no key to enter and nothing
  // secret in this binary.
  void loadPlan(profile.UserID);

  // The optional server-side check is a property of the Go service's
  // environment, so its availability is asked for once, at boot.
  void refreshVerificationStatus();
}

const SCREEN_IDS: readonly ScreenID[] = ["statement", "register", "topology", "artifacts", "account", "settings"];

export function isScreenID(value: string): value is ScreenID {
  return (SCREEN_IDS as readonly string[]).includes(value);
}

async function loadPlan(appUserId: string): Promise<void> {
  set({ plan: { ...state.plan, loading: true } });
  const plan = await initPlan(appUserId);
  set({ plan });
  if (plan.pro) {
    void api().cacheEntitlement(true, plan.expiresAt ?? "", "revenuecat");
  }
}

export async function refreshPlan(): Promise<void> {
  if (!state.profile) return;
  set({ plan: { ...state.plan, loading: true } });
  const plan = await initPlan(state.profile.UserID);
  set({ plan });
}

export async function refreshSnapshot(): Promise<void> {
  const snapshot = await api().snapshot();
  set({ snapshot, scanning: snapshot.Status === "scanning" });
  emit();
}

export async function refreshArtifacts(): Promise<void> {
  try {
    const [artifacts, exports] = await Promise.all([api().artifacts(), api().exportSpecs()]);
    set({ artifacts: artifacts ?? [], exports: exports ?? [] });
  } catch {
    set({ artifacts: [], exports: [] });
  }
}

export async function savePrefs(patch: Partial<Prefs>): Promise<void> {
  const prefs = { ...state.prefs, ...patch };
  set({ prefs });
  try {
    await api().savePrefs(prefs);
  } catch (err) {
    toast("error", "Could not save settings", String(err));
  }
}

let pollTimer: number | undefined;

export async function runScan(): Promise<void> {
  if (state.scanning) return;
  set({ scanning: true, selectedId: null, toast: null });
  try {
    await api().startScan(state.prefs.Region, state.prefs.Demo);
  } catch (err) {
    set({ scanning: false });
    toast("error", "The scan could not start", String(err));
    return;
  }
  startPolling();
}

function startPolling(): void {
  if (pollTimer !== undefined) return;
  pollTimer = window.setInterval(async () => {
    let snapshot: Snapshot;
    try {
      snapshot = await api().snapshot();
    } catch {
      return;
    }
    const finished = snapshot.Status !== "scanning";
    set({ snapshot, scanning: !finished });
    if (finished) {
      window.clearInterval(pollTimer);
      pollTimer = undefined;
      if (snapshot.Status === "cancelled") {
        toast("info", "Scan stopped", "The run was stopped before it finished.");
      } else if (snapshot.Status === "failed") {
        toast("error", "The scan failed", snapshot.Error || "The engine returned an error.");
      } else if (snapshot.Partial) {
        toast(
          "info",
          "Scan finished with gaps",
          `${snapshot.FailedScopeCount} scope${snapshot.FailedScopeCount === 1 ? "" : "s"} could not be read, so these totals are a floor rather than a full account.`,
        );
      }
      await refreshArtifacts();
    }
  }, 600);
}

export async function exportArtifact(kind: string): Promise<void> {
  if (state.exporting) return;
  set({ exporting: kind });
  try {
    const path = await api().exportArtifact(kind);
    await refreshArtifacts();
    set({ exporting: null });
    toast("success", "Export written", path || "The artifact was generated.");
  } catch (err) {
    set({ exporting: null });
    toast("error", "Export failed", String(err));
  }
}

export async function openArtifact(name: string): Promise<void> {
  try {
    await api().openArtifact(name);
  } catch (err) {
    toast("error", "Could not open the artifact", String(err));
  }
}

/** Generate every artifact in one pass, for when a folder should be complete. */
export async function exportAll(): Promise<void> {
  if (state.exporting) return;

  for (const spec of state.exports) {
    if (spec.Ready) await exportArtifact(spec.Kind);
  }
  await refreshArtifacts();
  toast("success", "Artifacts generated", "Every report is now in the artifact folder.");
}

export async function openOutputDir(): Promise<void> {
  try {
    await api().openOutputDir();
  } catch (err) {
    toast("error", "Could not open the folder", String(err));
  }
}

/** Stop a run in progress, so a scan that stalls is not a dead end. */
export async function cancelScan(): Promise<void> {
  try {
    await api().cancelScan();
  } catch (err) {
    toast("error", "Could not stop the scan", String(err));
  }
}

/**
 * Ask the operating system for a folder. An empty answer means the operator
 * closed the picker, which is not an error and changes nothing.
 */
export async function chooseDirectory(title: string, startIn: string, apply: (path: string) => Promise<void>): Promise<void> {
  try {
    const chosen = await api().chooseDirectory(title, startIn);
    if (chosen) await apply(chosen);
  } catch (err) {
    toast("error", "Could not open the folder picker", String(err));
  }
}

export async function openExternal(url: string): Promise<void> {
  try {
    await api().openExternal(url);
  } catch (err) {
    toast("error", "Could not open the link", String(err));
  }
}

export async function ignoreFinding(id: string): Promise<void> {
  try {
    await api().ignoreFinding(id);
    await refreshSnapshot();
    toast("success", "Finding suppressed", "It is excluded from the totals from now on.");
  } catch (err) {
    toast("error", "Could not suppress the finding", String(err));
  }
}

/* ------------------------------------------------------------ AWS access */

/**
 * Read the profiles in the local AWS configuration. This touches nothing but the
 * files the AWS CLI already owns; the app never reads a credential value.
 */
export async function loadAwsProfiles(): Promise<void> {
  try {
    const result = await api().awsProfiles();
    set({ awsProfiles: result.Profiles ?? [], awsProfilesError: result.Error ?? "" });
  } catch (err) {
    set({ awsProfiles: [], awsProfilesError: String(err) });
  }
}

/**
 * Work out what this machine already says about AWS, so a first scan needs no
 * configuration. A single profile is not a choice, so it is adopted outright;
 * anything more than one is left for the operator.
 */
export async function detectAws(): Promise<void> {
  try {
    const detected = await api().detectAws();
    set({
      awsDetected: detected,
      awsProfiles: detected.Profiles ?? [],
      awsProfilesError: detected.Error ?? "",
    });

    if (!state.prefs.Profile && detected.Profile) {
      await savePrefs({ Profile: detected.Profile });
    }
  } catch (err) {
    set({ awsDetected: null, awsProfiles: [], awsProfilesError: String(err) });
  }
}

/** Confirm the chosen profile works, by asking STS who it is. */
export async function verifyAws(): Promise<void> {
  if (state.verifyingAws) return;
  set({ verifyingAws: true });

  try {
    const identity = await api().verifyAws(state.prefs.Profile, state.prefs.Region);
    set({ awsIdentity: identity, verifyingAws: false });

    if (identity.Connected) {
      toast(
        "success",
        `Connected to account ${identity.Account}`,
        `Verified with STS using the ${identity.Profile || "default"} profile in ${identity.Region}.`,
      );
    } else {
      toast("error", "That profile could not be used", identity.Error || "STS rejected the credentials.");
    }
  } catch (err) {
    set({ verifyingAws: false });
    toast("error", "The check could not run", String(err));
  }
}

/** Choose which AWS profile to scan with, clearing any stale verification. */
export async function chooseProfile(profile: string): Promise<void> {
  set({ awsIdentity: null });
  await savePrefs({ Profile: profile });
}

/* ---------------------------------------------------------- remediation */

// Running a generated script touches a live account, so it takes two presses:
// the first states what the script will do, the second does it.
export function askRemediation(script: string): void {
  set({ remediation: { script, stage: "confirm" } });
}

export function cancelRemediation(): void {
  set({ remediation: { script: "", stage: "idle" } });
}

export async function runRemediation(): Promise<void> {
  const { script, stage } = state.remediation;
  if (!script || stage === "running") return;

  set({ remediation: { script, stage: "running" } });

  try {
    const result = await api().runRemediation(script);
    set({ remediationResult: result, remediation: { script: "", stage: "idle" } });
    await refreshArtifacts();

    if (result.Error || result.ExitCode !== 0) {
      toast(
        "error",
        `${script} did not finish cleanly`,
        result.Error || `The script exited with code ${result.ExitCode}. Its output is on the Artifacts screen.`,
      );
    } else {
      toast(
        "success",
        `${script} finished`,
        `Completed in ${(result.DurationMS / 1000).toFixed(1)}s. The output is on the Artifacts screen.`,
      );
      // The account has changed underneath the last scan.
      await refreshSnapshot();
    }
  } catch (err) {
    set({ remediation: { script: "", stage: "idle" } });
    toast("error", "The script could not be run", String(err));
  }
}

export async function setPlan(plan: PlanState): Promise<void> {
  set({ plan });
}

/* ------------------------------------------- authoritative verification */

/**
 * Learn whether the optional server-side check can run here. This is about the
 * Go service's environment, not the interface, so it is asked once at boot.
 */
export async function refreshVerificationStatus(): Promise<void> {
  try {
    set({ verificationStatus: await api().verificationStatus() });
  } catch {
    set({ verificationStatus: null });
  }
}

/**
 * Ask RevenueCat directly, through the Go service, using a secret key it reads
 * from its own environment. The key is never sent to this process: only the
 * verdict comes back.
 */
export async function verifyNow(): Promise<void> {
  if (state.verifying) return;
  set({ verifying: true });

  try {
    const result = await api().verifyEntitlement();
    set({ verification: result, verifying: false });

    if (!result.Checked) {
      toast("error", "The check did not complete", result.Error || "RevenueCat returned an error.");
      return;
    }
    if (result.Active) {
      toast(
        "success",
        "RevenueCat confirms Pro is active",
        `Checked straight from the REST API at ${new Date(result.CheckedAt).toLocaleTimeString()}.`,
      );
    } else {
      toast(
        "info",
        "RevenueCat reports no active entitlement",
        "The authoritative check found nothing active for this account, whatever the client believes.",
      );
    }
  } catch (err) {
    set({ verifying: false });
    toast("error", "The check could not run", String(err));
  }
}
