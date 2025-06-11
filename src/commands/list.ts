/**
 * ================================================================================
 * LIST COMMAND - Instance Discovery and Status Display
 * ================================================================================
 * 
 * Command for discovering and displaying all EC2 instances managed by the
 * deployer CLI. Provides comprehensive status information and uptime tracking.
 * 
 * COMMAND FEATURES:
 * • Instance Discovery - Find all deployer-managed EC2 instances
 * • Status Display - Show current state with color-coded indicators
 * • Network Information - Display public IPs, DNS names, and URLs
 * • Uptime Calculation - Calculate and display instance uptime
 * • Formatted Output - Clean, readable table-style display
 * 
 * FILTERING:
 * • Only shows instances tagged with 'ManagedBy=deployer'
 * • Excludes terminated instances for cleaner output
 * • Includes instances in all states (running, stopped, pending)
 * 
 * OUTPUT FORMAT:
 * • Color-coded state indicators (green=running, yellow=stopped, red=error)
 * • Formatted timestamps and uptime calculations
 * • Complete network configuration details
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
 * LIST COMMAND DEFINITION
 * ================================================================================
 * 
 * Simple command that discovers and displays all managed instances.
 * No options required - automatically finds all deployer-managed instances.
 * 
 * //? Uses AWS tags to filter only deployer-managed instances
 * //! PERFORMANCE: May be slow with many instances - consider pagination
 * //TODO: Add filtering options (by state, type, image, etc.)
 * //TODO: Add sorting options (by launch time, state, type)
 */
export const listCommand = new Command('list')
    .description('List all deployer-managed EC2 instances')
    .action(async () => {
        try {
            // Initialize AWS service for instance discovery
            logger.debug('Initializing AWS service for instance listing');
            const awsService = new AWSService();

            // Retrieve all managed instances
            logger.debug('Fetching deployer-managed instances');
            const instances = await awsService.listInstances();

            // Handle empty result set
            if (instances.length === 0) {
                logger.info('No deployer-managed instances found.');
                logger.debug('No instances returned from AWS query');
                return;
            }

            // Display formatted instance list
            logger.debug(`Found ${instances.length} managed instances`);
            console.log(chalk.bold('\n📋 Deployer-Managed Instances:\n'));

            // Process and display each instance
            instances.forEach((instance) => {
                // Determine state color for visual feedback
                const stateColor = instance.state === 'running' ? 'green' :
                    instance.state === 'stopped' ? 'yellow' : 'red';

                // Display instance details with formatting
                console.log(chalk.bold(`Instance ID: ${instance.instanceId}`));
                console.log(`  Type: ${instance.instanceType}`);
                console.log(`  Docker Image: ${instance.dockerImage}`);
                console.log(`  State: ${chalk[stateColor](instance.state)}`);
                console.log(`  Public IP: ${instance.publicIp || 'N/A'}`);
                console.log(`  Public DNS: ${instance.publicDns || 'N/A'}`);

                // Show assigned URL if configured
                if (instance.assignedUrl) {
                    console.log(`  Assigned URL: ${instance.assignedUrl}`);
                }

                console.log(`  Launch Time: ${instance.launchTime.toISOString()}`);
                console.log(`  Uptime: ${getUptime(instance.launchTime)}`);
                console.log(''); // Empty line for readability
            });

            logger.success(`Listed ${instances.length} managed instances`);

        } catch (error) {
            // Handle and report any errors during listing
            logger.error('Failed to list instances', error as Error);
            process.exit(1);
        }
    });

/**
 * Calculate and format instance uptime from launch time
 * 
 * Computes the difference between current time and instance launch time,
 * formatting the result in a human-readable format.
 * 
 * @param launchTime - Instance launch timestamp
 * @returns string - Formatted uptime (e.g., "2h 45m", "30m")
 * 
 * //? Provides quick visual reference for instance age
 * //TODO: Add support for days when uptime > 24 hours
 * //TODO: Add timezone consideration for accurate display
 */
function getUptime(launchTime: Date): string {
    const now = new Date();
    const uptimeMs = now.getTime() - launchTime.getTime();

    // Convert milliseconds to hours and minutes
    const uptimeHours = Math.floor(uptimeMs / (1000 * 60 * 60));
    const uptimeMinutes = Math.floor((uptimeMs % (1000 * 60 * 60)) / (1000 * 60));

    // Format based on duration
    if (uptimeHours > 0) {
        return `${uptimeHours}h ${uptimeMinutes}m`;
    } else {
        return `${uptimeMinutes}m`;
    }
}