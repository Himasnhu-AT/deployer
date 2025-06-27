export interface DeploymentConfig {
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
