/**
 * ================================================================================
 * STOP COMMAND - Instance Lifecycle Management
 * ================================================================================
 * 
 * Command for stopping running EC2 instances. Provides graceful shutdown
 * of deployer-managed infrastructure while preserving data and configuration.
 * 
 * COMMAND FEATURES:
 * • Instance Shutdown - Stop running EC2 instances gracefully
 * • Data Preservation - EBS volumes retain data when stopped
 * • Cost Optimization - Stop billing for compute resources
 * • Container Safety - Docker containers stop gracefully
 * 
 * PREREQUISITES:
 * • Instance must exist and be in 'running' state
 * • User must have EC2:StopInstances permission
 * • Instance must be EBS-backed (not instance-store)
 * 
 * IMPORTANT NOTES:
 * • Stopping preserves EBS data but loses instance-store data
 * • Public IP address may change when instance is restarted
 * • Billing stops for compute but continues for EBS storage
 * • Container state is preserved and will resume on restart
 * 
 * USAGE:
 * deployer stop i-1234567890abcdef0
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
 * STOP COMMAND DEFINITION
 * ================================================================================
 * 
 * Simple command that stops a running EC2 instance by ID.
 * Provides graceful shutdown with data preservation.
 * 
 * //? Stopping instances reduces costs while preserving deployment state
 * //! DATA WARNING: Instance-store volumes lose data when stopped
 * //TODO: Add confirmation prompt for instances with instance-store volumes
 * //TODO: Add option to wait for instance to reach stopped state
 */
export const stopCommand = new Command('stop')
    .description('Stop a running EC2 instance')
    .argument('<instance-id>', 'EC2 instance ID to stop')
    .action(async (instanceId) => {
        try {
            // Log operation start
            logger.info(`Stopping instance ${instanceId}...`);
            logger.debug('Starting instance stop operation', { instanceId });

            // Initialize AWS service
            logger.debug('Initializing AWS service for instance stop');
            const awsService = new AWSService();

            // Execute stop command
            logger.debug('Sending stop command to AWS');
            await awsService.stopInstance(instanceId);

            // Report success
            logger.success(`Instance ${instanceId} has been stopped`);
            logger.debug('Instance stop operation completed', { instanceId });

            // Provide helpful information
            logger.info('Note: Compute billing has stopped, but EBS volumes continue to incur storage charges');
            logger.info('The instance can be restarted with: deployer start ' + instanceId);

        } catch (error) {
            // Handle and report errors
            logger.error('Failed to stop instance', error as Error);
            logger.debug('Instance stop operation failed', {
                instanceId,
                error: error instanceof Error ? error.message : error
            });

            // Provide helpful error guidance
            if (error instanceof Error) {
                if (error.message.includes('InvalidInstanceId')) {
                    logger.info('Hint: Check that the instance ID is correct and the instance exists');
                } else if (error.message.includes('IncorrectInstanceState')) {
                    logger.info('Hint: Instance may already be stopped or in a transitional state');
                } else if (error.message.includes('UnsupportedOperation')) {
                    logger.info('Hint: Instance-store backed instances cannot be stopped, only terminated');
                } else if (error.message.includes('UnauthorizedOperation')) {
                    logger.info('Hint: Check that you have EC2:StopInstances permission');
                }
            }

            process.exit(1);
        }
    });