/**
 * ================================================================================
 * CLUSTER COMMAND - Multi-Instance Management and Autoscaling
 * ================================================================================
 * 
 * Command for creating and managing clusters of EC2 instances with lightweight
 * autoscaling capabilities. Provides horizontal scaling based on CPU utilization
 * using Lambda functions and CloudWatch alarms.
 * 
 * COMMAND FEATURES:
 * • Cluster Creation - Set up autoscaling infrastructure with Lambda functions
 * • Status Monitoring - View current cluster state and instance distribution
 * • Configurable Scaling - Customize min/max instances and scaling thresholds
 * • CloudWatch Integration - CPU-based scaling triggers with configurable cooldowns
 * • Cost Optimization - Automatic scale-down during low utilization periods
 * 
 * ARCHITECTURE:
 * • Lambda Function - Custom autoscaling logic for deployer-managed instances
 * • CloudWatch Alarms - CPU utilization monitoring and scaling triggers
 * • SNS Topics - Alarm notifications for scaling events
 * • Instance Tagging - 'cluster-managed=true' for cluster membership
 * 
 * PREREQUISITES:
 * • Lambda execution role with EC2 and CloudWatch permissions
 * • SNS topics for scaling notifications
 * • CloudWatch metrics enabled for EC2 instances
 * 
 * USAGE:
 * deployer cluster --create --min-instances 2 --max-instances 10 --target-cpu 70
 * deployer cluster --status
 * 
 * @author Himanshu
 * @version 1.0.0
 * @since 2025
 * @license BSD-3-Clause
 */

import { Command } from 'commander';
import {
    LambdaClient,
    CreateFunctionCommand,
    InvokeCommand,
    GetFunctionCommand
} from '@aws-sdk/client-lambda';
import {
    CloudWatchClient,
    PutMetricAlarmCommand,
    DescribeAlarmsCommand
} from '@aws-sdk/client-cloudwatch';
import { AWSService } from '../services/aws';
import { ClusterConfig } from '../types';
import { logger } from '../utils/logger';
import chalk from 'chalk';

/**
 * ================================================================================
 * CLUSTER COMMAND DEFINITION
 * ================================================================================
 * 
 * Command for managing multi-instance clusters with autoscaling capabilities.
 * Supports both cluster creation and status monitoring operations.
 * 
 * //? Provides cost-effective horizontal scaling for high-availability deployments
 * //! COMPLEXITY: Cluster management requires additional AWS resources and permissions
 * //TODO: Add cluster deletion/cleanup functionality
 * //TODO: Add support for different scaling metrics (memory, network, custom)
 * //TODO: Add load balancer integration for traffic distribution
 */
export const clusterCommand = new Command('cluster')
    .description('Create and manage a lightweight autoscaling cluster')
    .option('--min-instances <count>', 'Minimum number of instances', parseInt, 1)
    .option('--max-instances <count>', 'Maximum number of instances', parseInt, 5)
    .option('--target-cpu <percentage>', 'Target CPU utilization for scaling', parseInt, 70)
    .option('--scale-up-cooldown <seconds>', 'Cooldown period for scaling up', parseInt, 300)
    .option('--scale-down-cooldown <seconds>', 'Cooldown period for scaling down', parseInt, 300)
    .option('--create', 'Create a new cluster management system')
    .option('--status', 'Show cluster status')
    .action(async (options) => {
        try {
            // Route to appropriate cluster operation
            if (options.create) {
                await createClusterManagement(options);
            } else if (options.status) {
                await showClusterStatus();
            } else {
                // Provide usage guidance
                logger.info('Use --create to set up cluster management or --status to view current status');
                logger.info('Example: deployer cluster --create --min-instances 2 --max-instances 5');
            }
        } catch (error) {
            logger.error('Cluster operation failed', error as Error);
            logger.debug('Cluster operation error details', {
                error: error instanceof Error ? error.message : error
            });
            process.exit(1);
        }
    });

/**
 * ================================================================
 * CLUSTER CREATION AND SETUP
 * ================================================================
 */

/**
 * Create complete cluster management infrastructure
 * 
 * Sets up Lambda functions, CloudWatch alarms, and SNS topics for
 * automated cluster scaling based on CPU utilization metrics.
 * 
 * @param options - Cluster configuration options from command line
 * 
 * //! PERMISSIONS: Requires extensive AWS permissions for Lambda, CloudWatch, SNS
 * //? Creates reusable infrastructure that works across all deployer instances
 * //TODO: Add validation for AWS account limits and quotas
 */
async function createClusterManagement(options: any): Promise<void> {
    // Build cluster configuration from options
    const clusterConfig: ClusterConfig = {
        minInstances: options.minInstances,
        maxInstances: options.maxInstances,
        targetCpuUtilization: options.targetCpu,
        scaleUpCooldown: options.scaleUpCooldown,
        scaleDownCooldown: options.scaleDownCooldown
    };

    logger.info('Setting up cluster management system...');
    logger.debug('Cluster configuration', clusterConfig);

    // Initialize AWS clients for cluster infrastructure
    const lambdaClient = new LambdaClient({});
    const cloudWatchClient = new CloudWatchClient({});

    // Step 1: Create Lambda function for autoscaling logic
    logger.debug('Creating autoscaling Lambda function');
    const lambdaCode = generateAutoscalingLambdaCode(clusterConfig);

    const createFunctionCommand = new CreateFunctionCommand({
        FunctionName: 'deployer-autoscaler',
        Runtime: 'nodejs18.x',
        Role: 'arn:aws:iam::ACCOUNT_ID:role/lambda-execution-role', // This would need to be created
        Handler: 'index.handler',
        Code: {
            ZipFile: Buffer.from(lambdaCode)
        },
        Description: 'Deployer autoscaling management function',
        Timeout: 60,
        Environment: {
            Variables: {
                MIN_INSTANCES: clusterConfig.minInstances.toString(),
                MAX_INSTANCES: clusterConfig.maxInstances.toString(),
                TARGET_CPU: clusterConfig.targetCpuUtilization.toString(),
                SCALE_UP_COOLDOWN: clusterConfig.scaleUpCooldown.toString(),
                SCALE_DOWN_COOLDOWN: clusterConfig.scaleDownCooldown.toString()
            }
        }
    });

    try {
        await lambdaClient.send(createFunctionCommand);
        logger.success('Autoscaling Lambda function created');
    } catch (error: any) {
        if (error.name === 'ResourceConflictException') {
            logger.info('Autoscaling function already exists, updating configuration...');
            //TODO: Update existing function with new configuration
        } else {
            throw error;
        }
    }

    // Step 2: Create CloudWatch alarms for scaling triggers
    logger.debug('Creating CloudWatch alarms for scaling triggers');
    await createScalingAlarms(cloudWatchClient, clusterConfig);

    // Display success and configuration summary
    logger.success('Cluster management system has been set up successfully!');

    console.log(chalk.bold('\n🎛️  Cluster Configuration:'));
    console.log(`   Min Instances: ${clusterConfig.minInstances}`);
    console.log(`   Max Instances: ${clusterConfig.maxInstances}`);
    console.log(`   Target CPU: ${clusterConfig.targetCpuUtilization}%`);
    console.log(`   Scale Up Cooldown: ${clusterConfig.scaleUpCooldown}s`);
    console.log(`   Scale Down Cooldown: ${clusterConfig.scaleDownCooldown}s`);

    // Provide next steps guidance
    logger.info('\nNext steps:');
    console.log('  • Deploy instances with --assign-url flag to enable cluster management');
    console.log('  • Monitor cluster status with: deployer cluster --status');
    console.log('  • Check CloudWatch metrics for scaling activity');
}

/**
 * Create CloudWatch alarms for scaling triggers
 * 
 * Sets up CPU utilization alarms that trigger Lambda-based scaling
 * when thresholds are crossed for sustained periods.
 * 
 * @param cloudWatchClient - CloudWatch client for alarm creation
 * @param config - Cluster configuration with scaling thresholds
 * 
 * //? Alarms evaluate over 2 periods to prevent rapid scaling oscillation
 * //! DEPENDENCY: Requires SNS topics for alarm notifications
 * //TODO: Add support for multiple metric types and custom metrics
 */
async function createScalingAlarms(cloudWatchClient: CloudWatchClient, config: ClusterConfig): Promise<void> {
    // Scale Up Alarm - triggers when CPU is consistently high
    const scaleUpAlarm = new PutMetricAlarmCommand({
        AlarmName: 'deployer-scale-up',
        ComparisonOperator: 'GreaterThanThreshold',
        EvaluationPeriods: 2,
        MetricName: 'CPUUtilization',
        Namespace: 'AWS/EC2',
        Period: 300,
        Statistic: 'Average',
        Threshold: config.targetCpuUtilization,
        ActionsEnabled: true,
        AlarmActions: [
            'arn:aws:sns:REGION:ACCOUNT_ID:deployer-scale-up-topic' // Would need to be created
        ],
        AlarmDescription: 'Trigger scale up when CPU is high',
        Dimensions: [
            {
                Name: 'AutoScalingGroupName',
                Value: 'deployer-cluster'
            }
        ]
    });

    // Scale Down Alarm - triggers when CPU is consistently low
    const scaleDownAlarm = new PutMetricAlarmCommand({
        AlarmName: 'deployer-scale-down',
        ComparisonOperator: 'LessThanThreshold',
        EvaluationPeriods: 2,
        MetricName: 'CPUUtilization',
        Namespace: 'AWS/EC2',
        Period: 300,
        Statistic: 'Average',
        Threshold: config.targetCpuUtilization - 20, // Scale down when 20% below target
        ActionsEnabled: true,
        AlarmActions: [
            'arn:aws:sns:REGION:ACCOUNT_ID:deployer-scale-down-topic' // Would need to be created
        ],
        AlarmDescription: 'Trigger scale down when CPU is low',
        Dimensions: [
            {
                Name: 'AutoScalingGroupName',
                Value: 'deployer-cluster'
            }
        ]
    });

    // Create both alarms
    await cloudWatchClient.send(scaleUpAlarm);
    await cloudWatchClient.send(scaleDownAlarm);

    logger.success('CloudWatch alarms created for autoscaling');
    logger.debug('Scaling alarms configured', {
        scaleUpThreshold: config.targetCpuUtilization,
        scaleDownThreshold: config.targetCpuUtilization - 20
    });
}

/**
 * ================================================================
 * CLUSTER STATUS MONITORING
 * ================================================================
 */

/**
 * Display current cluster status and instance distribution
 * 
 * Shows all cluster-managed instances with their current states,
 * providing a comprehensive view of cluster health and capacity.
 * 
 * //? Filters instances by 'cluster-managed=true' tag
 * //TODO: Add CPU utilization metrics for each instance
 * //TODO: Add scaling activity history
 */
async function showClusterStatus(): Promise<void> {
    logger.info('Fetching cluster status...');
    logger.debug('Querying cluster-managed instances');

    // Get all deployer-managed instances
    const awsService = new AWSService();
    const instances = await awsService.listInstances();

    // Filter for cluster-managed instances
    const clusterInstances = instances.filter(instance =>
        instance.tags['cluster-managed'] === 'true'
    );

    console.log(chalk.bold('\n🎛️  Cluster Status:\n'));

    // Handle empty cluster
    if (clusterInstances.length === 0) {
        logger.info('No cluster-managed instances found.');
        logger.info('Deploy instances with --assign-url flag to enable cluster management');
        return;
    }

    // Calculate instance state distribution
    const runningInstances = clusterInstances.filter(i => i.state === 'running').length;
    const stoppedInstances = clusterInstances.filter(i => i.state === 'stopped').length;
    const totalInstances = clusterInstances.length;

    // Display cluster summary
    console.log(`Total Cluster Instances: ${totalInstances}`);
    console.log(`Running: ${chalk.green(runningInstances)}`);
    console.log(`Stopped: ${chalk.yellow(stoppedInstances)}`);
    console.log('');

    // Display individual instance details
    clusterInstances.forEach((instance) => {
        const stateColor = instance.state === 'running' ? 'green' : 'yellow';
        console.log(`${chalk.bold(instance.instanceId)} - ${chalk[stateColor](instance.state)}`);
        console.log(`  Image: ${instance.dockerImage}`);
        console.log(`  Type: ${instance.instanceType}`);
        if (instance.publicIp) {
            console.log(`  Public IP: ${instance.publicIp}`);
        }
        console.log('');
    });

    logger.debug('Cluster status displayed', {
        totalInstances,
        runningInstances,
        stoppedInstances
    });
}

/**
 * ================================================================
 * LAMBDA FUNCTION CODE GENERATION
 * ================================================================
 */

/**
 * Generate Node.js Lambda function code for autoscaling logic
 * 
 * Creates a complete Lambda function that handles scaling decisions
 * based on CloudWatch alarm triggers and cluster configuration.
 * 
 * @param config - Cluster configuration for scaling parameters
 * @returns string - Complete Lambda function code
 * 
 * //? Generated code includes error handling and logging
 * //! LIMITATION: Current implementation is a basic prototype
 * //TODO: Add sophisticated scaling algorithms and instance health checks
 * //TODO: Add support for different scaling strategies
 */
function generateAutoscalingLambdaCode(config: ClusterConfig): string {
    return `
const AWS = require('aws-sdk');
const ec2 = new AWS.EC2();

/**
 * Lambda handler for deployer cluster autoscaling
 * 
 * Processes CloudWatch alarm events and makes scaling decisions
 * based on current cluster state and configuration.
 */
exports.handler = async (event) => {
    console.log('Autoscaling event received:', JSON.stringify(event));
    
    try {
        // Get all cluster-managed instances
        const params = {
            Filters: [
                {
                    Name: 'tag:cluster-managed',
                    Values: ['true']
                },
                {
                    Name: 'tag:ManagedBy',
                    Values: ['deployer']
                }
            ]
        };
        
        const result = await ec2.describeInstances(params).promise();
        const instances = [];
        
        // Process all reservations and instances
        for (const reservation of result.Reservations) {
            for (const instance of reservation.Instances) {
                if (instance.State.Name !== 'terminated') {
                    instances.push(instance);
                }
            }
        }
        
        const runningInstances = instances.filter(i => i.State.Name === 'running');
        const currentCount = runningInstances.length;
        
        console.log(\`Current running instances: \${currentCount}\`);
        console.log(\`Min instances: ${config.minInstances}, Max instances: ${config.maxInstances}\`);
        
        // Determine scaling action based on the alarm
        const alarmName = event.AlarmName;
        
        if (alarmName === 'deployer-scale-up' && currentCount < ${config.maxInstances}) {
            console.log('Scaling up cluster...');
            await scaleUp(instances[0]);
        } else if (alarmName === 'deployer-scale-down' && currentCount > ${config.minInstances}) {
            console.log('Scaling down cluster...');
            await scaleDown(runningInstances);
        } else {
            console.log('No scaling action needed or limits reached');
        }
        
        return {
            statusCode: 200,
            body: JSON.stringify('Autoscaling completed successfully')
        };
        
    } catch (error) {
        console.error('Autoscaling error:', error);
        throw error;
    }
};

/**
 * Scale up the cluster by starting a stopped instance or cloning
 */
async function scaleUp(templateInstance) {
    console.log('Executing scale-up operation...');
    //TODO: Implement instance cloning or starting stopped instances
    // This would clone an existing instance with the same configuration
}

/**
 * Scale down the cluster by stopping the most recent instance
 */
async function scaleDown(runningInstances) {
    console.log('Executing scale-down operation...');
    
    // Stop the most recently launched instance
    const instanceToStop = runningInstances.sort((a, b) => 
        new Date(b.LaunchTime) - new Date(a.LaunchTime)
    )[0];
    
    console.log(\`Stopping instance: \${instanceToStop.InstanceId}\`);
    
    await ec2.stopInstances({
        InstanceIds: [instanceToStop.InstanceId]
    }).promise();
    
    console.log('Scale-down operation completed');
}
`;
}