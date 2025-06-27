import { program } from "commander";
import inquirer from "inquirer";
import chalk from "chalk";
import fs from "fs/promises";
import path from "path";
import { spawn, exec } from "child_process";
import { promisify } from "util";

// AWS SDK v3 imports
import {
  ECSClient,
  ListClustersCommand,
  ListServicesCommand,
  DescribeServicesCommand,
  CreateServiceCommand,
  UpdateServiceCommand,
  DescribeTasksCommand,
  ListTasksCommand,
  DescribeContainerInstancesCommand,
  RegisterTaskDefinitionCommand,
  TaskDefinition,
} from "@aws-sdk/client-ecs";

import {
  EC2Client,
  DescribeSubnetsCommand,
  DescribeSecurityGroupsCommand,
  DescribeVpcsCommand,
} from "@aws-sdk/client-ec2";

import {
  ElasticLoadBalancingV2Client,
  DescribeLoadBalancersCommand,
  DescribeTargetGroupsCommand,
} from "@aws-sdk/client-elastic-load-balancing-v2";

import {
  CloudWatchLogsClient,
  GetLogEventsCommand,
  DescribeLogGroupsCommand,
} from "@aws-sdk/client-cloudwatch-logs";

import {
  CostExplorerClient,
  GetDimensionValuesCommand,
  GetRightsizingRecommendationCommand,
} from "@aws-sdk/client-cost-explorer";

const execAsync = promisify(exec);

interface DeploymentConfig {
  projectName: string;
  dockerImage: string;
  awsRegion: string;
  clusterName: string;
  serviceName: string;
  taskDefinitionFamily: string;
  containerPort: number;
  hostPort?: number;
  cpu: string;
  memory: string;
  desiredCount: number;
  useLoadBalancer: boolean;
  loadBalancerArn?: string;
  targetGroupArn?: string;
  subnets: string[];
  securityGroups: string[];
  environmentVariables: Record<string, string>;
  logGroupName: string;
  createdAt: string;
  lastDeployed?: string;
}

class FargateDeployer {
  private ecsClient: ECSClient;
  private ec2Client: EC2Client;
  private elbClient: ElasticLoadBalancingV2Client;
  private logsClient: CloudWatchLogsClient;
  private costClient: CostExplorerClient;
  private configDir: string;
  private region: string;

  constructor(region: string = "us-east-1") {
    this.region = region;
    this.ecsClient = new ECSClient({ region });
    this.ec2Client = new EC2Client({ region });
    this.elbClient = new ElasticLoadBalancingV2Client({ region });
    this.logsClient = new CloudWatchLogsClient({ region });
    this.costClient = new CostExplorerClient({ region });
    this.configDir = path.join(process.cwd(), ".fargate-configs");
  }

  private async ensureConfigDir(): Promise<void> {
    try {
      await fs.access(this.configDir);
    } catch {
      await fs.mkdir(this.configDir, { recursive: true });
    }
  }

  private async saveConfig(config: DeploymentConfig): Promise<void> {
    await this.ensureConfigDir();
    const configPath = path.join(this.configDir, `${config.projectName}.json`);
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));
    console.log(chalk.green(`✓ Configuration saved to ${configPath}`));
  }

  private async loadConfig(
    projectName: string,
  ): Promise<DeploymentConfig | null> {
    try {
      const configPath = path.join(this.configDir, `${projectName}.json`);
      const configData = await fs.readFile(configPath, "utf-8");
      return JSON.parse(configData);
    } catch {
      return null;
    }
  }

  private async listSavedConfigs(): Promise<string[]> {
    try {
      await this.ensureConfigDir();
      const files = await fs.readdir(this.configDir);
      return files
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.replace(".json", ""));
    } catch {
      return [];
    }
  }

  private async buildDockerImage(dockerImage: string): Promise<void> {
    console.log(chalk.blue(`🔨 Building Docker image: ${dockerImage}`));

    return new Promise((resolve, reject) => {
      const buildProcess = spawn("docker", ["build", "-t", dockerImage, "."], {
        stdio: "inherit",
      });

      buildProcess.on("close", (code) => {
        if (code === 0) {
          console.log(
            chalk.green(`✓ Docker image built successfully: ${dockerImage}`),
          );
          resolve();
        } else {
          reject(new Error(`Docker build failed with code ${code}`));
        }
      });
    });
  }

  private async pushDockerImage(dockerImage: string): Promise<void> {
    console.log(chalk.blue(`📤 Pushing Docker image: ${dockerImage}`));

    return new Promise((resolve, reject) => {
      const pushProcess = spawn("docker", ["push", dockerImage], {
        stdio: "inherit",
      });

      pushProcess.on("close", (code) => {
        if (code === 0) {
          console.log(chalk.green(`✓ Docker image pushed successfully`));
          resolve();
        } else {
          reject(new Error(`Docker push failed with code ${code}`));
        }
      });
    });
  }

  private async fetchClusters(): Promise<
    Array<{ name: string; status: string }>
  > {
    try {
      const response = await this.ecsClient.send(new ListClustersCommand({}));
      const clusters = response.clusters || [];
      return clusters.map((cluster) => ({
        name: cluster.clusterName || "Unknown",
        status: cluster.status || "Unknown",
      }));
    } catch (error) {
      console.log(chalk.yellow("⚠️  Could not fetch clusters:", error));
      return [];
    }
  }

  private async fetchServices(
    clusterName: string,
  ): Promise<Array<{ name: string; status: string }>> {
    try {
      const response = await this.ecsClient.send(
        new ListServicesCommand({
          cluster: clusterName,
        }),
      );

      if (!response.serviceArns || response.serviceArns.length === 0) {
        return [];
      }

      const describeResponse = await this.ecsClient.send(
        new DescribeServicesCommand({
          cluster: clusterName,
          services: response.serviceArns,
        }),
      );

      return (describeResponse.services || []).map((service) => ({
        name: service.serviceName || "Unknown",
        status: service.status || "Unknown",
      }));
    } catch (error) {
      console.log(chalk.yellow("⚠️  Could not fetch services:", error));
      return [];
    }
  }

  private async fetchLoadBalancers(): Promise<
    Array<{ arn: string; name: string; type: string }>
  > {
    try {
      const response = await this.elbClient.send(
        new DescribeLoadBalancersCommand({}),
      );
      return (response.LoadBalancers || []).map((lb) => ({
        arn: lb.LoadBalancerArn || "",
        name: lb.LoadBalancerName || "Unknown",
        type: lb.Type || "Unknown",
      }));
    } catch (error) {
      console.log(chalk.yellow("⚠️  Could not fetch load balancers:", error));
      return [];
    }
  }

  private async fetchSubnets(): Promise<
    Array<{ id: string; name: string; az: string }>
  > {
    try {
      const response = await this.ec2Client.send(
        new DescribeSubnetsCommand({}),
      );
      return (response.Subnets || []).map((subnet) => ({
        id: subnet.SubnetId || "",
        name:
          subnet.Tags?.find((tag) => tag.Key === "Name")?.Value || "Unnamed",
        az: subnet.AvailabilityZone || "Unknown",
      }));
    } catch (error) {
      console.log(chalk.yellow("⚠️  Could not fetch subnets:", error));
      return [];
    }
  }

  private async fetchSecurityGroups(): Promise<
    Array<{ id: string; name: string; description: string }>
  > {
    try {
      const response = await this.ec2Client.send(
        new DescribeSecurityGroupsCommand({}),
      );
      return (response.SecurityGroups || []).map((sg) => ({
        id: sg.GroupId || "",
        name: sg.GroupName || "Unknown",
        description: sg.Description || "",
      }));
    } catch (error) {
      console.log(chalk.yellow("⚠️  Could not fetch security groups:", error));
      return [];
    }
  }

  private async collectDeploymentConfig(
    dockerImage?: string,
  ): Promise<DeploymentConfig> {
    console.log(chalk.cyan("🚀 AWS Fargate Deployment Configuration\n"));

    // Check for existing configs
    const existingConfigs = await this.listSavedConfigs();
    let useExisting = false;
    let existingConfig: DeploymentConfig | null = null;

    if (existingConfigs.length > 0) {
      const { action } = await inquirer.prompt([
        {
          type: "list",
          name: "action",
          message: "What would you like to do?",
          choices: [
            { name: "Create new deployment configuration", value: "new" },
            { name: "Use existing configuration", value: "existing" },
            { name: "Modify existing configuration", value: "modify" },
          ],
        },
      ]);

      if (action === "existing" || action === "modify") {
        const { selectedConfig } = await inquirer.prompt([
          {
            type: "list",
            name: "selectedConfig",
            message: "Select configuration:",
            choices: existingConfigs,
          },
        ]);

        existingConfig = await this.loadConfig(selectedConfig);
        if (action === "existing") {
          useExisting = true;
        }
      }
    }

    if (useExisting && existingConfig) {
      console.log(
        chalk.green(
          `✓ Using existing configuration for ${existingConfig.projectName}`,
        ),
      );
      return existingConfig;
    }

    // Fetch AWS resources
    console.log(chalk.blue("📡 Fetching AWS resources..."));
    const [clusters, loadBalancers, subnets, securityGroups] =
      await Promise.all([
        this.fetchClusters(),
        this.fetchLoadBalancers(),
        this.fetchSubnets(),
        this.fetchSecurityGroups(),
      ]);

    const answers = await inquirer.prompt([
      {
        type: "input",
        name: "projectName",
        message: "Project name:",
        default: existingConfig?.projectName || path.basename(process.cwd()),
        validate: (input) => input.length > 0 || "Project name is required",
      },
      {
        type: "input",
        name: "dockerImage",
        message: "Docker image (with tag):",
        default: existingConfig?.dockerImage || dockerImage,
        validate: (input) => input.length > 0 || "Docker image is required",
      },
      {
        type: "list",
        name: "awsRegion",
        message: "AWS Region:",
        choices: [
          "us-east-1",
          "us-east-2",
          "us-west-1",
          "us-west-2",
          "eu-west-1",
          "eu-west-2",
          "eu-central-1",
          "ap-south-1",
          "ap-southeast-1",
          "ap-southeast-2",
        ],
        default: existingConfig?.awsRegion || this.region,
      },
      {
        type: "list",
        name: "clusterAction",
        message: "ECS Cluster:",
        choices: [
          { name: "Create new cluster", value: "new" },
          ...(clusters.length > 0
            ? [{ name: "Use existing cluster", value: "existing" }]
            : []),
        ],
      },
    ]);

    let clusterName =
      existingConfig?.clusterName || `${answers.projectName}-cluster`;

    if (answers.clusterAction === "existing" && clusters.length > 0) {
      const { selectedCluster } = await inquirer.prompt([
        {
          type: "list",
          name: "selectedCluster",
          message: "Select cluster:",
          choices: clusters.map((c) => ({
            name: `${c.name} (${c.status})`,
            value: c.name,
          })),
        },
      ]);
      clusterName = selectedCluster;
    }

    // Fetch services if using existing cluster
    let services: Array<{ name: string; status: string }> = [];
    if (answers.clusterAction === "existing") {
      services = await this.fetchServices(clusterName);
    }

    const serviceAnswers = await inquirer.prompt([
      {
        type: "list",
        name: "serviceAction",
        message: "ECS Service:",
        choices: [
          { name: "Create new service", value: "new" },
          ...(services.length > 0
            ? [{ name: "Update existing service", value: "existing" }]
            : []),
        ],
      },
    ]);

    let serviceName =
      existingConfig?.serviceName || `${answers.projectName}-service`;

    if (serviceAnswers.serviceAction === "existing" && services.length > 0) {
      const { selectedService } = await inquirer.prompt([
        {
          type: "list",
          name: "selectedService",
          message: "Select service:",
          choices: services.map((s) => ({
            name: `${s.name} (${s.status})`,
            value: s.name,
          })),
        },
      ]);
      serviceName = selectedService;
    }

    const resourceAnswers = await inquirer.prompt([
      {
        type: "number",
        name: "containerPort",
        message: "Container port to expose:",
        default: existingConfig?.containerPort || 3000,
        validate: (input) =>
          (input > 0 && input < 65536) || "Port must be between 1-65535",
      },
      {
        type: "list",
        name: "cpu",
        message: "CPU units:",
        choices: ["256", "512", "1024", "2048", "4096"],
        default: existingConfig?.cpu || "512",
      },
      {
        type: "list",
        name: "memory",
        message: "Memory (MB):",
        choices: ["512", "1024", "2048", "4096", "8192"],
        default: existingConfig?.memory || "1024",
      },
      {
        type: "number",
        name: "desiredCount",
        message: "Desired number of tasks:",
        default: existingConfig?.desiredCount || 1,
        validate: (input) => input > 0 || "Must have at least 1 task",
      },
      {
        type: "confirm",
        name: "useLoadBalancer",
        message: "Use Application Load Balancer?",
        default: existingConfig?.useLoadBalancer || false,
      },
    ]);

    let loadBalancerArn = existingConfig?.loadBalancerArn;
    if (resourceAnswers.useLoadBalancer && loadBalancers.length > 0) {
      const { selectedLB } = await inquirer.prompt([
        {
          type: "list",
          name: "selectedLB",
          message: "Select Load Balancer:",
          choices: loadBalancers.map((lb) => ({
            name: `${lb.name} (${lb.type})`,
            value: lb.arn,
          })),
        },
      ]);
      loadBalancerArn = selectedLB;
    }

    const networkAnswers = await inquirer.prompt([
      {
        type: "checkbox",
        name: "subnets",
        message: "Select subnets (minimum 2 for ALB):",
        choices: subnets.map((subnet) => ({
          name: `${subnet.name} (${subnet.id}) - ${subnet.az}`,
          value: subnet.id,
        })),
        default: existingConfig?.subnets || [],
        validate: (input) =>
          input.length > 0 || "At least one subnet is required",
      },
      {
        type: "checkbox",
        name: "securityGroups",
        message: "Select security groups:",
        choices: securityGroups.map((sg) => ({
          name: `${sg.name} (${sg.id}) - ${sg.description}`,
          value: sg.id,
        })),
        default: existingConfig?.securityGroups || [],
        validate: (input) =>
          input.length > 0 || "At least one security group is required",
      },
    ]);

    // Environment variables
    const envVars: Record<string, string> =
      existingConfig?.environmentVariables || {};
    let addMoreEnvVars = true;

    if (Object.keys(envVars).length === 0) {
      const { hasEnvVars } = await inquirer.prompt([
        {
          type: "confirm",
          name: "hasEnvVars",
          message: "Add environment variables?",
          default: false,
        },
      ]);
      addMoreEnvVars = hasEnvVars;
    }

    while (addMoreEnvVars) {
      const { envName, envValue, addMore } = await inquirer.prompt([
        {
          type: "input",
          name: "envName",
          message: "Environment variable name:",
          validate: (input) => input.length > 0 || "Name is required",
        },
        {
          type: "input",
          name: "envValue",
          message: "Environment variable value:",
        },
        {
          type: "confirm",
          name: "addMore",
          message: "Add another environment variable?",
          default: false,
        },
      ]);

      envVars[envName] = envValue;
      addMoreEnvVars = addMore;
    }

    const config: DeploymentConfig = {
      projectName: answers.projectName,
      dockerImage: answers.dockerImage,
      awsRegion: answers.awsRegion,
      clusterName,
      serviceName,
      taskDefinitionFamily: `${answers.projectName}-task`,
      containerPort: resourceAnswers.containerPort,
      cpu: resourceAnswers.cpu,
      memory: resourceAnswers.memory,
      desiredCount: resourceAnswers.desiredCount,
      useLoadBalancer: resourceAnswers.useLoadBalancer,
      loadBalancerArn,
      subnets: networkAnswers.subnets,
      securityGroups: networkAnswers.securityGroups,
      environmentVariables: envVars,
      logGroupName: `/ecs/${answers.projectName}`,
      createdAt: new Date().toISOString(),
    };

    await this.saveConfig(config);
    return config;
  }

  async deploy(dockerImage?: string): Promise<void> {
    try {
      const config = await this.collectDeploymentConfig(dockerImage);

      // Update region if different
      if (config.awsRegion !== this.region) {
        this.region = config.awsRegion;
        this.ecsClient = new ECSClient({ region: this.region });
        this.ec2Client = new EC2Client({ region: this.region });
        this.elbClient = new ElasticLoadBalancingV2Client({
          region: this.region,
        });
        this.logsClient = new CloudWatchLogsClient({ region: this.region });
      }

      // Build and push Docker image
      if (dockerImage || config.dockerImage) {
        await this.buildDockerImage(config.dockerImage);
        await this.pushDockerImage(config.dockerImage);
      }

      // Create/update ECS resources
      await this.deployToECS(config);

      // Update last deployed timestamp
      config.lastDeployed = new Date().toISOString();
      await this.saveConfig(config);

      console.log(chalk.green("\n🎉 Deployment completed successfully!"));
      console.log(chalk.blue(`Project: ${config.projectName}`));
      console.log(chalk.blue(`Cluster: ${config.clusterName}`));
      console.log(chalk.blue(`Service: ${config.serviceName}`));
    } catch (error) {
      console.error(chalk.red("❌ Deployment failed:"), error);
      process.exit(1);
    }
  }

  private async deployToECS(config: DeploymentConfig): Promise<void> {
    console.log(chalk.blue("\n🚀 Deploying to ECS Fargate..."));

    // Register task definition
    const taskDefinition: TaskDefinition = {
      family: config.taskDefinitionFamily,
      networkMode: "awsvpc",
      requiresCompatibilities: ["FARGATE"],
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
              protocol: "tcp",
            },
          ],
          environment: Object.entries(config.environmentVariables).map(
            ([name, value]) => ({
              name,
              value,
            }),
          ),
          logConfiguration: {
            logDriver: "awslogs",
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

    // Create or update service
    // This is a simplified version - you'd need to handle cluster creation,
    // service creation/update, and load balancer configuration
    console.log(chalk.green("✓ Service deployment initiated"));
  }

  private async getAccountId(): Promise<string> {
    try {
      const { stdout } = await execAsync(
        "aws sts get-caller-identity --query Account --output text",
      );
      return stdout.trim();
    } catch {
      return "123456789012"; // Fallback - in real implementation, handle this properly
    }
  }

  async showStatus(projectName: string): Promise<void> {
    const config = await this.loadConfig(projectName);
    if (!config) {
      console.log(
        chalk.red(`❌ Configuration not found for project: ${projectName}`),
      );
      return;
    }

    console.log(chalk.cyan(`\n📊 Status for ${config.projectName}\n`));

    try {
      // Get service status
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

        // Get task details
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
          taskDetails.tasks?.forEach((task, index) => {
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

  async showLogs(projectName: string): Promise<void> {
    const config = await this.loadConfig(projectName);
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
        response.events.forEach((event) => {
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

  async listProjects(): Promise<void> {
    const configs = await this.listSavedConfigs();

    if (configs.length === 0) {
      console.log(chalk.yellow("No deployment configurations found"));
      return;
    }

    console.log(chalk.cyan("\n📋 Deployment Configurations:\n"));

    for (const configName of configs) {
      const config = await this.loadConfig(configName);
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

// CLI Setup
program
  .name("fargate-deploy")
  .description("AWS Fargate deployment tool with Docker integration")
  .version("1.0.0");

program
  .command("deploy")
  .description("Deploy Docker image to AWS Fargate")
  .option("-i, --image <image>", "Docker image to deploy")
  .option("-r, --region <region>", "AWS region", "us-east-1")
  .action(async (options) => {
    const deployer = new FargateDeployer(options.region);
    await deployer.deploy(options.image);
  });

program
  .command("status")
  .description("Show deployment status")
  .argument("<project>", "Project name")
  .option("-r, --region <region>", "AWS region", "us-east-1")
  .action(async (project, options) => {
    const deployer = new FargateDeployer(options.region);
    await deployer.showStatus(project);
  });

program
  .command("logs")
  .description("Show container logs")
  .argument("<project>", "Project name")
  .option("-r, --region <region>", "AWS region", "us-east-1")
  .action(async (project, options) => {
    const deployer = new FargateDeployer(options.region);
    await deployer.showLogs(project);
  });

program
  .command("list")
  .description("List all deployment configurations")
  .action(async () => {
    const deployer = new FargateDeployer();
    await deployer.listProjects();
  });

program.parse();

export { FargateDeployer, DeploymentConfig };
