#!/usr/bin/env bash
# Thin wrapper around the ZeroBias boundaries GraphQL API. Run it from anywhere
# that can reach the ZeroBias host (this Claude Code web environment cannot —
# its egress allowlist blocks *.zerobias.com).
#
#   export ZEROBIAS_API_KEY=...        # required
#   export ZEROBIAS_ORG_ID=...         # required
#   export ZEROBIAS_BOUNDARY_ID=...    # required
#   export ZEROBIAS_GQL_HOST=api.uat.zerobias.com   # optional (default)
#   export ZEROBIAS_PAGE_SIZE=100                    # optional
#
#   ./zb-graphql.sh introspect                 # list available Aws* query fields
#   ./zb-graphql.sh type AwsSubnet             # fields of one type
#   ./zb-graphql.sh q 'query { AwsIamUser { name arn mfaEnabled } }'
#   ./zb-graphql.sh inventory > aws-inventory.json   # pull all inventory types
#
# Pipe `inventory` output to: node cli.js --graphql --in aws-inventory.json
set -euo pipefail

: "${ZEROBIAS_API_KEY:?set ZEROBIAS_API_KEY}"
: "${ZEROBIAS_ORG_ID:?set ZEROBIAS_ORG_ID}"
: "${ZEROBIAS_BOUNDARY_ID:?set ZEROBIAS_BOUNDARY_ID}"
HOST="${ZEROBIAS_GQL_HOST:-api.uat.zerobias.com}"
PAGE="${ZEROBIAS_PAGE_SIZE:-100}"
URL="https://${HOST}/graphql/boundaries/${ZEROBIAS_BOUNDARY_ID}?pageSize=${PAGE}"

run() { # run <graphql-query-string>
  curl -sS -X PUT "$URL" \
    -H "Authorization: APIKey ${ZEROBIAS_API_KEY}" \
    -H "dana-org-id: ${ZEROBIAS_ORG_ID}" \
    -H "Content-Type: application/json" \
    --data-binary "$(printf '{"query": %s}' "$(printf '%s' "$1" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')")"
}

cmd="${1:-introspect}"
case "$cmd" in
  introspect)
    run 'query { __schema { queryType { fields { name } } } }' ;;
  type)
    run "query { __type(name: \"${2:?usage: type <TypeName>}\") { name fields { name type { name kind ofType { name } } } } }" ;;
  q)
    run "${2:?usage: q '<graphql>'}" ;;
  inventory)
    # Pull each inventory type and merge into one { type: [...] } document that
    # `cli.js --graphql --in` consumes. Field names are best-effort — confirm
    # with `introspect` / `type` first and tweak if a query errors.
    declare -A Q=(
      [vpcs]='query { AwsVpc { vpcId cidrBlock region awsAccountId tags { key value } } }'
      [subnets]='query { AwsSubnet { subnetId vpcId cidrBlock availabilityZone mapPublicIpOnLaunch tags { key value } } }'
      [internetGateways]='query { AwsInternetGateway { internetGatewayId attachments { vpcId } } }'
      [natGateways]='query { AwsNatGateway { natGatewayId subnetId vpcId } }'
      [routeTables]='query { AwsRouteTable { routeTableId vpcId associations { subnetId main } routes { destinationCidrBlock gatewayId natGatewayId } } }'
      [instances]='query { AwsEc2Instance { instanceId subnetId vpcId privateIpAddress publicIpAddress securityGroupIds tags { key value } } }'
      [securityGroups]='query { AwsSecurityGroup { groupId vpcId ipPermissions { fromPort toPort ipProtocol ipRanges { cidrIp } userIdGroupPairs { groupId } } } }'
      [loadBalancers]='query { AwsLoadBalancer { loadBalancerArn name type scheme vpcId subnets securityGroupIds } }'
      [rds]='query { AwsRdsInstance { dbInstanceIdentifier engine vpcId subnetIds securityGroupIds tags { key value } } }'
      [iamUsers]='query { AwsIamUser { name arn mfaEnabled awsAccountId } }'
    )
    echo "{"
    first=1
    for key in "${!Q[@]}"; do
      data="$(run "${Q[$key]}" || true)"
      # extract the inner array (the single top-level field value); fall back to []
      arr="$(printf '%s' "$data" | python3 -c 'import json,sys
try:
  d=json.load(sys.stdin).get("data") or {}
  v=next(iter(d.values()),[])
  print(json.dumps(v if isinstance(v,list) else []))
except Exception:
  print("[]")')"
      [ $first -eq 0 ] && echo ","
      printf '  %s: %s' "\"$key\"" "$arr"
      first=0
    done
    echo
    echo "}" ;;
  *)
    echo "usage: $0 {introspect|type <Name>|q '<graphql>'|inventory}" >&2; exit 2 ;;
esac
