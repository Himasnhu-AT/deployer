import chalk from "chalk";
import inquirer from "inquirer";
import path from "path";
import { DeploymentConfig } from "../config/types";
import { ConfigManager } from "../config/configManager";

/**
 * Interactively collects deployment configuration from the user.
 * Handles new, existing, and modification flows.
 * Fetches AWS resources via provided fetchers.
 */
export async function collectDeploymentConfig(
  configManager: ConfigManager,
  fetchers: {
    fetchClusters: () => Promise<Array<{ name: string; status: string }>>;
    fetchServices: (
      clusterName: string,
    ) => Promise<Array<{ name: string; status: string }>>;
    fetchLoadBalancers: () => Promise<
      Array<{ name: string; arn: string; type: string }>
    >;
    fetchSubnets: () => Promise<
      Array<{ name: string; id: string; az: string }>
    >;
    fetchSecurityGroups: () => Promise<
      Array<{ name: string; id: string; description: string }>
    >;
  },
  dockerImage?: string,
): Promise<DeploymentConfig> {
  console.log(chalk.cyan("🚀 AWS Fargate Deployment Configuration\n"));

  // Check for existing configs
  const existingConfigs = await configManager.listSavedConfigs();
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

      existingConfig = await configManager.loadConfig(selectedConfig);
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
  const [clusters, loadBalancers, subnets, securityGroups] = await Promise.all([
    fetchers.fetchClusters(),
    fetchers.fetchLoadBalancers(),
    fetchers.fetchSubnets(),
    fetchers.fetchSecurityGroups(),
  ]);

  const answers = await inquirer.prompt([
    {
      type: "input",
      name: "projectName",
      message: "Project name:",
      default: existingConfig?.projectName || path.basename(process.cwd()),
      validate: (input: string) =>
        input.length > 0 || "Project name is required",
    },
    {
      type: "input",
      name: "dockerImage",
      message: "Docker image (with tag):",
      default: existingConfig?.dockerImage || dockerImage,
      validate: (input: string) =>
        input.length > 0 || "Docker image is required",
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
      default: existingConfig?.awsRegion,
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
    services = await fetchers.fetchServices(clusterName);
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

  const resourceQuestions: any = [
    {
      type: "number",
      name: "containerPort",
      message: "Container port to expose:",
      default: existingConfig?.containerPort || 3000,
      validate: (input: number) =>
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
      validate: (input: number) => input > 0 || "Must have at least 1 task",
    },
    {
      type: "confirm",
      name: "useLoadBalancer",
      message: "Use Application Load Balancer?",
      default: existingConfig?.useLoadBalancer || false,
    },
  ];
  const resourceAnswers = await inquirer.prompt(resourceQuestions);

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

  const networkQuestions: any = [
    {
      type: "checkbox",
      name: "subnets",
      message: "Select subnets (minimum 2 for ALB):",
      choices: subnets.map((subnet) => ({
        name: `${subnet.name} (${subnet.id}) - ${subnet.az}`,
        value: subnet.id,
      })),
      default: existingConfig?.subnets || [],
      validate: (input: string[]) =>
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
      validate: (input: string[]) =>
        input.length > 0 || "At least one security group is required",
    },
  ];
  const networkAnswers = await inquirer.prompt(networkQuestions);

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
        validate: (input: string) => input.length > 0 || "Name is required",
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

  await configManager.saveConfig(config);
  return config;
}
