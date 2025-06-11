/**
 * ================================================================================
 * CREATE COMMAND - EC2 Instance Deployment
 * ================================================================================
 * 
 * Primary command for deploying Docker containers to new EC2 instances.
 * Handles the complete deployment workflow from credential validation to
 * instance creation and configuration.
 * 
 * COMMAND WORKFLOW:
 * 1. AWS Credential Validation - Ensure proper authentication
 * 2. IAM Role Verification - Check/create required EC2SSMRole
 * 3. Option Collection - Interactive or command-line configuration
 * 4. Instance Creation - Deploy EC2 with Docker container
 * 5. Status Reporting - Display deployment results
 * 
 * COMMAND OPTIONS:
 * • --instance-type    - EC2 instance type (required)
 * • --docker-image     - Docker image to deploy (required)
 * • --gpu              - Number of GPUs for GPU instances
 * • --cpu              - CPU count specification
 * • --memory           - Memory allocation in GB
 * • --inbound          - Inbound security rules (CIDR:PORT format)
 * • --outbound         - Outbound security rules (CIDR:PORT format)
 * • --assign-url       - Assign Elastic IP for static public access
 * • --name             - Custom instance name
 * • --interactive      - Force interactive configuration mode
 * • --skip-validation  - Skip AWS credential validation (dangerous)
 * 
 * EXAMPLES:
 * deployer create --instance-type t3.micro --docker-image nginx:latest
 * deployer create --interactive
 * deployer create --instance-type g4dn.xlarge --docker-image tensorflow/tensorflow:latest-gpu --gpu 1
 * 
 * @author Himanshu
 * @version 1.0.0
 * @since 2025
 * @license BSD-3-Clause
 */

import { Command } from 'commander';
import { AWSService } from '../services/aws';
import { CreateInstanceOptions } from '../types';
import { logger } from '../utils/logger';
import { questionnaire, QuestionnaireOptions } from '../utils/questionnaire';
import { credentialValidator } from '../utils/credentials';

/**
 * ================================================================================
 * CREATE COMMAND DEFINITION
 * ================================================================================
 * 
 * Main command definition with all options and action handler.
 * Orchestrates the entire instance creation workflow.
 * 
 * //! IMPORTANT: This is the primary deployment command - handle errors carefully
 * //? Interactive mode helps users avoid command-line complexity
 * //TODO: Add dry-run mode for cost estimation
 * //TODO: Add template/preset support for common configurations
 */
export const createCommand = new Command('create')
    .description('Create and deploy a Docker container to a new EC2 instance')
    // Core configuration options
    .option('--instance-type <type>', 'EC2 instance type (e.g., t3.micro, g4dn.xlarge)')
    .option('--docker-image <image>', 'Docker image to deploy (e.g., nginx:latest)')

    // Hardware specification options
    .option('--gpu <count>', 'Number of GPUs to assign', parseInt)
    .option('--cpu <count>', 'Number of CPUs to assign', parseInt)
    .option('--memory <gb>', 'Memory in GB to assign', parseInt)

    // Network security options
    .option('--inbound <rules...>', 'Inbound security rules (format: CIDR:PORT)')
    .option('--outbound <rules...>', 'Outbound security rules (format: CIDR:PORT)')

    // Additional configuration options
    .option('--assign-url', 'Assign a public URL/Elastic IP to the instance')
    .option('--name <name>', 'Custom name for the instance')

    // Mode and behavior options
    .option('--interactive', 'Force interactive mode even if all options are provided')
    .option('--skip-validation', 'Skip AWS credential and IAM role validation (use with caution)')

    .action(async (options) => {
        // Initialize performance tracking for the entire command
        const timer = logger.timer('create-command');

        try {
            // Log command initiation with provided options
            logger.step('INIT', 'Create command started', {
                providedOptions: options,
                executionId: logger.getExecutionId()
            });
            logger.info('Starting deployment process...');

            /**
             * ================================================================
             * PHASE 1: AWS CREDENTIAL AND SETUP VALIDATION
             * ================================================================
             * 
             * Validates AWS credentials and ensures required IAM roles exist.
             * Critical for successful AWS operations.
             * 
             * //! SECURITY: Skip validation only in trusted environments
             * //? Validation prevents deployment failures due to auth issues
             */
            if (!options.skipValidation) {
                logger.step('VALIDATION', 'Starting AWS credentials and setup validation');
                logger.info('Validating AWS credentials and setup...');

                // Validate existing AWS credentials
                const credTimer = logger.timer('credential-validation');
                const credentialsValid = await credentialValidator.validateCredentials();
                credTimer.end();
                logger.debug('Credential validation result', { credentialsValid });

                // Handle invalid credentials with setup workflow
                if (!credentialsValid) {
                    logger.step('SETUP', 'AWS credentials invalid, starting setup process');
                    await credentialValidator.promptForCredentialSetup();

                    // Re-validate after user setup
                    const revalidationTimer = logger.timer('credential-revalidation');
                    const stillInvalid = !(await credentialValidator.validateCredentials());
                    revalidationTimer.end();
                    logger.debug('Credential revalidation result', { stillInvalid });

                    if (stillInvalid) {
                        logger.error('AWS credentials are still not configured. Please set up your credentials and try again.');
                        logger.info('Hint: Run with --skip-validation to bypass this check (not recommended)');
                        process.exit(1);
                    }
                }

                // Validate or create required IAM role for SSM access
                logger.step('IAM', 'Checking required IAM role');
                logger.info('Checking required IAM role...');
                const iamTimer = logger.timer('iam-role-validation');
                const iamRoleValid = await credentialValidator.validateOrCreateIAMRole();
                iamTimer.end();
                logger.debug('IAM role validation result', { iamRoleValid });

                if (!iamRoleValid) {
                    logger.error('Failed to validate or create required IAM role. This may be due to insufficient permissions.');
                    logger.info('Please ensure your AWS user has IAM permissions or ask your AWS administrator to create the EC2SSMRole.');
                    process.exit(1);
                }

                logger.step('VALIDATION', 'AWS validation completed successfully');
            } else {
                logger.step('VALIDATION', 'AWS validation skipped as requested');
                logger.warn('Skipping AWS validation as requested');
                //! WARNING: Skipping validation may lead to deployment failures
            }

            /**
             * ================================================================
             * PHASE 2: CONFIGURATION COLLECTION
             * ================================================================
             * 
             * Collect missing configuration options through interactive prompts
             * or validate that all required options are provided.
             * 
             * //? Interactive mode provides user-friendly configuration
             * //TODO: Add configuration validation and recommendations
             */

            // Determine if interactive mode is needed
            const missingRequired = !options.instanceType || !options.dockerImage;
            const useInteractive = missingRequired || options.interactive;

            logger.debug('Interactive mode decision', {
                missingRequired,
                forceInteractive: options.interactive,
                useInteractive
            });

            // Start with command-line provided options
            let finalOptions: QuestionnaireOptions = {
                instanceType: options.instanceType,
                dockerImage: options.dockerImage,
                gpu: options.gpu,
                cpu: options.cpu,
                memory: options.memory,
                inbound: options.inbound,
                outbound: options.outbound,
                assignUrl: options.assignUrl,
                name: options.name
            };

            // Use interactive questionnaire if needed
            if (useInteractive) {
                logger.step('INTERACTIVE', 'Starting interactive configuration');

                if (missingRequired) {
                    logger.info('Some required options are missing. Starting interactive configuration...');
                } else {
                    logger.info('Interactive mode requested. Starting configuration wizard...');
                }

                const questionnaireTimer = logger.timer('questionnaire');
                finalOptions = await questionnaire.promptForMissingOptions(finalOptions);
                questionnaireTimer.end();

                logger.step('INTERACTIVE', 'Interactive configuration completed', { finalOptions });
            } else {
                logger.step('CONFIG', 'Using provided command-line options', { finalOptions });
            }

            // Final validation of required options
            if (!finalOptions.instanceType || !finalOptions.dockerImage) {
                logger.error('Missing required options: --instance-type and --docker-image are required');
                process.exit(1);
            }

            /**
             * ================================================================
             * PHASE 3: INSTANCE CREATION
             * ================================================================
             * 
             * Create the EC2 instance with Docker container deployment.
             * This is the main deployment operation.
             * 
             * //! COST: This operation incurs AWS charges
             * //? Monitor AWS billing to track deployment costs
             */

            // Convert questionnaire options to AWS service options
            const createOptions: CreateInstanceOptions = {
                instanceType: finalOptions.instanceType,
                dockerImage: finalOptions.dockerImage,
                gpu: finalOptions.gpu,
                cpu: finalOptions.cpu,
                memory: finalOptions.memory,
                inbound: finalOptions.inbound,
                outbound: finalOptions.outbound,
                assignUrl: finalOptions.assignUrl,
                name: finalOptions.name
            };

            logger.step('AWS_INIT', 'Initializing AWS service', { createOptions });
            logger.info('Initializing AWS service...');

            // Initialize AWS service and create instance
            const awsService = new AWSService();
            logger.debug('AWS service initialized, creating instance...');

            logger.step('INSTANCE_CREATE', 'Starting EC2 instance creation');
            const instanceTimer = logger.timer('instance-creation');
            const instance = await awsService.createInstance(createOptions);
            const instanceDuration = instanceTimer.end();

            logger.step('INSTANCE_CREATE', 'EC2 instance creation completed', {
                instance,
                duration: instanceDuration
            });

            /**
             * ================================================================
             * PHASE 4: SUCCESS REPORTING
             * ================================================================
             * 
             * Display deployment results and next steps to the user.
             * Provide all necessary information for accessing the instance.
             */

            const totalDuration = timer.end();
            logger.success('Deployment completed successfully!');

            // Display formatted instance details
            console.log('\n📋 Instance Details:');
            console.log(`   Instance ID: ${instance.instanceId}`);
            console.log(`   Instance Type: ${instance.instanceType}`);
            console.log(`   Docker Image: ${instance.dockerImage}`);
            console.log(`   Public IP: ${instance.publicIp || 'N/A'}`);
            console.log(`   Public DNS: ${instance.publicDns || 'N/A'}`);

            if (instance.assignedUrl) {
                console.log(`   Assigned URL: ${instance.assignedUrl}`);
            }

            console.log(`   State: ${instance.state}`);
            console.log(`   Launch Time: ${instance.launchTime.toISOString()}`);
            console.log(`   Total Duration: ${totalDuration}ms`);

            // Log final success state
            logger.step('COMPLETE', 'Deployment completed successfully', {
                instance,
                totalDuration,
                executionId: logger.getExecutionId()
            });

            // Provide next steps guidance
            logger.info('Your container should be starting up. Use `deployer logs <instance-id>` to check the status.');

        } catch (error) {
            /**
             * ================================================================
             * ERROR HANDLING
             * ================================================================
             * 
             * Handle any errors that occur during the deployment process.
             * Ensure proper cleanup and user notification.
             * 
             * //! CRITICAL: Proper error handling prevents hanging deployments
             * //TODO: Add automatic rollback for failed deployments
             */
            timer.end();

            logger.step('ERROR', 'Command execution failed', {
                error: error instanceof Error ? error.message : error,
                executionId: logger.getExecutionId()
            });

            logger.error('Failed to create instance', error as Error);
            process.exit(1);
        }
    });