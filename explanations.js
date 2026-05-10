// Explanations and metadata for AWS networking primitives.
// Used by the sidebar and tooltip to describe what an element does and how
// traffic moves through it.

// Per-type color palette aligned with AWS's official Architecture-icon
// palette. `glow` is the brand colour and is used as the building's body
// colour in 3D so the box and the AWS icon on its sides read as the same
// hue. Values lean to the brighter end of each gradient so the bodies
// match the saturation of the icon backgrounds.
window.AWS_COLORS = {
  internet:   { a: "#ff8aa8", b: "#d63b6e", glow: "#ff5f86" },
  subnet:     { a: "#9fb6e6", b: "#3b5fa3", glow: "#7a9bd6" },
  vpc:        { a: "#c79cff", b: "#4D27A8", glow: "#A45BFF" },

  // Networking & content delivery — vivid purple
  igw:        { a: "#c79cff", b: "#4D27A8", glow: "#A45BFF" },
  nat:        { a: "#c79cff", b: "#4D27A8", glow: "#A45BFF" },
  tgw:        { a: "#c79cff", b: "#4D27A8", glow: "#A45BFF" },
  vpn:        { a: "#c79cff", b: "#4D27A8", glow: "#A45BFF" },
  dx:         { a: "#c79cff", b: "#4D27A8", glow: "#A45BFF" },
  endpoint:   { a: "#c79cff", b: "#4D27A8", glow: "#A45BFF" },
  alb:        { a: "#c79cff", b: "#4D27A8", glow: "#A45BFF" },
  nlb:        { a: "#c79cff", b: "#4D27A8", glow: "#A45BFF" },
  cloudfront: { a: "#c79cff", b: "#4D27A8", glow: "#A45BFF" },
  route53:    { a: "#c79cff", b: "#4D27A8", glow: "#A45BFF" },

  // Compute / containers — saturated AWS amber-orange
  ec2:        { a: "#FFB766", b: "#C8511B", glow: "#FF9900" },
  asg:        { a: "#FFB766", b: "#C8511B", glow: "#FF9900" },
  ecs:        { a: "#FFB766", b: "#C8511B", glow: "#FF9900" },
  eks:        { a: "#FFB766", b: "#C8511B", glow: "#FF9900" },
  lambda:     { a: "#FFB766", b: "#C8511B", glow: "#FF9900" },

  // Database — bright Aurora-blue
  rds:        { a: "#9CB7FF", b: "#2E27AD", glow: "#5294FF" },
  aurora:     { a: "#9CB7FF", b: "#2E27AD", glow: "#5294FF" },
  dynamodb:   { a: "#9CB7FF", b: "#2E27AD", glow: "#5294FF" },

  // Storage — vivid green
  s3:         { a: "#A7E16C", b: "#1B660F", glow: "#7CC242" },

  // Security, identity & compliance — saturated red
  waf:        { a: "#FF8499", b: "#BD0816", glow: "#E84855" },
  sg:         { a: "#FF8499", b: "#BD0816", glow: "#E84855" },
  nacl:       { a: "#FF8499", b: "#BD0816", glow: "#E84855" },

  // App integration — vivid magenta
  apigw:      { a: "#FF7AA8", b: "#B0084D", glow: "#F0457A" },

  // ----- Azure -----
  // Microsoft brand blue family + per-service category tints. Each gets
  // its own colour so an imported Azure network reads as Azure-coloured
  // (rather than every box looking the same shade of blue).
  vm:           { a: "#7DB9F0", b: "#0F4FA8", glow: "#3F8FFF" },
  vmss:         { a: "#7DB9F0", b: "#0F4FA8", glow: "#3F8FFF" },
  appservice:   { a: "#83C5FF", b: "#0078D4", glow: "#3F95E0" },
  function:     { a: "#FFC07A", b: "#A85100", glow: "#FFB330" },
  containerapp: { a: "#7CD9FF", b: "#005A9E", glow: "#22BAEF" },
  aks:          { a: "#92C2FF", b: "#003F8A", glow: "#0078D4" },
  sql:          { a: "#FFB59A", b: "#A02214", glow: "#E13D2B" },
  postgresql:   { a: "#94B7FF", b: "#1F3A93", glow: "#336791" },
  mysql:        { a: "#F4D27A", b: "#75500F", glow: "#F29111" },
  cosmosdb:     { a: "#9DC0FF", b: "#142A57", glow: "#3E7EE7" },
  redis:        { a: "#FF9B8E", b: "#9A1B0A", glow: "#D82C20" },
  blob:         { a: "#94D7E3", b: "#0F5366", glow: "#1FA3BF" },
  vnet:         { a: "#A166FF", b: "#4D27A8", glow: "#8C4FFF" },
  nsg:          { a: "#FF8499", b: "#BD0816", glow: "#E84855" },
  appgw:        { a: "#A166FF", b: "#4D27A8", glow: "#8C4FFF" },
  frontdoor:    { a: "#A166FF", b: "#4D27A8", glow: "#8C4FFF" },
  azurewaf:     { a: "#FF8499", b: "#BD0816", glow: "#E84855" },
  azurefirewall:{ a: "#FF8499", b: "#BD0816", glow: "#E84855" },
  vpngw:        { a: "#A166FF", b: "#4D27A8", glow: "#8C4FFF" },
  expressroute: { a: "#A166FF", b: "#4D27A8", glow: "#8C4FFF" },
  bastion:      { a: "#FFC07A", b: "#A85100", glow: "#FFB330" },
  azuredns:     { a: "#A166FF", b: "#4D27A8", glow: "#8C4FFF" },
  apim:         { a: "#F0457A", b: "#7C0E37", glow: "#E7157B" },
  privateendpoint: { a: "#A166FF", b: "#4D27A8", glow: "#8C4FFF" },
  entra:        { a: "#FFB766", b: "#C8511B", glow: "#FF9900" },
  cdn:          { a: "#A166FF", b: "#4D27A8", glow: "#8C4FFF" },

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

  // ----- Azure equivalents -----
  // The visualizer maps these to AWS shapes/icons internally via
  // TYPE_ALIASES, but the sidebar uses the descriptions and glyphs
  // below so users see proper Azure terminology.
  vm: {
    title: "Azure Virtual Machine",
    glyph: "VM",
    summary:
      "A managed virtual server in a VNet subnet. Has one or more NICs with private IPs from the subnet CIDR; outbound traffic follows the subnet's route table.",
    bullets: [
      "Inbound traffic is filtered by the NSG attached to the NIC or subnet.",
      "Use Azure Bastion to RDP/SSH in without exposing a public IP.",
      "Scale-out is typically done with a VM Scale Set rather than per-VM.",
    ],
  },
  vmss: {
    title: "VM Scale Set",
    glyph: "VMSS",
    summary:
      "A managed pool of identical VMs that scales horizontally based on metrics or schedule. Replaces failed instances automatically and registers with load balancers.",
    bullets: [
      "Spans availability zones for resilience.",
      "Integrates with Azure Monitor autoscale rules.",
      "Standard or Flexible orchestration modes.",
    ],
  },
  appservice: {
    title: "App Service",
    glyph: "APP",
    summary:
      "Fully-managed PaaS for hosting web apps. Slot-based deployments, built-in TLS, autoscale, and VNet integration for reaching private resources.",
    bullets: [
      "Runs on a shared App Service Plan (compute SKU + region).",
      "Uses regional VNet integration to reach private endpoints.",
      "Easy auth via Entra ID built-in identity provider.",
    ],
  },
  function: {
    title: "Azure Functions",
    glyph: "FN",
    summary:
      "Serverless event-driven compute. Triggered by HTTP, queues, blobs, timers, etc. VNet integration lets functions reach private resources.",
    bullets: [
      "Consumption / Premium / Dedicated hosting plans.",
      "Egress to the public internet by default; private outbound needs VNet integration.",
      "Cold start on Consumption — Premium plan keeps instances warm.",
    ],
  },
  containerapp: {
    title: "Container Apps",
    glyph: "CA",
    summary:
      "Serverless containers built on Kubernetes + KEDA. Scale-to-zero, traffic splitting, Dapr support — without managing the cluster.",
    bullets: [
      "Lives in a Container Apps Environment (VNet-injected).",
      "Each app gets an FQDN and can be public or internal.",
      "Pay per second of vCPU + memory.",
    ],
  },
  aks: {
    title: "Azure Kubernetes Service",
    glyph: "AKS",
    summary:
      "Managed Kubernetes. The control plane is run by Azure; node pools (VMSS under the hood) live in your VNet.",
    bullets: [
      "Pod networking with Azure CNI gives each pod a VNet IP.",
      "Use NSGs + network policies to control pod traffic.",
      "Integrate ingress with Application Gateway via AGIC.",
    ],
  },
  sql: {
    title: "Azure SQL Database",
    glyph: "SQL",
    summary:
      "Fully-managed PaaS SQL Server. Single database or elastic pool, with built-in HA, backups and geo-replication.",
    bullets: [
      "Default endpoint is public; lock down with a Private Endpoint.",
      "Use Active Geo-Replication for cross-region read replicas.",
      "Auth via SQL logins or Entra ID identities.",
    ],
  },
  postgresql: {
    title: "Azure DB for PostgreSQL",
    glyph: "PG",
    summary:
      "Managed PostgreSQL service (Flexible Server). VNet-integrated or public-endpoint deployment, HA across zones, automated backups.",
    bullets: [
      "Flexible Server lets you choose VNet injection.",
      "Read replicas in same or different regions.",
      "Connection pooling via PgBouncer integration.",
    ],
  },
  mysql: {
    title: "Azure DB for MySQL",
    glyph: "MY",
    summary:
      "Managed MySQL service (Flexible Server). VNet integration, HA across zones, automated backups, read replicas.",
    bullets: [
      "Burstable / General Purpose / Business Critical SKUs.",
      "Same operational model as Azure DB for PostgreSQL.",
    ],
  },
  cosmosdb: {
    title: "Azure Cosmos DB",
    glyph: "CDB",
    summary:
      "Globally-distributed multi-model NoSQL database. Single-digit-ms latency, multi-region writes, multiple APIs (SQL, Mongo, Cassandra, Gremlin, Table).",
    bullets: [
      "Reach privately via a Private Endpoint to avoid the public endpoint.",
      "Set consistency level per request (Strong → Eventual).",
      "Throughput billed in RUs (Provisioned, Autoscale, or Serverless).",
    ],
  },
  redis: {
    title: "Azure Cache for Redis",
    glyph: "RED",
    summary:
      "Managed Redis cache. Standard / Premium / Enterprise tiers, with optional persistence, clustering, and VNet injection on Premium.",
    bullets: [
      "Use Private Endpoint or VNet injection to keep traffic off the public IP.",
      "Premium supports active geo-replication.",
      "Common patterns: session store, throttling, leaderboard, message bus.",
    ],
  },
  blob: {
    title: "Azure Blob Storage",
    glyph: "BLB",
    summary:
      "Object storage for unstructured data. Hot/Cool/Archive tiers, lifecycle policies, immutable / WORM, and SAS-token signed URLs.",
    bullets: [
      "Reach privately from a VNet via a Private Endpoint.",
      "Service endpoints can lock the storage account to specific subnets.",
      "Front with Azure CDN or Front Door for public delivery.",
    ],
  },
  vnet: {
    title: "Virtual Network (VNet)",
    glyph: "VNET",
    summary:
      "Azure's isolated private network. You pick the address space and divide it into subnets, each pinned to a region.",
    bullets: [
      "Subnets are pinned to a region (Azure spreads them across AZs internally).",
      "Use NSGs at subnet or NIC level for filtering, UDRs for routing.",
      "Peer VNets for low-latency interconnects (region-pair or global).",
    ],
  },
  nsg: {
    title: "Network Security Group",
    glyph: "NSG",
    summary:
      "Stateful firewall attached to a subnet or NIC. Rules are evaluated in priority order; the first match wins.",
    bullets: [
      "Source / destination can be IP ranges, service tags or ASGs.",
      "Default deny inbound from Internet; allow VNet traffic by default.",
      "Pair with Azure Firewall for L7 outbound filtering.",
    ],
  },
  appgw: {
    title: "Application Gateway",
    glyph: "AGW",
    summary:
      "Regional layer-7 load balancer with built-in WAF. Path / host routing, TLS termination, end-to-end TLS, and AGIC integration with AKS.",
    bullets: [
      "Public or private (ILB) front-end IPs.",
      "WAF v2 includes OWASP / bot manager rule sets.",
      "Backend pools can be VMs, VMSS, App Services, AKS via AGIC.",
    ],
  },
  frontdoor: {
    title: "Azure Front Door",
    glyph: "FD",
    summary:
      "Global edge that caches, TLS-terminates and load-balances across regional origins. Built-in WAF, route-based traffic management.",
    bullets: [
      "Picks the closest healthy origin per user (anycast).",
      "Rules engine for headers / routing / redirects.",
      "Pair with Private Link to reach private origins.",
    ],
  },
  azurewaf: {
    title: "Azure WAF Policy",
    glyph: "WAF",
    summary:
      "Detect / prevent rules attached to Front Door or Application Gateway. Managed rule sets (OWASP, bot) + custom rules.",
    bullets: [
      "Block / Log / Anomaly-score modes.",
      "Geo-fencing, IP allow / deny, rate-limit, body / header inspection.",
      "Centralised log to Log Analytics or storage.",
    ],
  },
  azurefirewall: {
    title: "Azure Firewall",
    glyph: "AFW",
    summary:
      "Stateful firewall-as-a-service. Outbound filtering by FQDN, network rules between VNets, and built-in threat intelligence.",
    bullets: [
      "Centralise egress filtering for a hub VNet.",
      "Premium SKU adds TLS inspection and IDPS.",
      "Combine with Azure Bastion for jump-box access without public IPs.",
    ],
  },
  vpngw: {
    title: "VPN Gateway",
    glyph: "VPN",
    summary:
      "IPsec VPN gateway terminating site-to-site or point-to-site connections from on-prem networks.",
    bullets: [
      "Active-active dual-tunnel deployment for HA.",
      "BGP for dynamic routing.",
      "Pairs with ExpressRoute as a fallback encrypted path.",
    ],
  },
  expressroute: {
    title: "ExpressRoute",
    glyph: "ER",
    summary:
      "Private dedicated link between your on-prem network and Azure — bypasses the public internet. Lower latency, consistent throughput.",
    bullets: [
      "Connect via a Microsoft Peering / Private Peering circuit.",
      "Pair with VPN Gateway for an encrypted backup tunnel.",
      "ExpressRoute Global Reach connects on-prem sites via Azure backbone.",
    ],
  },
  bastion: {
    title: "Azure Bastion",
    glyph: "BAS",
    summary:
      "Managed jump host that gives you RDP / SSH access into VNet VMs via the Azure portal — without exposing public IPs on the VMs.",
    bullets: [
      "Lives in its own AzureBastionSubnet inside the VNet.",
      "Uses TLS over port 443 for the user session.",
      "Standard SKU supports VM scale sets, IP-based connection and shareable links.",
    ],
  },
  azuredns: {
    title: "Azure DNS",
    glyph: "DNS",
    summary:
      "Authoritative DNS hosting. Public DNS zones for internet records, Private DNS zones resolvable inside linked VNets only.",
    bullets: [
      "Alias records point directly to Azure resources (App Service, Front Door, …).",
      "Private DNS resolver for cross-VNet / on-prem DNS.",
      "Traffic Manager handles latency / weighted / geo routing.",
    ],
  },
  apim: {
    title: "API Management",
    glyph: "APIM",
    summary:
      "Managed API gateway. Routes requests to backend APIs, applies policies (auth, rate-limit, transform), and exposes a developer portal.",
    bullets: [
      "Consumption / Developer / Basic / Standard / Premium tiers.",
      "VNet-integrated deployment for private backends.",
      "Self-hosted gateway for on-prem or other clouds.",
    ],
  },
  privateendpoint: {
    title: "Private Endpoint",
    glyph: "PE",
    summary:
      "Private IP in your VNet that maps to a managed Azure service (SQL, Storage, Cosmos, …). Traffic stays inside the Microsoft backbone.",
    bullets: [
      "Disables public network access for the linked service.",
      "Resolved by Private DNS zone so connection strings just work.",
      "Pair with NSG rules to control which subnets can reach the endpoint.",
    ],
  },
  entra: {
    title: "Microsoft Entra ID",
    glyph: "ID",
    summary:
      "Identity service for users, groups and applications. Powers SSO, MFA, conditional access, managed identities for Azure resources.",
    bullets: [
      "Managed identities let services authenticate without secrets.",
      "Conditional Access for risk-based MFA / device compliance.",
      "Federate with on-prem AD via Entra Connect.",
    ],
  },
  cdn: {
    title: "Azure CDN",
    glyph: "CDN",
    summary:
      "Global content delivery network. Caches static assets at edge POPs and offloads origin traffic.",
    bullets: [
      "Standard Microsoft / Akamai / Verizon profiles.",
      "Front Door supersedes CDN for new deployments.",
      "Custom domains with managed TLS.",
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
