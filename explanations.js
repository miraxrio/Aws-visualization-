// Explanations and metadata for AWS networking primitives.
// Used by the sidebar and tooltip to describe what an element does and how
// traffic moves through it.

// Per-type color palette (paired light/dark for gradients, plus a glow color).
window.AWS_COLORS = {
  internet:   { a: "#ff8aa8", b: "#d63b6e", glow: "#ff5f86" },
  vpc:        { a: "#ffb86b", b: "#d97f00", glow: "#ff9900" },
  subnet:     { a: "#9fb6e6", b: "#3b5fa3", glow: "#7a9bd6" },

  igw:        { a: "#a78bfa", b: "#5b21b6", glow: "#8b5cf6" },
  nat:        { a: "#f5c451", b: "#b8860b", glow: "#f5c451" },
  tgw:        { a: "#c084fc", b: "#6b21a8", glow: "#c084fc" },
  vpn:        { a: "#94a3b8", b: "#475569", glow: "#94a3b8" },
  dx:         { a: "#94a3b8", b: "#334155", glow: "#cbd5e1" },
  endpoint:   { a: "#a78bfa", b: "#4c1d95", glow: "#a78bfa" },

  alb:        { a: "#5eead4", b: "#0f766e", glow: "#2dd4bf" },
  nlb:        { a: "#7dd3fc", b: "#0369a1", glow: "#38bdf8" },

  ec2:        { a: "#fdba74", b: "#c2410c", glow: "#fb923c" },
  asg:        { a: "#fdba74", b: "#9a3412", glow: "#fb923c" },
  ecs:        { a: "#fbbf24", b: "#a16207", glow: "#f59e0b" },
  eks:        { a: "#86efac", b: "#15803d", glow: "#22c55e" },
  lambda:     { a: "#f0abfc", b: "#86198f", glow: "#e879f9" },

  rds:        { a: "#93c5fd", b: "#1d4ed8", glow: "#60a5fa" },
  aurora:     { a: "#7dd3fc", b: "#1e40af", glow: "#3b82f6" },
  dynamodb:   { a: "#67e8f9", b: "#155e75", glow: "#22d3ee" },
  s3:         { a: "#86efac", b: "#166534", glow: "#22c55e" },

  cloudfront: { a: "#fda4af", b: "#9f1239", glow: "#fb7185" },
  route53:    { a: "#fca5a5", b: "#991b1b", glow: "#f87171" },
  waf:        { a: "#fdba74", b: "#7c2d12", glow: "#f97316" },

  apigw:      { a: "#fcd34d", b: "#92400e", glow: "#fbbf24" },

  sg:         { a: "#fde68a", b: "#854d0e", glow: "#fbbf24" },
  nacl:       { a: "#fde68a", b: "#713f12", glow: "#facc15" },

  unknown:    { a: "#cbd5e1", b: "#475569", glow: "#94a3b8" },
};

window.AWS_EXPLAIN = {
  internet: {
    title: "Public Internet",
    glyph: "WWW",
    summary:
      "Everything outside your VPC. Inbound traffic must pass an Internet Gateway and a public-subnet routing rule to reach your services.",
    bullets: [
      "Reaches your VPC only through an Internet Gateway (IGW).",
      "Public subnets route 0.0.0.0/0 to the IGW; private subnets route 0.0.0.0/0 to a NAT.",
      "Security Groups and NACLs filter what's actually allowed in or out.",
    ],
  },

  vpc: {
    title: "Virtual Private Cloud (VPC)",
    glyph: "VPC",
    summary:
      "A logically isolated virtual network you own. You pick its IP range (CIDR) and divide it into subnets across Availability Zones.",
    bullets: [
      "Defines a private address space (e.g. 10.0.0.0/16).",
      "Contains subnets, route tables, gateways and endpoints.",
      "Traffic between subnets within a VPC is private by default.",
    ],
  },

  subnet: {
    title: "Subnet",
    glyph: "SUB",
    summary:
      "A slice of the VPC's address space pinned to one Availability Zone. Its route table determines whether it is public or private.",
    bullets: [
      "Public: route table sends 0.0.0.0/0 to an Internet Gateway.",
      "Private: route table sends 0.0.0.0/0 to a NAT, or has no internet egress.",
      "Data: typically private with no internet egress, only reachable from app subnets.",
    ],
  },

  igw: {
    title: "Internet Gateway",
    glyph: "IGW",
    summary:
      "A horizontally-scaled, redundant VPC component that allows communication between resources in your VPC and the internet.",
    bullets: [
      "Performs network address translation for instances with public IPs.",
      "Required for any subnet to be considered 'public'.",
      "Stateless — actual filtering is done by Security Groups and NACLs.",
    ],
  },

  nat: {
    title: "NAT Gateway",
    glyph: "NAT",
    summary:
      "Lets resources in private subnets reach the internet for outbound traffic (updates, API calls) without being directly reachable from the internet.",
    bullets: [
      "Lives in a public subnet; uses an Elastic IP for egress.",
      "One per AZ for high availability.",
      "Stateful — return traffic for outbound flows is automatically allowed.",
    ],
  },

  tgw: {
    title: "Transit Gateway",
    glyph: "TGW",
    summary:
      "A regional network hub that connects VPCs, on-prem networks (via VPN or Direct Connect), and other accounts together.",
    bullets: [
      "Replaces a mesh of VPC peerings with a hub-and-spoke design.",
      "Attachments can be VPCs, VPNs, Direct Connect, or other TGWs (peering).",
      "Route tables on the TGW control which attachments can talk to which.",
    ],
  },

  vpn: {
    title: "Site-to-Site VPN",
    glyph: "VPN",
    summary:
      "An IPsec tunnel between your on-premises network and the VPC, terminating at a Virtual Private Gateway or Transit Gateway.",
    bullets: [
      "Encrypted over the public internet.",
      "Two tunnels per connection for redundancy.",
      "Often paired with BGP for dynamic routing.",
    ],
  },

  dx: {
    title: "Direct Connect",
    glyph: "DX",
    summary:
      "A dedicated private network link between your data center and AWS — lower latency and steady throughput than VPN.",
    bullets: [
      "Bypasses the public internet.",
      "Pairs well with VPN as an encrypted backup.",
      "Connects through a Virtual Interface (VIF) to a VGW or TGW.",
    ],
  },

  endpoint: {
    title: "VPC Endpoint",
    glyph: "VPE",
    summary:
      "A private connection to AWS services (S3, DynamoDB, KMS, etc.) without leaving the AWS network — no need for an IGW or NAT.",
    bullets: [
      "Gateway endpoints: S3 and DynamoDB, added to route tables.",
      "Interface endpoints: PrivateLink ENIs in your subnets.",
      "Reduces NAT egress costs and keeps traffic off the internet.",
    ],
  },

  alb: {
    title: "Application Load Balancer",
    glyph: "ALB",
    summary:
      "Layer-7 load balancer that distributes HTTP/HTTPS requests across targets, with path/host routing, TLS termination, and WAF integration.",
    bullets: [
      "Sits in public subnets to receive internet traffic.",
      "Forwards to targets in private subnets via target groups.",
      "Health checks remove unhealthy targets automatically.",
    ],
  },

  nlb: {
    title: "Network Load Balancer",
    glyph: "NLB",
    summary:
      "Layer-4 (TCP/UDP) load balancer optimized for ultra-low latency and millions of requests per second.",
    bullets: [
      "Preserves the client source IP.",
      "Static IPs per AZ — friendly for IP allow-listing.",
      "Useful for non-HTTP services like databases or game servers.",
    ],
  },

  ec2: {
    title: "EC2 Instance",
    glyph: "EC2",
    summary:
      "A virtual machine running in a subnet. Each instance has one or more ENIs (network interfaces) with private IPs from the subnet's CIDR.",
    bullets: [
      "Outbound traffic follows the subnet's route table.",
      "Inbound is controlled by Security Groups attached to the ENI.",
      "Can be reached directly only if it has a public IP and lives in a public subnet.",
    ],
  },

  asg: {
    title: "Auto Scaling Group",
    glyph: "ASG",
    summary:
      "A managed pool of EC2 instances that scales up and down across AZs based on demand or schedules.",
    bullets: [
      "Replaces failed instances automatically.",
      "Registers/deregisters with target groups during scale events.",
      "Spans multiple AZs for resilience.",
    ],
  },

  ecs: {
    title: "ECS / Fargate Service",
    glyph: "ECS",
    summary:
      "Container orchestrator. With Fargate, tasks run on AWS-managed compute and get an ENI in your subnet.",
    bullets: [
      "Each task gets its own private IP.",
      "Uses target groups for load balancing.",
      "Subnet choice determines internet access (public vs. private+NAT).",
    ],
  },

  eks: {
    title: "EKS Cluster",
    glyph: "EKS",
    summary:
      "Managed Kubernetes. Worker nodes (or Fargate pods) run in your subnets; the control plane runs in AWS-owned ENIs that appear in your VPC.",
    bullets: [
      "Pod networking uses ENIs via the AWS VPC CNI.",
      "Cluster security group governs control-plane ↔ node traffic.",
      "Often paired with an ALB Ingress Controller.",
    ],
  },

  lambda: {
    title: "Lambda (VPC-attached)",
    glyph: "λ",
    summary:
      "Serverless functions. When VPC-attached, Lambda creates ENIs in your subnets so functions can reach private resources.",
    bullets: [
      "Egress to the internet requires a NAT (Lambda has no public IP).",
      "Subnet choice should span multiple AZs for resilience.",
      "Security Group controls which resources the function can reach.",
    ],
  },

  rds: {
    title: "RDS Database",
    glyph: "RDS",
    summary:
      "Managed relational database. Lives in a private (data) subnet group; access is controlled by a security group on its endpoint.",
    bullets: [
      "Multi-AZ deployments replicate to a standby in another AZ.",
      "Read replicas can offload read traffic.",
      "Should never be in a public subnet.",
    ],
  },

  aurora: {
    title: "Aurora Cluster",
    glyph: "AUR",
    summary:
      "Cloud-native MySQL/PostgreSQL-compatible database with a shared storage layer that replicates across 3 AZs.",
    bullets: [
      "Writer + readers behind cluster and reader endpoints.",
      "Storage auto-grows up to 128 TiB.",
      "Sub-second failover when the writer fails.",
    ],
  },

  dynamodb: {
    title: "DynamoDB",
    glyph: "DDB",
    summary:
      "Serverless key-value/document database. Reach it from a VPC privately via a Gateway VPC Endpoint.",
    bullets: [
      "No instances to manage; scales horizontally.",
      "Global tables replicate across regions.",
      "Use VPC endpoints to keep traffic off the public internet.",
    ],
  },

  s3: {
    title: "S3 Bucket",
    glyph: "S3",
    summary:
      "Object storage reached over HTTPS. From within a VPC, prefer a Gateway Endpoint so traffic stays on the AWS network.",
    bullets: [
      "Bucket policies + IAM control access.",
      "Gateway endpoint avoids NAT egress fees.",
      "Often paired with CloudFront for distribution.",
    ],
  },

  cloudfront: {
    title: "CloudFront",
    glyph: "CF",
    summary:
      "Global CDN that caches at edge locations, terminates TLS, and forwards origin requests to ALBs, S3 buckets, or custom origins.",
    bullets: [
      "Reduces latency for users worldwide.",
      "Origin Access Control locks S3 origins to CloudFront only.",
      "Integrates with WAF and Shield.",
    ],
  },

  route53: {
    title: "Route 53",
    glyph: "R53",
    summary:
      "Authoritative DNS. Public hosted zones serve internet DNS; private hosted zones resolve names only inside your VPC.",
    bullets: [
      "Alias records map directly to AWS resources (ALB, CloudFront, etc.).",
      "Health checks enable failover and latency-based routing.",
      "Resolver endpoints bridge DNS between on-prem and VPC.",
    ],
  },

  waf: {
    title: "WAF",
    glyph: "WAF",
    summary:
      "Web application firewall attached to CloudFront, ALB, or API Gateway to filter HTTP requests before they reach your app.",
    bullets: [
      "Managed rule groups for OWASP top 10, bot control, etc.",
      "Rate-based rules throttle abusive clients.",
      "Logs to S3, CloudWatch, or Kinesis Firehose.",
    ],
  },

  sg: {
    title: "Security Group",
    glyph: "SG",
    summary:
      "Stateful, instance-level firewall. Rules allow traffic; there are no deny rules. Return traffic is automatic.",
    bullets: [
      "Attached to ENIs (EC2, RDS, Lambda, etc.).",
      "Can reference other security groups by ID.",
      "Default outbound: allow all; default inbound: deny all.",
    ],
  },

  nacl: {
    title: "Network ACL",
    glyph: "ACL",
    summary:
      "Stateless, subnet-level firewall. Both allow and deny rules, evaluated in order. Return traffic must be explicitly allowed.",
    bullets: [
      "Useful as a coarse second layer of defense.",
      "Numbered rules processed in ascending order.",
      "Default NACL allows everything; custom NACLs deny everything.",
    ],
  },

  apigw: {
    title: "API Gateway",
    glyph: "API",
    summary:
      "Managed front door for HTTP/REST/WebSocket APIs. Handles auth, throttling, and routing to Lambda, ALBs, or VPC services via VPC Link.",
    bullets: [
      "Public by default; can be made private with an interface endpoint.",
      "Built-in throttling and caching.",
      "Integrates with Cognito, IAM, or Lambda authorizers.",
    ],
  },

  // Default fallback when an unknown type is used.
  unknown: {
    title: "Resource",
    glyph: "?",
    summary: "An AWS resource. Provide a known 'type' for a richer explanation.",
    bullets: [],
  },
};

// Tier (subnet) descriptions used for subnet hover.
window.AWS_TIER_EXPLAIN = {
  public: {
    title: "Public Subnet",
    summary:
      "Has a route to an Internet Gateway. Resources here can be assigned public IPs and reached from the internet (subject to security groups).",
    bullets: [
      "Houses load balancers, bastion hosts, NAT gateways.",
      "Default route 0.0.0.0/0 → IGW.",
      "Avoid placing data stores here.",
    ],
  },
  private: {
    title: "Private Subnet",
    summary:
      "No direct route from the internet. Outbound traffic typically egresses through a NAT gateway in a public subnet.",
    bullets: [
      "Houses application servers, microservices, internal LBs.",
      "Default route 0.0.0.0/0 → NAT (if outbound internet is needed).",
      "Reachable from the internet only via a load balancer in a public subnet.",
    ],
  },
  data: {
    title: "Data Subnet",
    summary:
      "Private subnet reserved for stateful resources. Usually has no internet egress at all — only reachable from app subnets.",
    bullets: [
      "Houses RDS, Aurora, ElastiCache, OpenSearch.",
      "No 0.0.0.0/0 route in many designs.",
      "Tight security group rules limit which app subnets can talk to it.",
    ],
  },
};
