/**
 * Presentation formatters.
 *
 * Money and counts are formatted once, here, so every surface agrees on how a
 * figure is written. The engine's raw values never reach the DOM.
 */

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const usdWhole = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const usdCompact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

const count = new Intl.NumberFormat("en-US");

export function money(v: number): string {
  return usd.format(Number.isFinite(v) ? v : 0);
}

export function moneyWhole(v: number): string {
  return usdWhole.format(Number.isFinite(v) ? v : 0);
}

/** For tight columns where the full figure would wrap. */
export function moneyCompact(v: number): string {
  const n = Number.isFinite(v) ? v : 0;
  if (Math.abs(n) >= 1000) return usdCompact.format(n);
  return usdWhole.format(n);
}

export function moneyAnnual(monthly: number): string {
  return usdWhole.format(monthly * 12);
}

export function num(v: number): string {
  return count.format(Number.isFinite(v) ? v : 0);
}

export function pct(value: number, total: number): string {
  if (!total) return "0%";
  const p = (value / total) * 100;
  if (p > 0 && p < 1) return "<1%";
  return `${Math.round(p)}%`;
}

/**
 * AWS resource type identifiers are unreadable in a table, and this project's
 * findings mix CloudFormation types with Terraform type names. Both are mapped.
 */
const TYPE_NAMES: Record<string, string> = {
  "AWS::EC2::Instance": "EC2 Instance",
  "AWS::EC2::Volume": "EBS Volume",
  "AWS::EC2::Snapshot": "EBS Snapshot",
  "AWS::EC2::EIP": "Elastic IP",
  aws_eip: "Elastic IP",
  "AWS::EC2::AMI": "AMI Image",
  "AWS::EC2::NatGateway": "NAT Gateway",
  aws_nat_gateway: "NAT Gateway",
  "AWS::S3::Bucket": "S3 Bucket",
  "AWS::S3::MultipartUpload": "S3 Multipart Upload",
  "AWS::RDS::DBInstance": "RDS Instance",
  "AWS::EKS::Cluster": "EKS Cluster",
  "AWS::EKS::NodeGroup": "EKS Node Group",
  "AWS::EKS::FargateProfile": "Fargate Profile",
  "AWS::ECS::Cluster": "ECS Cluster",
  "AWS::ECS::Service": "ECS Service",
  "AWS::ElasticLoadBalancingV2::LoadBalancer": "Load Balancer",
  "AWS::ElasticLoadBalancingV2::TargetGroup": "Target Group",
  "AWS::ElasticLoadBalancing::LoadBalancer": "Classic Load Balancer",
  "AWS::Lambda::Function": "Lambda Function",
  "AWS::ElastiCache::CacheCluster": "ElastiCache Cluster",
  "AWS::OpenSearch::Domain": "OpenSearch Domain",
  "AWS::Kinesis::Stream": "Kinesis Stream",
  "AWS::KMS::Key": "KMS Key",
  "AWS::SecretsManager::Secret": "Secrets Manager Secret",
  "AWS::SNS::Topic": "SNS Topic",
  "AWS::SQS::Queue": "SQS Queue",
  "AWS::CloudWatch::Alarm": "CloudWatch Alarm",
  "AWS::CloudWatch::LogGroup": "CloudWatch Log Group",
  "AWS::DynamoDB::Table": "DynamoDB Table",
  "AWS::Redshift::Cluster": "Redshift Cluster",
  "AWS::AutoScaling::AutoScalingGroup": "Auto Scaling Group",
  "AWS::EC2::SecurityGroup": "Security Group",
  "AWS::EC2::NetworkInterface": "Network Interface",
  "AWS::EC2::NetworkAcl": "Network ACL",
  "AWS::EC2::KeyPair": "Key Pair",
  "AWS::EC2::Subnet": "Subnet",
  "AWS::IAM::User": "IAM User",
  "AWS::IAM::Role": "IAM Role",
  "AWS::ECR::Repository": "ECR Repository",
};

export function friendlyType(resourceType: string): string {
  const key = (resourceType ?? "").trim();
  if (!key) return "Unknown";
  const known = TYPE_NAMES[key];
  if (known) return known;
  return key.replace(/^AWS::/, "").replace(/^aws_/, "").replace(/::/g, " ") || "Unknown";
}

export type Severity = "critical" | "high" | "medium" | "low";

export interface SeverityInfo {
  key: Severity;
  label: string;
}

export function severity(risk: number): SeverityInfo {
  if (risk >= 80) return { key: "critical", label: "Critical" };
  if (risk >= 60) return { key: "high", label: "High" };
  if (risk >= 30) return { key: "medium", label: "Medium" };
  return { key: "low", label: "Low" };
}

/** Risk bands, ordered, used by the severity filter. */
export const SEVERITY_FLOOR: Record<string, number> = {
  all: 0,
  critical: 80,
  high: 60,
  medium: 30,
};

export function humanBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0 B";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = n / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(1)} ${units[i]}`;
}

export function relTime(iso: string): string {
  if (!iso) return "never";
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "never";
  const secs = Math.max(0, (Date.now() - t.getTime()) / 1000);
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

/** Wall-clock time of a scan, for the masthead statement line. */
export function clockTime(iso: string): string {
  if (!iso) return "—";
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "—";
  return t.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function plural(n: number, one: string, many: string): string {
  return `${num(n)} ${n === 1 ? one : many}`;
}

export function truncate(value: string, max: number): string {
  if (max <= 0 || value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

/** `arn:aws:ec2:.../vol-0abc` -> `vol-0abc` */
export function shortID(id: string): string {
  if (!id) return "";
  const slash = id.lastIndexOf("/");
  if (slash >= 0 && slash < id.length - 1) return id.slice(slash + 1);
  return id;
}

export function valueOr(value: string | null | undefined, fallback: string): string {
  const v = (value ?? "").trim();
  return v === "" ? fallback : v;
}

/** Render an arbitrary property value for a spec sheet. */
export function propValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (typeof v === "string") return v === "" ? "—" : v;
  if (Array.isArray(v)) return v.length ? v.map(propValue).join(", ") : "—";
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
