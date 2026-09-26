import { emptySnapshot, type Artifact, type ExportSpec, type Finding, type Prefs, type Profile, type Snapshot } from "./types";

/**
 * Synthetic scanner output for previewing the interface without a Go binary.
 *
 * Deterministic, so test expectations stay stable between runs. Covers the
 * awkward cases: a long resource id, an ARN with a path segment, a finding with
 * no region, and suppressed findings.
 *
 * `?empty=1` serves the pre-scan state instead, so the first-run onboarding can
 * be audited without a real account behind it.
 */
const forceEmpty = new URLSearchParams(window.location.search).get("empty") === "1";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20260925);
const pick = <T,>(items: readonly T[]): T => items[Math.floor(rand() * items.length)];
const between = (lo: number, hi: number): number => lo + rand() * (hi - lo);

interface Shape {
  type: string;
  reasons: readonly string[];
  cost: [number, number];
  risk: [number, number];
  prefix: string;
}

const SHAPES: readonly Shape[] = [
  {
    type: "AWS::EC2::Instance",
    reasons: [
      "CPU below 2% for 30 days and no network throughput",
      "Instance stopped with attached gp2 volume still billing",
      "Zombie instance: no IAM role, no security group traffic",
    ],
    cost: [48, 620],
    risk: [55, 95],
    prefix: "i-",
  },
  {
    type: "AWS::EC2::Volume",
    reasons: [
      "Unattached for 41 days",
      "gp2 volume: gp3 is 20% cheaper at the same throughput",
      "Orphaned volume left behind by a terminated instance",
    ],
    cost: [8, 190],
    risk: [40, 88],
    prefix: "vol-",
  },
  {
    type: "AWS::EC2::NatGateway",
    reasons: ["Under 1 GB processed in 30 days across 3 subnets", "All attached subnets have zero running instances"],
    cost: [32, 190],
    risk: [62, 94],
    prefix: "nat-",
  },
  {
    type: "AWS::EC2::Snapshot",
    reasons: ["Snapshot older than 90 days with no AMI reference", "Superseded by a newer snapshot of the same volume"],
    cost: [2, 64],
    risk: [18, 46],
    prefix: "snap-",
  },
  {
    type: "AWS::EC2::EIP",
    reasons: ["Allocated but not associated", "Matches a Route53 A-record: update DNS before releasing"],
    cost: [3, 8],
    risk: [70, 92],
    prefix: "eipalloc-",
  },
  {
    type: "AWS::RDS::DBInstance",
    reasons: ["Zero connections for 7 days and CPU below 5%", "Non-production instance running outside business hours"],
    cost: [110, 880],
    risk: [68, 96],
    prefix: "db-",
  },
  {
    type: "AWS::EKS::NodeGroup",
    reasons: ["Ghost node group: desired size 0 but instances still registered", "Cluster has 4% pod density on 40 vCPU"],
    cost: [180, 1450],
    risk: [64, 93],
    prefix: "ng-",
  },
  {
    type: "AWS::Lambda::Function",
    reasons: ["No invocations in 120 days", "Deployed but never wired to a trigger"],
    cost: [1, 26],
    risk: [22, 58],
    prefix: "fn-",
  },
  {
    type: "AWS::ElasticLoadBalancingV2::LoadBalancer",
    reasons: ["No healthy targets registered for 21 days", "Orphaned by a decommissioned service"],
    cost: [18, 96],
    risk: [58, 86],
    prefix: "arn:aws:elasticloadbalancing:us-east-1:778241905533:loadbalancer/app/",
  },
  {
    type: "AWS::CloudWatch::LogGroup",
    reasons: ["Retention set to never expire at 412 GB", "No retention policy on a high-volume group"],
    cost: [12, 240],
    risk: [34, 72],
    prefix: "loggroup-",
  },
  {
    type: "AWS::ElastiCache::CacheCluster",
    reasons: ["Cluster idle: 0 cache hits over 14 days", "Provisioned for a service that was retired"],
    cost: [64, 410],
    risk: [60, 90],
    prefix: "cache-",
  },
  {
    type: "AWS::ECR::Repository",
    reasons: ["412 untagged images with no lifecycle policy", "Every image older than 90 days is still stored"],
    cost: [6, 88],
    risk: [26, 62],
    prefix: "repo-",
  },
];

const REGIONS = ["us-east-1", "us-east-1", "us-east-1", "eu-west-1", "eu-west-1", "ap-southeast-2", "us-west-2"];

const OWNERS = [
  "jdoe@company.com",
  "priya.raman@company.com",
  "platform-team@company.com",
  "",
  "m.okafor@company.com",
  "data-eng@company.com",
  "s.leclerc@company.com",
];

const REACHABILITY = ["Public", "Private", "Isolated"];

function buildFindings(count: number): Finding[] {
  const findings: Finding[] = [];
  for (let i = 0; i < count; i++) {
    const shape = pick(SHAPES);
    const cost = Math.round(between(shape.cost[0], shape.cost[1]) * 100) / 100;
    const risk = Math.round(between(shape.risk[0], shape.risk[1]));
    const id = `${shape.prefix}${Math.floor(rand() * 0xffffffff).toString(16).padStart(8, "0")}${
      i === 4 ? "/staging-blue-2/8f3c4d1e6a9b7c2f" : ""
    }`;
    findings.push({
      ID: id,
      Type: shape.type,
      Region: i === 11 ? "" : pick(REGIONS),
      Reason: pick(shape.reasons),
      Owner: pick(OWNERS),
      Reachability: pick(REACHABILITY),
      Cost: cost,
      Risk: risk,
      Ignored: i === 7 || i === 19,
      Properties: {
        Age: `${Math.round(between(18, 420))} days`,
        Launched: `2025-${String(Math.round(between(1, 12))).padStart(2, "0")}-${String(
          Math.round(between(1, 28)),
        ).padStart(2, "0")}`,
        State: pick(["available", "running", "stopped"]),
        VolumeType: pick(["gp2", "gp3", "io2"]),
        Encrypted: rand() > 0.3,
        "cloudslash:ignore": i === 7 ? "true" : undefined,
        Tags: pick([[], ["CostCenter", "Team"], ["env", "owner", "tier"]]),
      },
    });
  }
  return findings;
}

const ALL_FINDINGS = buildFindings(38);
const MONTHLY_WASTE = ALL_FINDINGS.filter((f) => !f.Ignored).reduce((sum, f) => sum + f.Cost, 0);

let snapshot: Snapshot = {
  Status: "complete",
  Region: "us-east-1",
  TotalNodes: 1284,
  WasteCount: ALL_FINDINGS.filter((f) => !f.Ignored).length,
  IgnoredCount: 2,
  MonthlyWaste: MONTHLY_WASTE,
  Findings: ALL_FINDINGS,
  EdgeCount: 3471,
  Partial: false,
  FailedScopeCount: 0,
  Error: "",
  StartedAt: new Date(Date.now() - 1000 * 60 * 4).toISOString(),
  FinishedAt: new Date(Date.now() - 1000 * 60 * 2).toISOString(),
};

const PROFILE: Profile = {
  UserID: "cs_7f21bd94c3a8",
  Version: "2.2.6",
  License: "AGPLv3 (Enterprise)",
  OutputDir: "cloudslash-out",
  DataDir: "~/.cloudslash",
  Platform: "preview",
};

const EXPORTS: ExportSpec[] = [
  {
    Kind: "json",
    Label: "Waste report",
    FileName: "waste_report.json",
    Description: "Every finding as JSON, for a pipeline or a ticket.",
    Ready: true,
  },
  {
    Kind: "csv",
    Label: "Waste report",
    FileName: "waste_report.csv",
    Description: "The same findings as a spreadsheet.",
    Ready: true,
  },
  {
    Kind: "markdown",
    Label: "Executive summary",
    FileName: "executive_summary.md",
    Description: "A page you can paste into a review.",
    Ready: true,
  },
  {
    Kind: "remediation",
    Label: "Remediation plan",
    FileName: "remediation_plan.json",
    Description: "The Lazarus Protocol plan: snapshot, stop, detach, roll back.",
    Ready: true,
  },
  {
    Kind: "dashboard",
    Label: "Executive dashboard",
    FileName: "dashboard.html",
    Description: "Self-contained dashboard with the cost-flow diagram.",
    Ready: true,
  },
  {
    Kind: "report",
    Label: "Analysis report",
    FileName: "report.html",
    Description: "Portable HTML report for a review or a ticket.",
    Ready: true,
  },
];

const ARTIFACTS: Artifact[] = [
  { Name: "dashboard.html", Size: 412_664, ModTime: new Date(Date.now() - 1000 * 60 * 2).toISOString(), Kind: "dashboard" },
  { Name: "executive_summary.md", Size: 6_184, ModTime: new Date(Date.now() - 1000 * 60 * 2).toISOString(), Kind: "markdown" },
  { Name: "remediation_plan.json", Size: 88_231, ModTime: new Date(Date.now() - 1000 * 60 * 2).toISOString(), Kind: "remediation" },
  { Name: "safe_cleanup.sh", Size: 21_904, ModTime: new Date(Date.now() - 1000 * 60 * 2).toISOString(), Kind: "remediation" },
  { Name: "undo_cleanup.sh", Size: 18_442, ModTime: new Date(Date.now() - 1000 * 60 * 2).toISOString(), Kind: "remediation" },
  { Name: "waste_report.csv", Size: 14_820, ModTime: new Date(Date.now() - 1000 * 60 * 2).toISOString(), Kind: "csv" },
  { Name: "waste_report.json", Size: 194_502, ModTime: new Date(Date.now() - 1000 * 60 * 2).toISOString(), Kind: "json" },
];

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const mockBackend = {
  mode: "preview" as const,

  async profile() {
    await delay(20);
    return PROFILE;
  },

  async prefs(): Promise<Prefs> {
    return {
      Region: snapshot.Region || "us-east-1",
      // The preview is a demo by definition; there is no account to read.
      Demo: !forceEmpty,
      Profile: "",
      AllowAwsAccess: false,
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
  },

  async awsProfiles() {
    return { Profiles: ["default", "production", "staging", "sandbox"], Error: "" };
  },

  async verifyAws(profile: string, region: string) {
    return {
      Connected: false,
      Account: "",
      Profile: profile,
      Region: region,
      Error: "preview mode cannot reach STS",
    };
  },

  async runRemediation(script: string) {
    await delay(300);
    return {
      Ran: false,
      Script: script,
      Output: "",
      Error: "preview mode cannot run scripts",
      ExitCode: 0,
      DurationMS: 0,
    };
  },

  async savePrefs() {
    /* preview keeps nothing */
  },

  async snapshot() {
    if (forceEmpty) return emptySnapshot();
    return snapshot;
  },

  async startScan(region: string, demo: boolean) {
    const started = new Date().toISOString();
    snapshot = {
      ...snapshot,
      Status: "scanning",
      Region: region || "us-east-1",
      StartedAt: started,
      FinishedAt: "",
      Error: "",
    };

    // Walk through the stages the engine actually goes through, so the progress
    // and status treatments can be reviewed properly.
    for (let step = 1; step <= 6; step++) {
      await delay(360);
      if (step < 6) {
        snapshot = { ...snapshot, TotalNodes: Math.round((1284 / 6) * step), WasteCount: 0, MonthlyWaste: 0, Findings: [] };
        continue;
      }
      snapshot = {
        Status: "complete",
        Region: region || "us-east-1",
        TotalNodes: 1284,
        WasteCount: ALL_FINDINGS.filter((f) => !f.Ignored).length,
        IgnoredCount: 2,
        MonthlyWaste: MONTHLY_WASTE,
        Findings: ALL_FINDINGS,
        EdgeCount: 3471,
        Partial: demo ? false : true,
        FailedScopeCount: demo ? 0 : 1,
        Error: "",
        StartedAt: started,
        FinishedAt: new Date().toISOString(),
      };
    }
  },

  async artifacts() {
    return ARTIFACTS;
  },

  async exportSpecs() {
    return EXPORTS;
  },

  async exportArtifact(kind: string) {
    await delay(500);
    const spec = EXPORTS.find((e) => e.Kind === kind);
    return `cloudslash-out/${spec?.FileName ?? `${kind}.out`}`;
  },

  async ignoreFinding(id: string) {
    await delay(120);
    const findings = (snapshot.Findings ?? []).map((f) => (f.ID === id ? { ...f, Ignored: true } : f));
    const live = findings.filter((f) => !f.Ignored);
    snapshot = {
      ...snapshot,
      Findings: findings,
      WasteCount: live.length,
      IgnoredCount: findings.length - live.length,
      MonthlyWaste: live.reduce((sum, f) => sum + f.Cost, 0),
    };
  },

  async openArtifact(name: string) {
    await delay(60);
    void name;
  },

  async openOutputDir() {
    await delay(60);
  },

  async cancelScan() {
    await delay(40);
  },

  async detectAws() {
    await delay(40);
    return {
      Profiles: ["default"],
      Profile: "default",
      Region: "us-east-1",
      Source: "us-east-1 (default)",
      Error: "",
      NeedsPermission: false,
    };
  },

  async grantAwsAccess() {
    await delay(40);
  },

  async chooseDirectory() {
    await delay(40);
    // No native picker in a browser preview.
    return "";
  },

  async openExternal(url: string) {
    await delay(40);
    // In the preview the OS browser is the right target anyway.
    window.open(url, "_blank", "noopener,noreferrer");
  },

  async cacheEntitlement() {
    /* preview keeps nothing */
  },

  async verificationStatus() {
    return {
      Available: false,
      Reason:
        "Preview mode: the Go service is not running, so there is no environment to read a secret key from.",
      EnvVar: "REVENUECAT_SECRET_KEY",
      EntitlementID: "cloudslash_pro",
      AppUserID: PROFILE.UserID,
    };
  },

  async verifyEntitlement() {
    return {
      Checked: false,
      Active: false,
      Source: "",
      EntitlementID: "cloudslash_pro",
      ProductID: "",
      ExpiresAt: "",
      ManagementURL: "",
      AppUserID: PROFILE.UserID,
      CheckedAt: "",
      Error: "preview mode cannot reach RevenueCat",
    };
  },
};
