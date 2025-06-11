/**
 * ================================================================================
 * START COMMAND - Instance Lifecycle Management
 * ================================================================================
 * 
 * Command for starting stopped EC2 instances. Provides simple instance state
 * management for deployer-managed infrastructure.
 * 
 * COMMAND FEATURES:
 * • Instance Startup - Start stopped EC2 instances
 * • State Validation - Ensure instance is in a startable state
 * • Error Handling - Graceful handling of AWS API errors
 * • Status Feedback - Clear user feedback on operation progress
 * 
 * PREREQUISITES:
 * • Instance must exist and be in 'stopped' state
 * • User must have EC2:StartInstances permission
 * • Instance must not be terminated
 * 
 * IMPORTANT NOTES:
 * • Starting an instance may result in a new public IP address
 * • Use Elastic IPs for consistent public addressing
 * • Container will restart automatically due to restart policy
 * 
 * USAGE:
 * deployer start i-1234567890abcdef0
 * 
 * @author Himanshu
 * @version 1.0.0
 * @since 2025
 * @license BSD-3-Clause
 */

import { Command } from 'commander';
import { AWSService } from '../services/aws';
import { logger } from '../utils/logger';

/**
 * ================================================================================
 * START COMMAND DEFINITION
 * ================================================================================
 * 
 * Simple command that starts a stopped EC2 instance by ID.
 * Does not require additional options - just the instance identifier.
 * 
 * //? Starting an instance may assign a new public IP address
 * //! COST: Starting instances will resume hourly billing charges
 * //TODO: Add option to wait for instance to reach running state
 * //TODO: Add option to verify container restart after instance start
 */
export const startCommand = new Command('start')
    .description('Start a stopped EC2 instance')
    .argument('<instance-id>', 'EC2 instance ID to start')
    .action(async (instanceId) => {
        try {
            // Log operation start
            logger.info(`Starting instance ${instanceId}...`);
            logger.debug('Starting instance start operation', { instanceId });

            // Initialize AWS service
            logger.debug('Initializing AWS service for instance start');
            const awsService = new AWSService();

            // Execute start command
            logger.debug('Sending start command to AWS');
            await awsService.startInstance(instanceId);

            // Report success
            logger.success(`Instance ${instanceId} has been started`);
            logger.debug('Instance start operation completed', { instanceId });

            // Provide helpful information
            logger.info('Note: It may take a few minutes for the instance to reach running state');
            logger.info('The Docker container will restart automatically once the instance is running');

        } catch (error) {
            // Handle and report errors
            logger.error('Failed to start instance', error as Error);
            logger.debug('Instance start operation failed', {
                instanceId,
                error: error instanceof Error ? error.message : error
            });

            // Provide helpful error guidance
            if (error instanceof Error) {
                if (error.message.includes('InvalidInstanceId')) {
                    logger.info('Hint: Check that the instance ID is correct and the instance exists');
                } else if (error.message.includes('IncorrectInstanceState')) {
                    logger.info('Hint: Instance may already be running or in a transitional state');
                } else if (error.message.includes('UnauthorizedOperation')) {
                    logger.info('Hint: Check that you have EC2:StartInstances permission');
                }
            }

            process.exit(1);
        }
    });