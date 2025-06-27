import { ECSClient } from "@aws-sdk/client-ecs";
import { EC2Client } from "@aws-sdk/client-ec2";
import { ElasticLoadBalancingV2Client } from "@aws-sdk/client-elastic-load-balancing-v2";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { CostExplorerClient } from "@aws-sdk/client-cost-explorer";

/**
 * Factory functions for AWS SDK clients.
 * Each function returns a new instance of the respective AWS client for the given region.
 */

export function createECSClient(region: string) {
  return new ECSClient({ region });
}

export function createEC2Client(region: string) {
  return new EC2Client({ region });
}

export function createELBClient(region: string) {
  return new ElasticLoadBalancingV2Client({ region });
}

export function createLogsClient(region: string) {
  return new CloudWatchLogsClient({ region });
}

export function createCostExplorerClient(region: string) {
  return new CostExplorerClient({ region });
}
