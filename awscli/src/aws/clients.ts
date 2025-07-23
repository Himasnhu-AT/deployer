import inquirer from "inquirer";
import { EC2Client, DescribeInstancesCommand } from "@aws-sdk/client-ec2";
import { RDSClient, DescribeDBInstancesCommand } from "@aws-sdk/client-rds";
import { ECSClient, ListClustersCommand } from "@aws-sdk/client-ecs";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import {
  CloudWatchClient,
  GetMetricStatisticsCommand,
  Statistic,
  StandardUnit,
} from "@aws-sdk/client-cloudwatch";

let selectedRegion = "us-east-1";

export async function selectAWSRegion() {
  const { region } = await inquirer.prompt([
    {
      type: "list",
      name: "region",
      message: "Select AWS region:",
      choices: ["us-east-1", "us-west-2", "eu-west-1", "ap-south-1"],
      default: selectedRegion,
    },
  ]);
  selectedRegion = region;
  console.log(`Selected region: ${region}`);
}

function getEC2Client() {
  return new EC2Client({ region: selectedRegion });
}
function getRDSClient() {
  return new RDSClient({ region: selectedRegion });
}
function getECSClient() {
  return new ECSClient({ region: selectedRegion });
}

async function getEC2Utilization(instanceId: string) {
  const cw = new CloudWatchClient({ region: selectedRegion });
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - 60 * 60 * 1000); // last 1 hour
  const params = {
    Namespace: "AWS/EC2",
    MetricName: "CPUUtilization",
    Dimensions: [{ Name: "InstanceId", Value: instanceId }],
    StartTime: startTime,
    EndTime: endTime,
    Period: 300,
    Statistics: [Statistic.Average],
    Unit: StandardUnit.Percent,
  };
  try {
    const res = await cw.send(new GetMetricStatisticsCommand(params));
    const datapoints = res.Datapoints || [];
    const avg = datapoints.length
      ? datapoints.reduce((a, b) => a + (b.Average || 0), 0) / datapoints.length
      : null;
    return avg !== null ? avg.toFixed(2) + "%" : "N/A";
  } catch {
    return "N/A";
  }
}

async function getRDSUtilization(dbId: string) {
  const cw = new CloudWatchClient({ region: selectedRegion });
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - 60 * 60 * 1000);
  const params = {
    Namespace: "AWS/RDS",
    MetricName: "CPUUtilization",
    Dimensions: [{ Name: "DBInstanceIdentifier", Value: dbId }],
    StartTime: startTime,
    EndTime: endTime,
    Period: 300,
    Statistics: [Statistic.Average],
    Unit: StandardUnit.Percent,
  };
  try {
    const res = await cw.send(new GetMetricStatisticsCommand(params));
    const datapoints = res.Datapoints || [];
    const avg = datapoints.length
      ? datapoints.reduce((a, b) => a + (b.Average || 0), 0) / datapoints.length
      : null;
    return avg !== null ? avg.toFixed(2) + "%" : "N/A";
  } catch {
    return "N/A";
  }
}

async function getECSUtilization(clusterArn: string) {
  // ECS utilization is more complex; for now, just show cluster name and note (detailed per-service metrics can be added)
  return "N/A";
}

export async function listAWSResources() {
  console.log(`Listing resources in region: ${selectedRegion}`);
  // List EC2 Instances
  const ec2 = getEC2Client();
  const ec2Res = await ec2.send(new DescribeInstancesCommand({}));
  const ec2InstancesRaw =
    ec2Res.Reservations?.flatMap((r: any) => r.Instances) || [];
  const ec2Instances = await Promise.all(
    ec2InstancesRaw.map(async (inst: any) => ({
      InstanceId: inst.InstanceId,
      State: inst.State?.Name,
      Type: inst.InstanceType,
      Name: inst.Tags?.find((t: any) => t.Key === "Name")?.Value || "",
      PublicIp: inst.PublicIpAddress || "",
      PrivateIp: inst.PrivateIpAddress || "",
      AZ: inst.Placement?.AvailabilityZone || "",
      KeyName: inst.KeyName || "",
      CPU: await getEC2Utilization(inst.InstanceId),
    }))
  );
  if (ec2Instances.length) {
    console.log("\nEC2 Instances:");
    console.table(ec2Instances);
  } else {
    console.log("\nNo EC2 Instances found.");
  }

  // List RDS Instances
  const rds = getRDSClient();
  const rdsRes = await rds.send(new DescribeDBInstancesCommand({}));
  const rdsInstancesRaw = rdsRes.DBInstances || [];
  const rdsInstances = await Promise.all(
    rdsInstancesRaw.map(async (db: any) => ({
      DBInstanceIdentifier: db.DBInstanceIdentifier,
      Engine: db.Engine,
      Status: db.DBInstanceStatus,
      Class: db.DBInstanceClass,
      Endpoint: db.Endpoint?.Address || "",
      AZ: db.AvailabilityZone || "",
      CPU: await getRDSUtilization(db.DBInstanceIdentifier),
    }))
  );
  if (rdsInstances.length) {
    console.log("\nRDS Instances:");
    console.table(rdsInstances);
  } else {
    console.log("\nNo RDS Instances found.");
  }

  // List ECS Clusters
  const ecs = getECSClient();
  const ecsRes = await ecs.send(new ListClustersCommand({}));
  const ecsClusters = ecsRes.clusterArns || [];
  if (ecsClusters.length) {
    console.log("\nECS Clusters:");
    for (let i = 0; i < ecsClusters.length; i++) {
      const arn = ecsClusters[i];
      const util = await getECSUtilization(arn);
      console.log(`  [${i + 1}] ${arn} (CPU: ${util})`);
    }
  } else {
    console.log("\nNo ECS Clusters found.");
  }
}

export async function checkAWSCredentials(): Promise<boolean> {
  try {
    const sts = new STSClient({ region: selectedRegion });
    await sts.send(new GetCallerIdentityCommand({}));
    return true;
  } catch (err) {
    return false;
  }
}

export async function getAllEC2Instances() {
  const ec2 = getEC2Client();
  const ec2Res = await ec2.send(new DescribeInstancesCommand({}));
  return (ec2Res.Reservations?.flatMap((r: any) => r.Instances) || [])
    .filter((inst: any) => inst.State?.Name === "running")
    .map((inst: any) => ({
      InstanceId: inst.InstanceId,
      Name: inst.Tags?.find((t: any) => t.Key === "Name")?.Value || "",
      InstanceType: inst.InstanceType,
    }));
}

async function getEC2MemoryUtilization(instanceId: string) {
  // AWS does not provide memory metrics by default; requires CloudWatch agent
  // We'll try to fetch it, but may return N/A if not available
  const cw = new CloudWatchClient({ region: selectedRegion });
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - 5 * 60 * 1000); // last 5 min
  const params = {
    Namespace: "CWAgent",
    MetricName: "mem_used_percent",
    Dimensions: [{ Name: "InstanceId", Value: instanceId }],
    StartTime: startTime,
    EndTime: endTime,
    Period: 60,
    Statistics: [Statistic.Average],
    Unit: StandardUnit.Percent,
  };
  try {
    const res = await cw.send(new GetMetricStatisticsCommand(params));
    const datapoints = res.Datapoints || [];
    const avg = datapoints.length
      ? datapoints.reduce((a, b) => a + (b.Average || 0), 0) / datapoints.length
      : null;
    return avg !== null ? avg.toFixed(2) + "%" : "N/A";
  } catch {
    return "N/A";
  }
}

async function getEC2NetworkIn(instanceId: string) {
  const cw = new CloudWatchClient({ region: selectedRegion });
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - 5 * 60 * 1000); // last 5 min
  const params = {
    Namespace: "AWS/EC2",
    MetricName: "NetworkIn",
    Dimensions: [{ Name: "InstanceId", Value: instanceId }],
    StartTime: startTime,
    EndTime: endTime,
    Period: 60,
    Statistics: [Statistic.Average],
    Unit: StandardUnit.Bytes,
  };
  try {
    const res = await cw.send(new GetMetricStatisticsCommand(params));
    const datapoints = res.Datapoints || [];
    const avg = datapoints.length
      ? datapoints.reduce((a, b) => a + (b.Average || 0), 0) / datapoints.length
      : null;
    return avg !== null ? (avg / 1024).toFixed(2) + " KB/s" : "N/A";
  } catch {
    return "N/A";
  }
}

async function getEC2NetworkOut(instanceId: string) {
  const cw = new CloudWatchClient({ region: selectedRegion });
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - 5 * 60 * 1000); // last 5 min
  const params = {
    Namespace: "AWS/EC2",
    MetricName: "NetworkOut",
    Dimensions: [{ Name: "InstanceId", Value: instanceId }],
    StartTime: startTime,
    EndTime: endTime,
    Period: 60,
    Statistics: [Statistic.Average],
    Unit: StandardUnit.Bytes,
  };
  try {
    const res = await cw.send(new GetMetricStatisticsCommand(params));
    const datapoints = res.Datapoints || [];
    const avg = datapoints.length
      ? datapoints.reduce((a, b) => a + (b.Average || 0), 0) / datapoints.length
      : null;
    return avg !== null ? (avg / 1024).toFixed(2) + " KB/s" : "N/A";
  } catch {
    return "N/A";
  }
}

export async function getAllRDSInstances() {
  const rds = getRDSClient();
  const rdsRes = await rds.send(new DescribeDBInstancesCommand({}));
  return (rdsRes.DBInstances || []).map((db: any) => ({
    DBInstanceIdentifier: db.DBInstanceIdentifier,
    Engine: db.Engine,
  }));
}

export async function getAllECSClusters() {
  const ecs = getECSClient();
  const ecsRes = await ecs.send(new ListClustersCommand({}));
  return ecsRes.clusterArns || [];
}

export async function showEC2Metrics(instanceId: string) {
  console.log(`\nStreaming live metrics for EC2 Instance: ${instanceId}`);
  let running = true;
  const interval = setInterval(async () => {
    const cpu = await getEC2Utilization(instanceId);
    const mem = await getEC2MemoryUtilization(instanceId);
    const netIn = await getEC2NetworkIn(instanceId);
    const netOut = await getEC2NetworkOut(instanceId);
    console.clear();
    console.log(`Live metrics for EC2 Instance: ${instanceId}`);
    console.table([
      { Metric: "CPU Utilization", Value: cpu },
      { Metric: "Memory Utilization", Value: mem },
      { Metric: "Network In", Value: netIn },
      { Metric: "Network Out", Value: netOut },
    ]);
    console.log("Press Ctrl+C to exit.");
  }, 4000);
  process.on("SIGINT", () => {
    if (running) {
      clearInterval(interval);
      running = false;
      console.log("\nStopped streaming metrics.");
      process.exit(0);
    }
  });
}

export async function showRDSMetrics(dbId: string) {
  console.log(`\nLive metrics for RDS Instance: ${dbId}`);
  const cpu = await getRDSUtilization(dbId);
  console.log(`CPU Utilization (avg, last hour): ${cpu}`);
  // Add more metrics as needed
}

export async function showECSMetrics(clusterArn: string) {
  console.log(`\nLive metrics for ECS Cluster: ${clusterArn}`);
  // ECS metrics can be expanded to per-service/task metrics
  console.log("CPU Utilization: N/A");
}
