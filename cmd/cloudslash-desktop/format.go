package main

import (
	"fmt"
	"image/color"
	"strings"
	"time"
)

// money renders a dollar amount with thousands separators (Go's fmt has no
// comma flag, so the grouping is done by hand).
func money(v float64) string {
	negative := v < 0
	if negative {
		v = -v
	}
	intPart, frac, _ := strings.Cut(fmt.Sprintf("%.2f", v), ".")

	var grouped strings.Builder
	for i, digit := range intPart {
		if i > 0 && (len(intPart)-i)%3 == 0 {
			grouped.WriteByte(',')
		}
		grouped.WriteRune(digit)
	}

	out := "$" + grouped.String() + "." + frac
	if negative {
		out = "-" + out
	}
	return out
}

// moneyShort renders large amounts compactly (e.g. $1.2k) for tight tiles.
func moneyShort(v float64) string {
	switch {
	case v >= 1_000_000:
		return fmt.Sprintf("$%.1fM", v/1_000_000)
	case v >= 1_000:
		return fmt.Sprintf("$%.1fk", v/1_000)
	default:
		return fmt.Sprintf("$%.0f", v)
	}
}

// friendlyType turns AWS resource type identifiers into readable labels.
func friendlyType(resourceType string) string {
	key := strings.TrimSpace(resourceType)
	if name, ok := typeNames[key]; ok {
		return name
	}
	key = strings.TrimPrefix(key, "AWS::")
	key = strings.TrimPrefix(key, "aws_")
	key = strings.ReplaceAll(key, "::", " ")
	if key == "" {
		return "Unknown"
	}
	return key
}

var typeNames = map[string]string{
	"AWS::EC2::Instance":                        "EC2 Instance",
	"AWS::EC2::Volume":                          "EBS Volume",
	"AWS::EC2::Snapshot":                        "EBS Snapshot",
	"AWS::EC2::EIP":                             "Elastic IP",
	"aws_eip":                                   "Elastic IP",
	"AWS::EC2::AMI":                             "AMI Image",
	"AWS::EC2::NatGateway":                      "NAT Gateway",
	"aws_nat_gateway":                           "NAT Gateway",
	"AWS::S3::Bucket":                           "S3 Bucket",
	"AWS::S3::MultipartUpload":                  "S3 Multipart Upload",
	"AWS::RDS::DBInstance":                      "RDS Instance",
	"AWS::EKS::Cluster":                         "EKS Cluster",
	"AWS::EKS::NodeGroup":                       "EKS Node Group",
	"AWS::ECS::Cluster":                         "ECS Cluster",
	"AWS::ECS::Service":                         "ECS Service",
	"AWS::ElasticLoadBalancingV2::LoadBalancer": "Load Balancer",
	"AWS::Lambda::Function":                     "Lambda Function",
	"AWS::ElastiCache::CacheCluster":            "ElastiCache Cluster",
	"AWS::OpenSearch::Domain":                   "OpenSearch Domain",
	"AWS::Kinesis::Stream":                      "Kinesis Stream",
	"AWS::KMS::Key":                             "KMS Key",
	"AWS::SecretsManager::Secret":               "Secrets Manager Secret",
	"AWS::SNS::Topic":                           "SNS Topic",
	"AWS::SQS::Queue":                           "SQS Queue",
	"AWS::CloudWatch::Alarm":                    "CloudWatch Alarm",
	"AWS::CloudWatch::LogGroup":                 "CloudWatch Log Group",
	"AWS::DynamoDB::Table":                      "DynamoDB Table",
	"AWS::Redshift::Cluster":                    "Redshift Cluster",
	"AWS::AutoScaling::AutoScalingGroup":        "Auto Scaling Group",
	"AWS::ElasticLoadBalancing::LoadBalancer":   "Classic Load Balancer",
	"AWS::ElasticLoadBalancingV2::TargetGroup":  "Target Group",
	"AWS::EC2::SecurityGroup":                   "Security Group",
	"AWS::EC2::NetworkInterface":                "Network Interface",
	"AWS::EC2::KeyPair":                         "Key Pair",
	"AWS::EC2::NetworkAcl":                      "Network ACL",
	"AWS::IAM::User":                            "IAM User",
	"AWS::IAM::Role":                            "IAM Role",
	"AWS::EKS::FargateProfile":                  "Fargate Profile",
	"AWS::ECR::Repository":                      "ECR Repository",
	"AWS::EC2::Subnet":                          "Subnet",
}

// riskLevel maps a risk score to a human severity label and colour.
func riskLevel(score int) (string, color.Color) {
	switch {
	case score >= 80:
		return "Critical", colDanger
	case score >= 60:
		return "High", colWarn
	case score >= 30:
		return "Medium", colInfo
	default:
		return "Low", colMuted
	}
}

// riskBar renders a compact textual risk gauge (0-100).
func riskBar(score int) string {
	if score < 0 {
		score = 0
	}
	if score > 100 {
		score = 100
	}
	filled := score / 10
	return strings.Repeat("█", filled) + strings.Repeat("░", 10-filled)
}

// humanBytes formats a byte count for artifact listings.
func humanBytes(n int64) string {
	const unit = 1024
	if n < unit {
		return fmt.Sprintf("%d B", n)
	}
	div, exp := int64(unit), 0
	for v := n / unit; v >= unit; v /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(n)/float64(div), "KMGT"[exp])
}

// relTime renders a friendly "3m ago" style timestamp.
func relTime(t time.Time) string {
	if t.IsZero() {
		return "never"
	}
	d := time.Since(t)
	switch {
	case d < time.Minute:
		return "just now"
	case d < time.Hour:
		return fmt.Sprintf("%dm ago", int(d.Minutes()))
	case d < 24*time.Hour:
		return fmt.Sprintf("%dh ago", int(d.Hours()))
	default:
		return fmt.Sprintf("%dd ago", int(d.Hours()/24))
	}
}

// plural picks the singular or plural noun for a count.
func plural(n int, singular, many string) string {
	if n == 1 {
		return fmt.Sprintf("%d %s", n, singular)
	}
	return fmt.Sprintf("%d %s", n, many)
}

// truncate shortens a string for fixed-width UI slots.
func truncate(s string, max int) string {
	if max <= 0 || len(s) <= max {
		return s
	}
	if max <= 1 {
		return s[:max]
	}
	return s[:max-1] + "…"
}

// indentValue derives a short display name from a full ARN-ish identifier.
func shortID(id string) string {
	if id == "" {
		return ""
	}
	if i := strings.LastIndex(id, "/"); i >= 0 && i < len(id)-1 {
		return id[i+1:]
	}
	return id
}
