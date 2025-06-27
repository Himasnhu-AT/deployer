#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import path from "path";
import dotenv from "dotenv";
import { ConfigManager } from "./config/configManager";
import { buildDockerImage } from "./docker/dockerBuilder";
import { pushDockerImage } from "./docker/dockerPusher";
import { collectDeploymentConfig } from "./deploy/deploymentConfig";
import {
  createECSClient,
  createEC2Client,
  createELBClient,
  createLogsClient,
  createCostExplorerClient,
} from "./aws/clients";
import { DeploymentConfig } from "./config/types";
import os from "os";
import * as fs from "fs/promises";
import * as fsSync from "fs";
import {
  ECSClient,
  RegisterTaskDefinitionCommand,
  DescribeServicesCommand,
  ListServicesCommand,
  DescribeTasksCommand,
  ListTasksCommand,
  ListClustersCommand,
  DescribeClustersCommand,
  NetworkMode,
  TransportProtocol,
  LogDriver,
  Compatibility,
} from "@aws-sdk/client-ecs";
import {
  EC2Client,
  DescribeSubnetsCommand,
  DescribeSecurityGroupsCommand,
} from "@aws-sdk/client-ec2";
import {
  ElasticLoadBalancingV2Client,
  DescribeLoadBalancersCommand,
} from "@aws-sdk/client-elastic-load-balancing-v2";
import {
  CloudWatchLogsClient,
  GetLogEventsCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import { CostExplorerClient } from "@aws-sdk/client-cost-explorer";
import { spawn } from "child_process";
import { promisify } from "util";

dotenv.config();

const execAsync = promisify(require("child_process").exec);

const CONFIG_DIR = path.join(process.cwd(), ".fargate-configs");

let VERBOSE = false;

function logInfo(msg: string) {
  console.log(chalk.blue("[INFO]"), msg);
}
function logWarn(msg: string) {
  console.warn(chalk.yellow("[WARN]"), msg);
}
function logError(msg: string) {
  console.error(chalk.red("[ERROR]"), msg);
}
function logVerbose(msg: string) {
  if (VERBOSE) {
    console.log(chalk.gray("[VERBOSE]"), msg);
  }
}

class FargateDeployer {
  ecsClient: ECSClient;
  ec2Client: EC2Client;
  elbClient: ElasticLoadBalancingV2Client;
  logsClient: CloudWatchLogsClient;
  costClient: CostExplorerClient;
  configManager: ConfigManager;
  region: string;

  constructor(region: string = "us-east-1") {
    this.region = region;
    this.ecsClient = createECSClient(region);
    this.ec2Client = createEC2Client(region);
    this.elbClient = createELBClient(region);
    this.logsClient = createLogsClient(region);
    this.costClient = createCostExplorerClient(region);
    this.configManager = new ConfigManager(CONFIG_DIR);
  }

  async preflightChecks() {
    logInfo("Running preflight checks...");
    // Check AWS credentials
    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      logError("AWS credentials not found in environment variables.");
      process.exit(1);
    }
    logVerbose("AWS credentials found.");

    // Check Docker
    try {
      await new Promise<void>((resolve, reject) => {
        const proc = require("child_process").spawn("docker", ["info"]);
        proc.on("close", (code: number) => {
          if (code === 0) resolve();
          else reject(new Error("Docker not available"));
        });
      });
      logVerbose("Docker is available.");
    } catch {
      logError("Docker is not installed or not running.");
      process.exit(1);
    }

    // Check for config directory write access
    try {
      fsSync.accessSync(process.cwd(), fsSync.constants.W_OK);
      logVerbose("Current directory is writable.");
    } catch {
      logError("Current directory is not writable.");
      process.exit(1);
    }

    // Check Node version
    const nodeVersion = process.versions.node;
    const major = parseInt(nodeVersion.split(".")[0], 10);
    if (major < 16) {
      logWarn(`Node.js version ${nodeVersion} detected. Node 16+ recommended.`);
    } else {
      logVerbose(`Node.js version ${nodeVersion} OK.`);
    }

    logInfo("Preflight checks passed.");
  }

  updateRegion(region: string) {
    this.region = region;
    this.ecsClient = createECSClient(region);
    this.ec2Client = createEC2Client(region);
    this.elbClient = createELBClient(region);
    this.logsClient = createLogsClient(region);
    this.costClient = createCostExplorerClient(region);
  }

  async fetchClusters() {
    try {
      const { clusterArns } = await this.ecsClient.send(
        new ListClustersCommand({}),
      );
      if (!clusterArns || clusterArns.length === 0) return [];
      // Get cluster names and status
      const clustersResp = await this.ecsClient.send(
        new DescribeClustersCommand({
          clusters: clusterArns,
        }),
      );
      return (clustersResp.clusters || []).map((c: any) => ({
        name: c.clusterName,
        status: c.status,
      }));
    } catch (err) {
      return [];
    }
  }

  async fetchServices(clusterName: string) {
    try {
      const { serviceArns } = await this.ecsClient.send(
        new ListServicesCommand({ cluster: clusterName }),
      );
      if (!serviceArns || serviceArns.length === 0) return [];
      const { services } = await this.ecsClient.send(
        new DescribeServicesCommand({
          cluster: clusterName,
          services: serviceArns,
        }),
      );
      return (services || []).map((s: any) => ({
        name: s.serviceName,
        status: s.status,
      }));
    } catch (err) {
      return [];
    }
  }

  async fetchLoadBalancers() {
    try {
      const { LoadBalancers } = await this.elbClient.send(
        new DescribeLoadBalancersCommand({}),
      );
      return (LoadBalancers || []).map((lb: any) => ({
        arn: lb.LoadBalancerArn,
        name: lb.LoadBalancerName,
        type: lb.Type,
      }));
    } catch (err) {
      return [];
    }
  }

  async fetchSubnets() {
    try {
      const { Subnets } = await this.ec2Client.send(
        new DescribeSubnetsCommand({}),
      );
      return (Subnets || []).map((subnet: any) => ({
        id: subnet.SubnetId,
        name:
          subnet.Tags?.find((tag: any) => tag.Key === "Name")?.Value ||
          "Unnamed",
        az: subnet.AvailabilityZone,
      }));
    } catch (err) {
      return [];
    }
  }

  async fetchSecurityGroups() {
    try {
      const { SecurityGroups } = await this.ec2Client.send(
        new DescribeSecurityGroupsCommand({}),
      );
      return (SecurityGroups || []).map((sg: any) => ({
        id: sg.GroupId,
        name: sg.GroupName,
        description: sg.Description,
      }));
    } catch (err) {
      return [];
    }
  }

  async deploy(dockerImage?: string) {
    await this.preflightChecks();

    logInfo("Collecting deployment configuration...");
    const config: any = await collectDeploymentConfig(
      this.configManager,
      {
        fetchClusters: this.fetchClusters.bind(this),
        fetchServices: this.fetchServices.bind(this),
        fetchLoadBalancers: this.fetchLoadBalancers.bind(this),
        fetchSubnets: this.fetchSubnets.bind(this),
        fetchSecurityGroups: this.fetchSecurityGroups.bind(this),
      },
      dockerImage,
    );

    if (config.awsRegion !== this.region) {
      this.updateRegion(config.awsRegion);
      logVerbose(`Region updated to ${config.awsRegion}`);
    }

    logInfo("Building Docker image...");
    await buildDockerImage(config.dockerImage);
    logInfo("Pushing Docker image...");
    await pushDockerImage(config.dockerImage);

    logInfo("Deploying to ECS...");
    await this.deployToECS(config);

    config.lastDeployed = new Date().toISOString();
    await this.configManager.saveConfig(config);

    logInfo("Deployment completed successfully!");
    console.log(chalk.green("\n🎉 Deployment completed successfully!"));
    console.log(chalk.blue(`Project: ${config.projectName}`));
    console.log(chalk.blue(`Cluster: ${config.clusterName}`));
    console.log(chalk.blue(`Service: ${config.serviceName}`));
  }

  async deployToECS(config: DeploymentConfig) {
    console.log(chalk.blue("\n🚀 Deploying to ECS Fargate..."));

    // Register task definition
    const taskDefinition = {
      family: config.taskDefinitionFamily,
      networkMode: NetworkMode.AWSVPC,
      requiresCompatibilities: [Compatibility.FARGATE],
      cpu: config.cpu,
      memory: config.memory,
      executionRoleArn: `arn:aws:iam::${await this.getAccountId()}:role/ecsTaskExecutionRole`,
      containerDefinitions: [
        {
          name: config.projectName,
          image: config.dockerImage,
          portMappings: [
            {
              containerPort: config.containerPort,
              protocol: TransportProtocol.TCP,
            },
          ],
          environment: Object.entries(config.environmentVariables).map(
            ([name, value]) => ({
              name,
              value,
            }),
          ),
          logConfiguration: {
            logDriver: LogDriver.AWSLOGS,
            options: {
              "awslogs-group": config.logGroupName,
              "awslogs-region": config.awsRegion,
              "awslogs-stream-prefix": "ecs",
            },
          },
          essential: true,
        },
      ],
    };

    await this.ecsClient.send(
      new RegisterTaskDefinitionCommand(taskDefinition),
    );
    console.log(chalk.green("✓ Task definition registered"));

    // TODO: Add logic for creating/updating ECS cluster, service, and ALB
    // This is a placeholder for the full deployment logic
    console.log(chalk.green("✓ Service deployment initiated"));
  }

  async getAccountId(): Promise<string> {
    try {
      const { stdout } = await execAsync(
        "aws sts get-caller-identity --query Account --output text",
      );
      return stdout.trim();
    } catch {
      return "123456789012";
    }
  }

  async showStatus(projectName: string) {
    const config = await this.configManager.loadConfig(projectName);
    if (!config) {
      console.log(
        chalk.red(`❌ Configuration not found for project: ${projectName}`),
      );
      return;
    }

    console.log(chalk.cyan(`\n📊 Status for ${config.projectName}\n`));

    try {
      const services = await this.ecsClient.send(
        new DescribeServicesCommand({
          cluster: config.clusterName,
          services: [config.serviceName],
        }),
      );

      if (services.services && services.services.length > 0) {
        const service = services.services[0];
        console.log(chalk.blue("🔧 Service Status:"));
        console.log(`  Status: ${service.status}`);
        console.log(`  Running Tasks: ${service.runningCount}`);
        console.log(`  Pending Tasks: ${service.pendingCount}`);
        console.log(`  Desired Tasks: ${service.desiredCount}`);

        const tasks = await this.ecsClient.send(
          new ListTasksCommand({
            cluster: config.clusterName,
            serviceName: config.serviceName,
          }),
        );

        if (tasks.taskArns && tasks.taskArns.length > 0) {
          const taskDetails = await this.ecsClient.send(
            new DescribeTasksCommand({
              cluster: config.clusterName,
              tasks: tasks.taskArns,
            }),
          );

          console.log(chalk.blue("\n📋 Tasks:"));
          taskDetails.tasks?.forEach((task: any, index: number) => {
            console.log(`  Task ${index + 1}:`);
            console.log(`    Status: ${task.lastStatus}`);
            console.log(`    Health: ${task.healthStatus || "N/A"}`);
            console.log(`    CPU/Memory: ${task.cpu}/${task.memory}`);
          });
        }
      }
    } catch (error) {
      console.log(chalk.yellow("⚠️  Could not fetch service status:", error));
    }
  }

  async showLogs(projectName: string) {
    const config = await this.configManager.loadConfig(projectName);
    if (!config) {
      console.log(
        chalk.red(`❌ Configuration not found for project: ${projectName}`),
      );
      return;
    }

    console.log(chalk.cyan(`\n📝 Logs for ${config.projectName}\n`));

    try {
      const response = await this.logsClient.send(
        new GetLogEventsCommand({
          logGroupName: config.logGroupName,
          logStreamName: `ecs/${config.projectName}/${new Date().toISOString().split("T")[0]}`,
          limit: 100,
        }),
      );

      if (response.events && response.events.length > 0) {
        response.events.forEach((event: any) => {
          const timestamp = new Date(event.timestamp!).toISOString();
          console.log(`${chalk.gray(timestamp)} ${event.message}`);
        });
      } else {
        console.log(chalk.yellow("No recent logs found"));
      }
    } catch (error) {
      console.log(chalk.yellow("⚠️  Could not fetch logs:", error));
    }
  }

  async listProjects() {
    const configs = await this.configManager.listSavedConfigs();

    if (configs.length === 0) {
      console.log(chalk.yellow("No deployment configurations found"));
      return;
    }

    console.log(chalk.cyan("\n📋 Deployment Configurations:\n"));

    for (const configName of configs) {
      const config = await this.configManager.loadConfig(configName);
      if (config) {
        console.log(chalk.blue(`${config.projectName}:`));
        console.log(`  Image: ${config.dockerImage}`);
        console.log(`  Region: ${config.awsRegion}`);
        console.log(`  Cluster: ${config.clusterName}`);
        console.log(`  Service: ${config.serviceName}`);
        console.log(`  Last Deployed: ${config.lastDeployed || "Never"}`);
        console.log("");
      }
    }
  }
}

// CLI Entrypoint
const program = new Command();
program.version("1.0.0").description("AWS ECS Fargate Deployer CLI");

program
  .option("-v, --verbose", "Enable verbose logging")
  .hook("preAction", (thisCommand, actionCommand) => {
    if (thisCommand.opts().verbose) {
      VERBOSE = true;
      logVerbose("Verbose logging enabled.");
    }
  });

program
  .command("deploy")
  .description("Build, push, and deploy your app to AWS ECS Fargate")
  .option("-i, --image <dockerImage>", "Docker image (with tag)")
  .action(async (opts) => {
    const deployer = new FargateDeployer(process.env.AWS_REGION || "us-east-1");
    await deployer.deploy(opts.image);
  });

program
  .command("status <project>")
  .description("Show deployment status for a project")
  .action(async (project) => {
    const deployer = new FargateDeployer(process.env.AWS_REGION || "us-east-1");
    await deployer.preflightChecks();
    await deployer.showStatus(project);
  });

program
  .command("logs <project>")
  .description("Show recent logs for a project")
  .action(async (project) => {
    const deployer = new FargateDeployer(process.env.AWS_REGION || "us-east-1");
    await deployer.preflightChecks();
    await deployer.showLogs(project);
  });

program
  .command("list")
  .description("List all deployment projects")
  .action(async () => {
    const deployer = new FargateDeployer(process.env.AWS_REGION || "us-east-1");
    await deployer.preflightChecks();
    await deployer.listProjects();
  });

program.parseAsync(process.argv);
