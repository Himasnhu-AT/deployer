/**
 * ================================================================================
 * DELETE COMMAND - Instance Termination and Cleanup
 * ================================================================================
 * 
 * Command for permanently terminating EC2 instances and associated resources.
 * Provides safe deletion with confirmation to prevent accidental data loss.
 * 
 * COMMAND FEATURES:
 * • Instance Termination - Permanently delete EC2 instances
 * • Safety Confirmation - Require explicit confirmation or --force flag
 * • Resource Cleanup - Clean termination of associated resources
 * • Data Loss Warning - Clear warnings about permanent data loss
 * 
 * PREREQUISITES:
 * • Instance must exist (any state except already terminated)
 * • User must have EC2:TerminateInstances permission
 * • Understanding that this operation is irreversible
 * 
 * CRITICAL WARNINGS:
 * • Termination is PERMANENT and IRREVERSIBLE
 * • All instance-store data will be lost forever
 * • EBS volumes may be deleted based on configuration
 * • Associated Elastic IPs should be released separately
 * 
 * USAGE:
 * deployer delete i-1234567890abcdef0        # Interactive confirmation
 * deployer delete i-1234567890abcdef0 --force # Skip confirmation
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
 * DELETE COMMAND DEFINITION
 * ================================================================================
 * 
 * Command that permanently terminates an EC2 instance.
 * Includes safety measures to prevent accidental deletion.
 * 
 * //! CRITICAL: This operation is irreversible and permanent
 * //! DATA LOSS: All instance data will be permanently lost
 * //? Use --force flag to bypass confirmation in automation
 * //TODO: Add interactive confirmation prompt using inquirer
 * //TODO: Add option to preserve/snapshot EBS volumes before termination
 * //TODO: Add automatic Elastic IP cleanup
 */
export const deleteCommand = new Command('delete')
    .description('Terminate an EC2 instance permanently')
    .argument('<instance-id>', 'EC2 instance ID to delete')
    .option('--force', 'Skip confirmation prompt')
    .action(async (instanceId, options) => {
        try {
            // Safety check - require explicit confirmation unless forced
            if (!options.force) {
                logger.warn('This will permanently terminate the instance and cannot be undone.');
                logger.warn('All data on the instance will be lost forever.');
                logger.warn('This includes:');
                console.log('  • Docker container and its data');
                console.log('  • Any files stored on the instance');
                console.log('  • Instance configuration and state');
                console.log('  • Associated EBS volumes (if configured for deletion)');
                console.log('');

                //TODO: Replace with interactive confirmation prompt
                logger.info('Use --force to skip this warning and proceed with termination');
                logger.info('Example: deployer delete ' + instanceId + ' --force');
                return;
            }

            // Log operation start with warnings
            logger.info(`Terminating instance ${instanceId}...`);
            logger.debug('Starting instance termination operation', { instanceId, forced: true });

            // Initialize AWS service
            logger.debug('Initializing AWS service for instance termination');
            const awsService = new AWSService();

            // Execute termination command
            logger.debug('Sending terminate command to AWS');
            await awsService.terminateInstance(instanceId);

            // Report success with important notes
            logger.success(`Instance ${instanceId} has been terminated`);
            logger.debug('Instance termination operation completed', { instanceId });

            // Provide cleanup guidance
            logger.info('Instance termination initiated successfully');
            logger.info('Note: It may take a few minutes for the termination to complete');
            logger.warn('Remember to:');
            console.log('  • Release any associated Elastic IP addresses');
            console.log('  • Clean up security groups if no longer needed');
            console.log('  • Review any remaining EBS volumes');

        } catch (error) {
            // Handle and report errors
            logger.error('Failed to terminate instance', error as Error);
            logger.debug('Instance termination operation failed', {
                instanceId,
                error: error instanceof Error ? error.message : error
            });

            // Provide helpful error guidance
            if (error instanceof Error) {
                if (error.message.includes('InvalidInstanceId')) {
                    logger.info('Hint: Check that the instance ID is correct and the instance exists');
                } else if (error.message.includes('IncorrectInstanceState')) {
                    logger.info('Hint: Instance may already be terminated or in termination process');
                } else if (error.message.includes('OperationNotPermitted')) {
                    logger.info('Hint: Instance may have termination protection enabled');
                } else if (error.message.includes('UnauthorizedOperation')) {
                    logger.info('Hint: Check that you have EC2:TerminateInstances permission');
                }
            }

            process.exit(1);
        }
    });