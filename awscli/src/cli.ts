#!/usr/bin/env node
import inquirer from "inquirer";
import {
  listAWSResources,
  selectAWSRegion,
  checkAWSCredentials,
  getAllEC2Instances,
  getAllRDSInstances,
  getAllECSClusters,
  showEC2Metrics,
  showRDSMetrics,
  showECSMetrics,
} from "./aws/clients.js";
import { buildAndPushDockerImage } from "./docker/dockerBuilder.js";

async function main() {
  console.log("Welcome to the Deployer CLI!");
  const credsOk = await checkAWSCredentials();
  if (!credsOk) {
    console.error(
      "❌ AWS credentials are not valid or not configured. Please run `aws configure` or set your AWS credentials."
    );
    process.exit(1);
  }
  const { action } = await inquirer.prompt([
    {
      type: "list",
      name: "action",
      message: "What would you like to do?",
      choices: [
        "Choose AWS Region",
        "List AWS Resources",
        "Show Resource Utilization",
        "Build & Push Docker Image",
        "Exit",
      ],
    },
  ]);

  switch (action) {
    case "Choose AWS Region":
      await selectAWSRegion();
      break;
    case "List AWS Resources":
      await listAWSResources();
      break;
    case "Show Resource Utilization": {
      const { resourceType } = await inquirer.prompt([
        {
          type: "list",
          name: "resourceType",
          message: "Which resource type do you want to view?",
          choices: ["EC2", "RDS", "ECS", "Back"],
        },
      ]);
      if (resourceType === "Back") break;
      if (resourceType === "EC2") {
        const ec2s = await getAllEC2Instances();
        if (!ec2s.length) {
          console.log("No EC2 instances found.");
          break;
        }
        const { instanceId } = await inquirer.prompt([
          {
            type: "list",
            name: "instanceId",
            message: "Select EC2 instance:",
            choices: ec2s.map((i: any) => ({
              name: `${i.InstanceId} (${i.Name || i.InstanceType})`,
              value: i.InstanceId,
            })),
          },
        ]);
        await showEC2Metrics(instanceId);
      } else if (resourceType === "RDS") {
        const rds = await getAllRDSInstances();
        if (!rds.length) {
          console.log("No RDS instances found.");
          break;
        }
        const { dbId } = await inquirer.prompt([
          {
            type: "list",
            name: "dbId",
            message: "Select RDS instance:",
            choices: rds.map((db: any) => ({
              name: `${db.DBInstanceIdentifier} (${db.Engine})`,
              value: db.DBInstanceIdentifier,
            })),
          },
        ]);
        await showRDSMetrics(dbId);
      } else if (resourceType === "ECS") {
        const ecs = await getAllECSClusters();
        if (!ecs.length) {
          console.log("No ECS clusters found.");
          break;
        }
        const { clusterArn } = await inquirer.prompt([
          {
            type: "list",
            name: "clusterArn",
            message: "Select ECS cluster:",
            choices: ecs.map((arn: string) => ({ name: arn, value: arn })),
          },
        ]);
        await showECSMetrics(clusterArn);
      }
      break;
    }
    case "Build & Push Docker Image":
      await buildAndPushDockerImage();
      break;
    case "Exit":
      console.log("Goodbye!");
      process.exit(0);
  }
}

main();
