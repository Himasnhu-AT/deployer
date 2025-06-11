/**
 * ================================================================================
 * LOGS COMMAND - Container Log Retrieval
 * ================================================================================
 * 
 * Command for retrieving Docker container logs from EC2 instances using AWS SSM.
 * Provides remote log access without requiring SSH or direct instance access.
 * 
 * COMMAND FEATURES:
 * • Remote Log Access - Retrieve logs via AWS SSM without SSH
 * • Container-Specific - Targets the deployed Docker container
 * • Error Handling - Graceful handling of SSM and container failures
 * • Real-time Display - Shows container output with proper formatting
 * 
 * REQUIREMENTS:
 * • Instance must have SSM agent running
 * • EC2SSMRole must be attached to the instance
 * • Container must be named 'deployed-container'
 * • Instance must be in running state
 * 
 * USAGE:
 * deployer logs i-1234567890abcdef0
 * deployer logs i-1234567890abcdef0 --follow (planned feature)
 * 
 * @author Himanshu
 * @version 1.0.0
 * @since 2025
 * @license BSD-3-Clause
 */

import { Command } from 'commander';
import { AWSService } from '../services/aws';
import { logger } from '../utils/logger';
import chalk from 'chalk';

/**
 * ================================================================================
 * LOGS COMMAND DEFINITION
 * ================================================================================
 * 
 * Command that retrieves container logs from a specific EC2 instance.
 * Uses AWS SSM to execute remote Docker commands for log retrieval.
 * 
 * //! REQUIREMENT: Instance must have SSM agent and proper IAM role
 * //? SSM provides secure remote access without exposing SSH ports
 * //TODO: Implement --follow option for real-time log streaming
 * //TODO: Add --lines option to specify number of log lines
 * //TODO: Add --since option for time-based log filtering
 */
export const logsCommand = new Command('logs')
    .description('Get logs from the Docker container running on an instance')
    .argument('<instance-id>', 'EC2 instance ID')
    .option('--follow', 'Follow log output (not implemented yet)')
    .action(async (instanceId, options) => {
        try {
            // Log the operation start
            logger.info(`Fetching logs for instance ${instanceId}...`);
            logger.debug('Starting log retrieval operation', { instanceId, options });

            // Check for unimplemented options
            if (options.follow) {
                logger.warn('--follow option is not yet implemented');
                //TODO: Implement real-time log following using SSM sessions
            }

            // Initialize AWS service for SSM operations
            logger.debug('Initializing AWS service for log retrieval');
            const awsService = new AWSService();

            // Retrieve container logs via SSM
            logger.debug('Executing SSM command to retrieve container logs');
            const logs = await awsService.getContainerLogs(instanceId);

            // Display formatted logs
            console.log(chalk.bold('\n📄 Container Logs:\n'));
            console.log(logs);

            logger.success('Logs retrieved successfully');
            logger.debug('Log retrieval completed', {
                instanceId,
                logLength: logs.length
            });

        } catch (error) {
            // Handle various error scenarios
            logger.error('Failed to fetch logs', error as Error);
            logger.debug('Log retrieval failed', {
                instanceId,
                error: error instanceof Error ? error.message : error
            });

            // Provide helpful error guidance
            if (error instanceof Error) {
                if (error.message.includes('InvalidInstanceId')) {
                    logger.info('Hint: Check that the instance ID is correct and the instance exists');
                } else if (error.message.includes('SSM')) {
                    logger.info('Hint: Ensure the instance has SSM agent running and EC2SSMRole attached');
                } else if (error.message.includes('timeout')) {
                    logger.info('Hint: The instance may be starting up or the container may not be running yet');
                }
            }

            process.exit(1);
        }
    });