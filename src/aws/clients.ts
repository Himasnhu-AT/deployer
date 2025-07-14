import inquirer from "inquirer";
import { EC2Client, DescribeInstancesCommand } from "@aws-sdk/client-ec2";
import { RDSClient, DescribeDBInstancesCommand } from "@aws-sdk/client-rds";
import { ECSClient, ListClustersCommand } from "@aws-sdk/client-ecs";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";

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

export async function listAWSResources() {
  console.log(`Listing resources in region: ${selectedRegion}`);
  // List EC2 Instances
  const ec2 = getEC2Client();
  const ec2Res = await ec2.send(new DescribeInstancesCommand({}));
  const ec2Instances = (
    ec2Res.Reservations?.flatMap((r: any) => r.Instances) || []
  ).map((inst: any) => ({
    InstanceId: inst.InstanceId,
    State: inst.State?.Name,
    Type: inst.InstanceType,
    Name: inst.Tags?.find((t: any) => t.Key === "Name")?.Value || "",
    PublicIp: inst.PublicIpAddress || "",
    PrivateIp: inst.PrivateIpAddress || "",
    AZ: inst.Placement?.AvailabilityZone || "",
    KeyName: inst.KeyName || "",
  }));
  if (ec2Instances.length) {
    console.log("\nEC2 Instances:");
    console.table(ec2Instances);
  } else {
    console.log("\nNo EC2 Instances found.");
  }

  // List RDS Instances
  const rds = getRDSClient();
  const rdsRes = await rds.send(new DescribeDBInstancesCommand({}));
  const rdsInstances = (rdsRes.DBInstances || []).map((db: any) => ({
    DBInstanceIdentifier: db.DBInstanceIdentifier,
    Engine: db.Engine,
    Status: db.DBInstanceStatus,
    Class: db.DBInstanceClass,
    Endpoint: db.Endpoint?.Address || "",
    AZ: db.AvailabilityZone || "",
  }));
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
    ecsClusters.forEach((arn: string, i: number) => {
      console.log(`  [${i + 1}] ${arn}`);
    });
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
