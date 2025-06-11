/**
 * ================================================================================
 * CREDENTIAL VALIDATOR - AWS Authentication & IAM Management
 * ================================================================================
 * 
 * Handles AWS credential validation, setup assistance, and required IAM role
 * creation. Ensures proper authentication and permissions before deployment
 * operations can proceed.
 * 
 * KEY FEATURES:
 * • Credential Validation - Test AWS authentication using STS
 * • Interactive Setup - Guide users through credential configuration
 * • IAM Role Management - Create required EC2SSMRole automatically
 * • Permission Verification - Ensure sufficient AWS permissions
 * • Setup Guidance - Provide detailed help for AWS configuration
 * 
 * REQUIRED AWS PERMISSIONS:
 * • STS:GetCallerIdentity - Validate credentials
 * • IAM:GetRole, CreateRole - Manage IAM roles
 * • IAM:AttachRolePolicy - Attach required policies
 * • IAM:CreateInstanceProfile - Create instance profiles
 * • IAM:AddRoleToInstanceProfile - Link roles to profiles
 * 
 * DEPENDENCIES:
 * • AWS SDK v3 - STS and IAM client operations
 * • Inquirer - Interactive command-line prompts
 * • Logger - Structured logging and user feedback
 * 
 * @author Himanshu
 * @version 1.0.0
 * @since 2025
 * @license BSD-3-Clause
 */

import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { IAMClient, GetRoleCommand, CreateRoleCommand, AttachRolePolicyCommand, CreateInstanceProfileCommand, AddRoleToInstanceProfileCommand } from '@aws-sdk/client-iam';
import { logger } from './logger';
import inquirer from 'inquirer';

/**
 * ================================================================================
 * CREDENTIAL VALIDATOR CLASS
 * ================================================================================
 * 
 * Main class for handling AWS credential validation and setup. Provides both
 * programmatic validation and interactive user assistance for credential setup.
 * 
 * //! CRITICAL: Without valid credentials, no AWS operations can succeed
 * //? Provides helpful guidance for new users to get started quickly
 * //TODO: Add support for MFA and temporary credentials
 * //TODO: Add credential refresh mechanisms
 */
export class CredentialValidator {
    private stsClient: STSClient;      // STS client for credential validation
    private iamClient: IAMClient;      // IAM client for role management

    /**
     * Initialize credential validator with AWS clients
     * 
     * Sets up STS and IAM clients for credential validation and role management.
     * Uses the provided region for all AWS operations.
     * 
     * @param region - AWS region for client operations
     * 
     * //? Default region is us-east-1 for compatibility and cost optimization
     * //TODO: Add support for cross-region role validation
     */
    constructor(region: string = 'us-east-1') {
        this.stsClient = new STSClient({ region });
        this.iamClient = new IAMClient({ region });
        logger.debug('CredentialValidator initialized', { region });
    }

    /**
     * ================================================================
     * CREDENTIAL VALIDATION
     * ================================================================
     */

    /**
     * Validate current AWS credentials using STS GetCallerIdentity
     * 
     * Tests if the currently configured AWS credentials are valid and
     * can make authenticated API calls to AWS services.
     * 
     * @returns Promise<boolean> - True if credentials are valid
     * 
     * //? Uses STS GetCallerIdentity as it's available to all authenticated users
     * //! SECURITY: Does not validate permission levels, only authentication
     * //TODO: Add permission-level validation for required services
     */
    async validateCredentials(): Promise<boolean> {
        const timer = logger.timer('credential-validation');

        try {
            logger.debug('Validating AWS credentials...');

            // Test credentials with STS GetCallerIdentity
            const command = new GetCallerIdentityCommand({});
            const result = await this.stsClient.send(command);

            logger.debug('AWS credentials validated successfully', {
                account: result.Account,
                arn: result.Arn,
                userId: result.UserId
            });

            logger.success(`AWS credentials valid - Account: ${result.Account}`);
            timer.end();
            return true;

        } catch (error) {
            timer.end();
            logger.debug('AWS credential validation failed', {
                error: error instanceof Error ? error.message : error
            });
            return false;
        }
    }

    /**
     * ================================================================
     * IAM ROLE MANAGEMENT
     * ================================================================
     */

    /**
     * Validate or create the required EC2SSMRole for instance management
     * 
     * Checks if the EC2SSMRole exists and creates it if missing. This role
     * is essential for SSM operations on deployed EC2 instances.
     * 
     * @returns Promise<boolean> - True if role exists or was created successfully
     * 
     * //! DEPENDENCY: EC2 instances need this role for SSM agent functionality
     * //? Role includes AmazonSSMManagedInstanceCore policy for remote management
     * //TODO: Add custom policy creation for minimal permissions
     */
    async validateOrCreateIAMRole(): Promise<boolean> {
        const timer = logger.timer('iam-role-validation');

        try {
            logger.debug('Checking if EC2SSMRole exists...');

            // Check if the required role already exists
            try {
                const roleTimer = logger.timer('iam-role-check');
                await this.iamClient.send(new GetRoleCommand({ RoleName: 'EC2SSMRole' }));
                roleTimer.end();

                logger.debug('EC2SSMRole already exists');
                timer.end();
                return true;

            } catch (error: any) {
                // Role doesn't exist, attempt to create it
                if (error.name === 'NoSuchEntityException') {
                    logger.debug('EC2SSMRole does not exist, will create it');
                    const createResult = await this.createRequiredIAMRole();
                    timer.end();
                    return createResult;
                }
                throw error;
            }

        } catch (error) {
            timer.end();
            logger.debug('Error checking IAM role', {
                error: error instanceof Error ? error.message : error
            });
            return false;
        }
    }

    /**
     * Create the required IAM role and instance profile for EC2 instances
     * 
     * Creates a complete IAM setup including:
     * - EC2SSMRole with proper trust policy
     * - Attached AmazonSSMManagedInstanceCore policy
     * - Instance profile for EC2 attachment
     * - Role-to-profile association
     * 
     * @returns Promise<boolean> - True if creation was successful
     * 
     * //! PERMISSIONS: Requires IAM management permissions
     * //? Role propagation may take a few minutes after creation
     * //TODO: Add validation of existing policies before attachment
     */
    private async createRequiredIAMRole(): Promise<boolean> {
        const timer = logger.timer('iam-role-creation');

        try {
            logger.step('IAM_CREATE', 'Creating required IAM role and instance profile');
            logger.info('Creating required IAM role and instance profile...');

            // Define trust policy for EC2 service
            const roleDocument = {
                Version: '2012-10-17',
                Statement: [
                    {
                        Effect: 'Allow',
                        Principal: { Service: 'ec2.amazonaws.com' },
                        Action: 'sts:AssumeRole'
                    }
                ]
            };

            // Step 1: Create the IAM role
            logger.debug('Creating IAM role', { roleName: 'EC2SSMRole' });
            const createRoleTimer = logger.timer('iam-role-create');
            await this.iamClient.send(new CreateRoleCommand({
                RoleName: 'EC2SSMRole',
                AssumeRolePolicyDocument: JSON.stringify(roleDocument),
                Description: 'Role for EC2 instances to use SSM - Created by deployer CLI'
            }));
            createRoleTimer.end();
            logger.debug('IAM role created successfully');

            // Step 2: Attach required AWS managed policy
            logger.debug('Attaching policy to IAM role', {
                roleName: 'EC2SSMRole',
                policyArn: 'arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore'
            });
            const attachPolicyTimer = logger.timer('iam-policy-attach');
            await this.iamClient.send(new AttachRolePolicyCommand({
                RoleName: 'EC2SSMRole',
                PolicyArn: 'arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore'
            }));
            attachPolicyTimer.end();
            logger.debug('Policy attached successfully');

            // Step 3: Create instance profile for EC2 attachment
            logger.debug('Creating instance profile', { profileName: 'EC2SSMRole' });
            const createProfileTimer = logger.timer('iam-profile-create');
            await this.iamClient.send(new CreateInstanceProfileCommand({
                InstanceProfileName: 'EC2SSMRole'
            }));
            createProfileTimer.end();
            logger.debug('Instance profile created successfully');

            // Step 4: Associate role with instance profile
            logger.debug('Adding role to instance profile');
            const addRoleTimer = logger.timer('iam-role-add');
            await this.iamClient.send(new AddRoleToInstanceProfileCommand({
                InstanceProfileName: 'EC2SSMRole',
                RoleName: 'EC2SSMRole'
            }));
            addRoleTimer.end();
            logger.debug('Role added to instance profile successfully');

            timer.end();
            logger.step('IAM_CREATE', 'IAM role and instance profile created successfully');
            logger.success('IAM role and instance profile created successfully');
            logger.info('Note: It may take a few minutes for the new role to propagate');

            return true;

        } catch (error) {
            timer.end();
            logger.step('IAM_ERROR', 'Failed to create IAM role', {
                error: error instanceof Error ? error.message : error
            });
            logger.error('Failed to create IAM role', error as Error);
            return false;
        }
    }

    /**
     * ================================================================
     * INTERACTIVE CREDENTIAL SETUP
     * ================================================================
     */

    /**
     * Guide user through credential setup process
     * 
     * Provides interactive assistance for users who need to configure
     * AWS credentials. Offers multiple setup methods and guidance.
     * 
     * //? Helps new users get started without extensive AWS knowledge
     * //! SECURITY: Cannot directly set credentials for security reasons
     * //TODO: Add validation of user-provided credentials before proceeding
     */
    async promptForCredentialSetup(): Promise<void> {
        logger.step('CRED_SETUP', 'Starting credential setup process');
        logger.warn('AWS credentials not found or invalid');

        console.log('\n🔧 AWS Setup Required\n');

        // Present setup options to user
        const setupChoice = await inquirer.prompt([{
            type: 'list',
            name: 'method',
            message: 'How would you like to configure AWS credentials?',
            choices: [
                { name: 'I already have AWS CLI configured', value: 'existing' },
                { name: 'Set up using AWS Access Keys', value: 'keys' },
                { name: 'Get help with AWS setup', value: 'help' }
            ]
        }]);

        logger.debug('User selected credential setup method', { method: setupChoice.method });

        // Route to appropriate setup method
        switch (setupChoice.method) {
            case 'existing':
                await this.checkExistingSetup();
                break;
            case 'keys':
                await this.setupWithKeys();
                break;
            case 'help':
                this.showSetupHelp();
                break;
        }
    }

    /**
     * Check if existing AWS configuration is now working
     * 
     * Re-validates credentials for users who claim to have existing setup.
     * Provides troubleshooting guidance if validation still fails.
     * 
     * //? Useful when users have AWS CLI configured but environment issues exist
     */
    private async checkExistingSetup(): Promise<void> {
        logger.step('CRED_CHECK', 'Checking existing AWS configuration');
        logger.info('Checking existing AWS configuration...');

        const isValid = await this.validateCredentials();

        if (isValid) {
            logger.success('AWS credentials are now working!');
        } else {
            logger.error('AWS credentials still not working. Please check your configuration.');

            // Provide troubleshooting guidance
            console.log('\nTroubleshooting:');
            console.log('1. Run: aws configure list');
            console.log('2. Ensure your AWS profile has proper permissions');
            console.log('3. Check ~/.aws/credentials and ~/.aws/config files');
        }
    }

    /**
     * Guide user through access key setup process
     * 
     * Collects access key information and provides setup commands.
     * Does not directly configure credentials for security reasons.
     * 
     * //! SECURITY: Cannot programmatically set credentials
     * //? User must run the provided commands manually for security
     */
    private async setupWithKeys(): Promise<void> {
        logger.step('CRED_KEYS', 'Starting access key setup process');

        // Provide guidance for obtaining access keys
        console.log('\n📋 To get AWS Access Keys:');
        console.log('1. Go to AWS Console → IAM → Users → Your User → Security Credentials');
        console.log('2. Click "Create access key" → Choose "CLI" → Create');
        console.log('3. Copy the Access Key ID and Secret Access Key\n');

        // Collect credential information from user
        const credentials = await inquirer.prompt([
            {
                type: 'input',
                name: 'accessKeyId',
                message: 'Enter AWS Access Key ID:',
                validate: (input: string) => input.length > 0 || 'Access Key ID is required'
            },
            {
                type: 'password',
                name: 'secretAccessKey',
                message: 'Enter AWS Secret Access Key:',
                validate: (input: string) => input.length > 0 || 'Secret Access Key is required'
            },
            {
                type: 'input',
                name: 'region',
                message: 'Enter AWS Region:',
                default: 'us-east-1'
            }
        ]);

        // Provide setup commands for user to execute
        console.log('\n💾 Setting up AWS credentials...');
        console.log('You can also run these commands manually:');
        console.log('aws configure set aws_access_key_id ' + credentials.accessKeyId);
        console.log('aws configure set aws_secret_access_key ****');
        console.log('aws configure set default.region ' + credentials.region);

        // Note: We can't actually set the credentials programmatically in a secure way
        // The user needs to do this themselves
        logger.warn('Please run the above commands to configure AWS CLI, then try again.');
    }

    /**
     * Display comprehensive AWS setup help and guidance
     * 
     * Provides detailed instructions for multiple credential setup methods
     * and explains required permissions for the deployer CLI.
     * 
     * //? Comprehensive guide reduces support burden and user confusion
     * //TODO: Add links to detailed AWS documentation
     */
    private showSetupHelp(): void {
        logger.step('CRED_HELP', 'Displaying AWS setup help');

        console.log('\n📚 AWS Setup Guide\n');

        console.log('🔹 Option 1: Using AWS CLI');
        console.log('   1. Install AWS CLI: https://aws.amazon.com/cli/');
        console.log('   2. Run: aws configure');
        console.log('   3. Enter your credentials when prompted\n');

        console.log('🔹 Option 2: Using Environment Variables');
        console.log('   export AWS_ACCESS_KEY_ID=your_access_key');
        console.log('   export AWS_SECRET_ACCESS_KEY=your_secret_key');
        console.log('   export AWS_DEFAULT_REGION=us-east-1\n');

        console.log('🔹 Option 3: Using AWS Profiles');
        console.log('   aws configure --profile myprofile');
        console.log('   export AWS_PROFILE=myprofile\n');

        console.log('🔹 Required Permissions:');
        console.log('   - EC2 (create, describe, manage instances)');
        console.log('   - IAM (create roles and instance profiles)');
        console.log('   - SSM (for container logs and management)');
        console.log('   - CloudWatch Logs (optional, for logging)');
        console.log('   - Route53 (optional, for URL assignment)\n');

        console.log('💡 Quick Start:');
        console.log('   If you have admin access, you can use the PowerUserAccess policy.');
        console.log('   For production, create a custom policy with only required permissions.\n');
    }
}

/**
 * ================================================================================
 * SINGLETON CREDENTIAL VALIDATOR INSTANCE
 * ================================================================================
 * 
 * Exported singleton instance for use throughout the application.
 * Ensures consistent credential validation across all modules.
 * 
 * //! IMPORTANT: Use this singleton instance for consistent behavior
 * //? Single instance maintains state and reduces client initialization overhead
 */
export const credentialValidator = new CredentialValidator();