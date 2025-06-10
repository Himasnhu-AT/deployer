/**
 * ================================================================================
 * AWS SERVICE - Core AWS Infrastructure Management
 * ================================================================================
 * 
 * This service provides a complete abstraction layer for AWS operations, handling
 * the full lifecycle of cloud infrastructure deployment and management.
 * 
 * KEY FEATURES:
 * • EC2 Instance Management - Create, start, stop, terminate instances
 * • Security Group Management - Dynamic rule creation and configuration  
 * • Container Deployment - Automated Docker container deployment via user data
 * • SSM Integration - Remote command execution and log retrieval
 * • Elastic IP Management - Public IP assignment and DNS configuration
 * • Resource Tagging - Consistent tagging strategy for resource tracking
 * 
 * DEPENDENCIES:
 * • AWS SDK v3 - Modern AWS client libraries
 * • Logger Service - Structured logging and monitoring
 * • Type Definitions - Strong typing for all operations
 * 
 * PREREQUISITES:
 * • AWS Credentials configured (IAM user/role with appropriate permissions)
 * • EC2SSMRole IAM role for SSM operations
 * • VPC with proper subnet configuration
 * 
 * COST CONSIDERATIONS:
 * • EC2 instances incur hourly charges
 * • Elastic IPs cost when unattached
 * • Data transfer charges apply
 * 
 * @author Deployer CLI Team
 * @version 1.0.0
 * @since 2024
 * @license MIT
 */

import {
    EC2Client,
    RunInstancesCommand,
    DescribeInstancesCommand,
    CreateSecurityGroupCommand,
    AuthorizeSecurityGroupIngressCommand,
    AuthorizeSecurityGroupEgressCommand,
    CreateTagsCommand,
    TerminateInstancesCommand,
    StopInstancesCommand,
    StartInstancesCommand,
    AllocateAddressCommand,
    AssociateAddressCommand,
    DescribeSecurityGroupsCommand,
    Instance,
    DescribeImagesCommand,
    _InstanceType
} from '@aws-sdk/client-ec2';
import { SSMClient, SendCommandCommand, GetCommandInvocationCommand } from '@aws-sdk/client-ssm';
import { Route53Client, CreateHostedZoneCommand, ChangeResourceRecordSetsCommand } from '@aws-sdk/client-route-53';
import { CloudWatchLogsClient, CreateLogGroupCommand, DescribeLogStreamsCommand } from '@aws-sdk/client-cloudwatch-logs';
import { CreateInstanceOptions, DeployerInstance, SecurityRule } from '../types';
import { logger } from '../utils/logger';

/**
 * ================================================================================
 * AWS SERVICE CLASS
 * ================================================================================
 * 
 * Central service for all AWS operations. Manages EC2, SSM, Route53, and CloudWatch
 * integrations with proper error handling, logging, and resource management.
 * 
 * //! CRITICAL: Requires valid AWS credentials and appropriate IAM permissions
 * //? Credential setup guide: See /utils/credentials.ts for configuration help
 * //TODO: Add support for multiple AWS profiles and cross-region operations
 */
export class AWSService {
    // Core AWS service clients
    private ec2Client: EC2Client;           // EC2 instance and security group management
    private ssmClient: SSMClient;           // Remote command execution and management
    private route53Client: Route53Client;  // DNS and domain management
    private logsClient: CloudWatchLogsClient; // Log aggregation and monitoring

    /**
     * Initialize AWS service with regional clients
     * 
     * Sets up all required AWS service clients for the specified region.
     * All operations will be performed in this region unless explicitly overridden.
     * 
     * @param region - AWS region code (e.g., 'us-east-1', 'eu-west-1')
     * 
     * //? Default region is us-east-1 for cost optimization and service availability
     * //TODO: Add automatic region detection based on user location
     * //TODO: Implement client connection validation on initialization
     */
    constructor(region: string = 'us-east-1') {
        // Initialize regional AWS clients
        this.ec2Client = new EC2Client({ region });
        this.ssmClient = new SSMClient({ region });
        this.route53Client = new Route53Client({ region });
        this.logsClient = new CloudWatchLogsClient({ region });
    }

    /**
     * ================================================================================
     * INSTANCE CREATION - Main Entry Point
     * ================================================================================
     * 
     * Creates and configures a complete EC2 instance with Docker container deployment.
     * This orchestrates the entire infrastructure provisioning workflow.
     * 
     * WORKFLOW STEPS:
     * 1. Security Group Creation - Configure network access rules
     * 2. AMI Selection - Get latest Amazon Linux 2 image
     * 3. Instance Launch - Deploy EC2 with Docker user data
     * 4. State Monitoring - Wait for running state
     * 5. IP Assignment - Optionally assign Elastic IP
     * 6. Resource Tagging - Apply management tags
     * 
     * @param options - Complete instance configuration object
     * @returns Promise<DeployerInstance> - Fully configured instance details
     * 
     * //! COST ALERT: This operation will incur AWS charges immediately
     * //! SECURITY: Review security group rules before deployment
     * //? Monitor AWS billing dashboard to track costs
     * //TODO: Add cost estimation before deployment
     * //TODO: Implement rollback mechanism on failure
     */
    async createInstance(options: CreateInstanceOptions): Promise<DeployerInstance> {
        // Initialize performance monitoring
        const spinner = logger.spinner('Creating EC2 instance...');
        const timer = logger.timer('aws-create-instance');

        try {
            logger.step('AWS_CREATE', 'Starting EC2 instance creation process', { options });

            // STEP 1: Create dedicated security group
            logger.debug('Creating security group for instance');
            const sgTimer = logger.timer('security-group-creation');
            const securityGroupId = await this.createSecurityGroup(options);
            sgTimer.end();
            logger.debug('Security group created', { securityGroupId });

            // STEP 2: Generate Docker deployment script
            logger.debug('Generating user data script for Docker installation');
            const userData = this.generateUserDataScript(options.dockerImage);
            logger.debug('User data script generated', { dockerImage: options.dockerImage });

            // STEP 3: Fetch latest secure AMI
            logger.debug('Fetching latest Amazon Linux 2 AMI');
            const amiTimer = logger.timer('ami-fetch');
            const imageId = await this.getLatestAMI();
            amiTimer.end();
            logger.debug('Latest AMI fetched', { imageId });

            // STEP 4: Launch EC2 instance with configuration
            logger.step('AWS_LAUNCH', 'Launching EC2 instance', {
                instanceType: options.instanceType,
                imageId,
                securityGroupId
            });

            //? EC2SSMRole IAM role is required for SSM access - must exist before deployment
            //! DEPENDENCY: Ensure EC2SSMRole exists with AmazonSSMManagedInstanceCore policy
            const runCommand = new RunInstancesCommand({
                ImageId: imageId,
                InstanceType: options.instanceType as _InstanceType,
                MinCount: 1,
                MaxCount: 1,
                SecurityGroupIds: [securityGroupId],
                UserData: Buffer.from(userData).toString('base64'),
                IamInstanceProfile: {
                    Name: 'EC2SSMRole' // Required for SSM operations
                },
                TagSpecifications: [
                    {
                        ResourceType: 'instance',
                        Tags: [
                            { Key: 'Name', Value: options.name || `deployer-${Date.now()}` },
                            { Key: 'ManagedBy', Value: 'deployer' },
                            { Key: 'DockerImage', Value: options.dockerImage },
                            { Key: 'ExecutionId', Value: logger.getExecutionId() },
                            ...(options.assignUrl ? [{ Key: 'cluster-managed', Value: 'true' }] : [])
                        ]
                    }
                ]
            });

            // Execute instance launch
            const launchTimer = logger.timer('ec2-launch');
            const result = await this.ec2Client.send(runCommand);
            launchTimer.end();

            const instanceId = result.Instances![0].InstanceId!;
            logger.debug('EC2 instance launched successfully', { instanceId });
            spinner.succeed('EC2 instance created successfully');

            // STEP 5: Wait for instance to become operational
            logger.step('AWS_WAIT', 'Waiting for instance to reach running state', { instanceId });
            const waitTimer = logger.timer('instance-wait');
            await this.waitForInstanceRunning(instanceId);
            waitTimer.end();

            // STEP 6: Retrieve final instance configuration
            logger.debug('Fetching instance details');
            const detailsTimer = logger.timer('instance-details');
            const instance = await this.getInstanceDetails(instanceId);
            detailsTimer.end();
            logger.debug('Instance details fetched', {
                instanceId,
                state: instance.State?.Name,
                publicIp: instance.PublicIpAddress
            });

            // STEP 7: Configure public URL if requested
            let assignedUrl: string | undefined;
            if (options.assignUrl) {
                logger.step('AWS_URL', 'Assigning public URL/Elastic IP', { instanceId });
                const urlTimer = logger.timer('url-assignment');
                assignedUrl = await this.assignPublicUrl(instanceId);
                urlTimer.end();
                logger.debug('Public URL assigned', { assignedUrl });
            }

            // Finalize deployment
            const totalDuration = timer.end();
            logger.step('AWS_CREATE', 'EC2 instance creation completed', {
                instanceId,
                totalDuration
            });

            // Return complete instance configuration
            return {
                instanceId,
                instanceType: options.instanceType,
                dockerImage: options.dockerImage,
                state: 'running',
                publicIp: instance.PublicIpAddress,
                publicDns: instance.PublicDnsName,
                assignedUrl,
                tags: this.formatTags(instance.Tags || []),
                launchTime: instance.LaunchTime!,
                gpuCount: options.gpu,
                cpu: options.cpu,
                memory: options.memory
            };

        } catch (error) {
            // Cleanup and error reporting
            timer.end();
            spinner.fail('Failed to create EC2 instance');
            logger.step('AWS_ERROR', 'EC2 instance creation failed', {
                error: error instanceof Error ? error.message : error
            });
            throw error;
        }
    }

    /**
     * Create a security group with inbound/outbound rules
     * 
     * @param options - Instance creation options containing security rules
     * @returns Promise<string> - Security group ID
     * 
     * //TODO: Add support for existing security group reuse
     * //? Each deployment creates a new security group - consider cleanup strategy
     */
    private async createSecurityGroup(options: CreateInstanceOptions): Promise<string> {
        const groupName = `deployer-sg-${Date.now()}`;
        logger.debug('Creating security group', { groupName });

        const createSgCommand = new CreateSecurityGroupCommand({
            GroupName: groupName,
            Description: 'Security group for deployer managed instance'
        });

        const result = await this.ec2Client.send(createSgCommand);
        const securityGroupId = result.GroupId!;
        logger.debug('Security group created', { securityGroupId, groupName });

        // Add inbound rules if specified
        if (options.inbound && options.inbound.length > 0) {
            logger.debug('Adding inbound rules', { rules: options.inbound });
            const inboundRules = options.inbound.map(rule => this.parseSecurityRule(rule));
            await this.addInboundRules(securityGroupId, inboundRules);
            logger.debug('Inbound rules added', { securityGroupId, rulesCount: inboundRules.length });
        }

        // Add outbound rules if specified (default allows all outbound)
        if (options.outbound && options.outbound.length > 0) {
            logger.debug('Adding outbound rules', { rules: options.outbound });
            const outboundRules = options.outbound.map(rule => this.parseSecurityRule(rule));
            await this.addOutboundRules(securityGroupId, outboundRules);
            logger.debug('Outbound rules added', { securityGroupId, rulesCount: outboundRules.length });
        }

        return securityGroupId;
    }

    /**
     * Parse security rule string into SecurityRule object
     * 
     * @param rule - Security rule in format "CIDR:PORT" (e.g., "0.0.0.0/0:80")
     * @returns SecurityRule object
     * 
     * //TODO: Add support for protocol specification (currently defaults to TCP)
     * //TODO: Add support for port ranges
     */
    private parseSecurityRule(rule: string): SecurityRule {
        const [cidr, port] = rule.split(':');
        return {
            cidr,
            port: parseInt(port),
            protocol: 'tcp' // Currently only TCP is supported
        };
    }

    /**
     * Add inbound rules to security group
     * 
     * @param securityGroupId - Target security group ID
     * @param rules - Array of security rules to add
     * 
     * //! SECURITY: Be careful with 0.0.0.0/0 rules - they allow access from anywhere
     */
    private async addInboundRules(securityGroupId: string, rules: SecurityRule[]): Promise<void> {
        logger.debug('Authorizing inbound rules', { securityGroupId, rules });
        const authorizeCommand = new AuthorizeSecurityGroupIngressCommand({
            GroupId: securityGroupId,
            IpPermissions: rules.map(rule => ({
                IpProtocol: rule.protocol,
                FromPort: rule.port,
                ToPort: rule.port,
                IpRanges: [{ CidrIp: rule.cidr }]
            }))
        });
        await this.ec2Client.send(authorizeCommand);
        logger.debug('Inbound rules authorized successfully', { securityGroupId });
    }

    /**
     * Add outbound rules to security group
     * 
     * @param securityGroupId - Target security group ID
     * @param rules - Array of security rules to add
     * 
     * //? Most applications need outbound internet access for package downloads
     */
    private async addOutboundRules(securityGroupId: string, rules: SecurityRule[]): Promise<void> {
        logger.debug('Authorizing outbound rules', { securityGroupId, rules });
        const authorizeCommand = new AuthorizeSecurityGroupEgressCommand({
            GroupId: securityGroupId,
            IpPermissions: rules.map(rule => ({
                IpProtocol: rule.protocol,
                FromPort: rule.port,
                ToPort: rule.port,
                IpRanges: [{ CidrIp: rule.cidr }]
            }))
        });
        await this.ec2Client.send(authorizeCommand);
        logger.debug('Outbound rules authorized successfully', { securityGroupId });
    }

    /**
     * Generate user data script for Docker installation and container deployment
     * 
     * This script is executed on instance launch and handles:
     * - System updates
     * - Docker installation and configuration
     * - SSM agent setup
     * - Container deployment
     * 
     * @param dockerImage - Docker image to deploy
     * @returns Base64-encoded user data script
     * 
     * //TODO: Add support for custom user data scripts
     * //TODO: Add error handling and logging within the script
     */
    private generateUserDataScript(dockerImage: string): string {
        logger.debug('Generating user data script', { dockerImage });
        const script = `#!/bin/bash
# Update system packages
yum update -y

# Install and configure Docker
yum install -y docker
systemctl start docker
systemctl enable docker
usermod -a -G docker ec2-user

# Install SSM agent (usually pre-installed on Amazon Linux 2)
yum install -y amazon-ssm-agent
systemctl start amazon-ssm-agent
systemctl enable amazon-ssm-agent

# Pull and run Docker container
docker pull ${dockerImage}
docker run -d --name deployed-container --restart unless-stopped ${dockerImage}

# Log container status for debugging
docker ps > /var/log/deployer-container.log
echo "Deployment completed at $(date)" >> /var/log/deployer-container.log
`;
        logger.debug('User data script generated', { scriptLength: script.length });
        return script;
    }

    /**
     * Get the latest Amazon Linux 2 AMI ID
     * 
     * @returns Promise<string> - Latest AMI ID
     * 
     * //? This ensures we always use the most up-to-date and secure base image
     * //TODO: Add support for other operating systems (Ubuntu, CentOS, etc.)
     */
    private async getLatestAMI(): Promise<string> {
        logger.debug('Fetching latest Amazon Linux 2 AMI');

        const command = new DescribeImagesCommand({
            Filters: [
                {
                    Name: 'name',
                    Values: ['amzn2-ami-hvm-*-x86_64-gp2'] // Amazon Linux 2 HVM
                },
                {
                    Name: 'state',
                    Values: ['available']
                },
                {
                    Name: 'owner-alias',
                    Values: ['amazon'] // Official Amazon AMIs only
                }
            ]
        });

        const result = await this.ec2Client.send(command);

        // Sort by creation date to get the latest
        const sortedImages = result.Images?.sort((a, b) =>
            new Date(b.CreationDate!).getTime() - new Date(a.CreationDate!).getTime()
        );

        const latestAmi = sortedImages?.[0]?.ImageId || 'ami-0abcdef1234567890'; // Fallback AMI
        logger.debug('Latest AMI found', { amiId: latestAmi, totalImages: result.Images?.length });
        return latestAmi;
    }

    /**
     * Wait for instance to reach 'running' state
     * 
     * Polls instance state every 10 seconds until running or timeout
     * 
     * @param instanceId - Instance to monitor
     * 
     * //! TIMEOUT: Will fail after 5 minutes (30 attempts × 10 seconds)
     * //? Consider increasing timeout for large instances or custom AMIs
     */
    private async waitForInstanceRunning(instanceId: string): Promise<void> {
        const spinner = logger.spinner('Waiting for instance to be running...');
        let attempts = 0;
        const maxAttempts = 30; // 5 minutes maximum wait time

        logger.debug('Starting instance state polling', { instanceId, maxAttempts });

        while (attempts < maxAttempts) {
            const instance = await this.getInstanceDetails(instanceId);
            const currentState = instance.State?.Name;

            logger.debug('Instance state check', {
                instanceId,
                attempt: attempts + 1,
                currentState
            });

            if (currentState === 'running') {
                spinner.succeed('Instance is now running');
                logger.debug('Instance reached running state', { instanceId, attempts: attempts + 1 });
                return;
            }

            // Wait 10 seconds before next check
            await new Promise(resolve => setTimeout(resolve, 10000));
            attempts++;
        }

        spinner.fail('Instance failed to reach running state');
        logger.debug('Instance failed to reach running state within timeout', {
            instanceId,
            attempts,
            maxAttempts
        });
        throw new Error('Instance failed to reach running state within timeout');
    }

    /**
     * Get detailed information about an EC2 instance
     * 
     * @param instanceId - Instance ID to query
     * @returns Promise<Instance> - AWS Instance object
     */
    async getInstanceDetails(instanceId: string): Promise<Instance> {
        logger.debug('Fetching instance details', { instanceId });
        const command = new DescribeInstancesCommand({
            InstanceIds: [instanceId]
        });
        const result = await this.ec2Client.send(command);
        const instance = result.Reservations![0].Instances![0];
        logger.debug('Instance details fetched', {
            instanceId,
            state: instance.State?.Name,
            publicIp: instance.PublicIpAddress
        });
        return instance;
    }

    /**
     * List all instances managed by deployer CLI
     * 
     * @returns Promise<DeployerInstance[]> - Array of managed instances
     * 
     * //? Filters by 'ManagedBy=deployer' tag to only show our instances
     */
    async listInstances(): Promise<DeployerInstance[]> {
        logger.debug('Listing deployer-managed instances');

        const command = new DescribeInstancesCommand({
            Filters: [
                {
                    Name: 'tag:ManagedBy',
                    Values: ['deployer']
                },
                {
                    Name: 'instance-state-name',
                    Values: ['pending', 'running', 'stopping', 'stopped']
                }
            ]
        });

        const result = await this.ec2Client.send(command);
        const instances: DeployerInstance[] = [];

        for (const reservation of result.Reservations || []) {
            for (const instance of reservation.Instances || []) {
                const dockerImage = instance.Tags?.find(tag => tag.Key === 'DockerImage')?.Value || 'unknown';
                instances.push({
                    instanceId: instance.InstanceId!,
                    instanceType: instance.InstanceType!,
                    dockerImage,
                    state: instance.State?.Name as any,
                    publicIp: instance.PublicIpAddress,
                    publicDns: instance.PublicDnsName,
                    tags: this.formatTags(instance.Tags || []),
                    launchTime: instance.LaunchTime!
                });
            }
        }

        logger.debug('Instances listed', { count: instances.length });
        return instances;
    }

    /**
     * Stop a running EC2 instance
     * 
     * @param instanceId - Instance to stop
     * 
     * //! IMPORTANT: Stopping an instance may result in data loss for instance store volumes
     * //? EBS-backed instances retain data when stopped
     */
    async stopInstance(instanceId: string): Promise<void> {
        logger.debug('Stopping instance', { instanceId });
        const command = new StopInstancesCommand({
            InstanceIds: [instanceId]
        });
        await this.ec2Client.send(command);
        logger.debug('Stop command sent', { instanceId });
    }

    /**
     * Start a stopped EC2 instance
     * 
     * @param instanceId - Instance to start
     * 
     * //? Starting an instance may result in a new public IP address
     */
    async startInstance(instanceId: string): Promise<void> {
        logger.debug('Starting instance', { instanceId });
        const command = new StartInstancesCommand({
            InstanceIds: [instanceId]
        });
        await this.ec2Client.send(command);
        logger.debug('Start command sent', { instanceId });
    }

    /**
     * Permanently terminate an EC2 instance
     * 
     * @param instanceId - Instance to terminate
     * 
     * //! CRITICAL: This action is irreversible and will delete the instance permanently
     * //! WARNING: All data on instance store volumes will be lost
     */
    async terminateInstance(instanceId: string): Promise<void> {
        logger.debug('Terminating instance', { instanceId });
        const command = new TerminateInstancesCommand({
            InstanceIds: [instanceId]
        });
        await this.ec2Client.send(command);
        logger.debug('Terminate command sent', { instanceId });
    }

    /**
     * Get Docker container logs from an EC2 instance via SSM
     * 
     * @param instanceId - Instance containing the container
     * @returns Promise<string> - Container logs
     * 
     * //! REQUIREMENT: Instance must have SSM agent installed and EC2SSMRole attached
     * //TODO: Add support for real-time log streaming
     * //TODO: Add support for log filtering and search
     */
    async getContainerLogs(instanceId: string): Promise<string> {
        logger.debug('Fetching container logs via SSM', { instanceId });

        const command = new SendCommandCommand({
            InstanceIds: [instanceId],
            DocumentName: 'AWS-RunShellScript',
            Parameters: {
                'commands': ['docker logs deployed-container --tail 100'] // Last 100 lines
            }
        });

        const result = await this.ssmClient.send(command);
        const commandId = result.Command!.CommandId!;

        logger.debug('SSM command sent, waiting for execution', { commandId });

        // Wait for command to complete
        //TODO: Replace with proper polling mechanism
        await new Promise(resolve => setTimeout(resolve, 5000));

        const getOutput = new GetCommandInvocationCommand({
            CommandId: commandId,
            InstanceId: instanceId
        });

        const output = await this.ssmClient.send(getOutput);
        logger.debug('Container logs fetched', {
            instanceId,
            logLength: output.StandardOutputContent?.length || 0
        });

        return output.StandardOutputContent || 'No logs available';
    }

    /**
     * Assign an Elastic IP address to an instance
     * 
     * @param instanceId - Instance to assign Elastic IP to
     * @returns Promise<string> - Assigned public IP address
     * 
     * //! COST: Elastic IPs incur charges when not attached to running instances
     * //? Consider using DNS names instead for most use cases
     */
    private async assignPublicUrl(instanceId: string): Promise<string> {
        logger.debug('Allocating Elastic IP', { instanceId });

        // Allocate Elastic IP
        const allocateCommand = new AllocateAddressCommand({
            Domain: 'vpc'
        });
        const allocation = await this.ec2Client.send(allocateCommand);
        logger.debug('Elastic IP allocated', {
            allocationId: allocation.AllocationId,
            publicIp: allocation.PublicIp
        });

        // Associate with instance
        logger.debug('Associating Elastic IP with instance', {
            instanceId,
            allocationId: allocation.AllocationId
        });
        const associateCommand = new AssociateAddressCommand({
            InstanceId: instanceId,
            AllocationId: allocation.AllocationId
        });
        await this.ec2Client.send(associateCommand);

        logger.debug('Elastic IP associated successfully', {
            instanceId,
            publicIp: allocation.PublicIp
        });
        return allocation.PublicIp!;
    }

    /**
     * Convert AWS tag array to key-value object
     * 
     * @param tags - AWS tag array
     * @returns Record<string, string> - Key-value tag object
     */
    private formatTags(tags: any[]): Record<string, string> {
        const formatted: Record<string, string> = {};
        for (const tag of tags) {
            formatted[tag.Key] = tag.Value;
        }
        return formatted;
    }
}