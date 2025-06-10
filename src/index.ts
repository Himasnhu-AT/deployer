#!/usr/bin/env node

/**
 * ================================================================================
 * DEPLOYER CLI - Main Entry Point
 * ================================================================================
 * 
 * Command-line interface for deploying and managing Docker containers on AWS EC2.
 * This is the primary entry point that orchestrates all CLI commands and operations.
 * 
 * AVAILABLE COMMANDS:
 * • create   - Deploy new EC2 instances with Docker containers
 * • cluster  - Manage multiple instances as a cluster
 * • list     - Display all managed instances and their status
 * • logs     - Retrieve container logs from instances
 * • start    - Start stopped instances
 * • stop     - Stop running instances  
 * • delete   - Terminate and cleanup instances
 * 
 * GLOBAL OPTIONS:
 * • --verbose (-v) - Enable detailed debug logging
 * • --version      - Show CLI version information
 * • --help         - Display command help
 * 
 * USAGE EXAMPLES:
 * deployer create --image nginx:latest --type t3.micro
 * deployer list --cluster production
 * deployer logs --instance i-1234567890abcdef0
 * 
 * @author Deployer CLI Team
 * @version 1.0.0
 * @since 2024
 * @license MIT
 */

import { Command } from 'commander';
import { createCommand } from './commands/create';
import { clusterCommand } from './commands/cluster';
import { listCommand } from './commands/list';
import { logsCommand } from './commands/logs';
import { stopCommand } from './commands/stop';
import { startCommand } from './commands/start';
import { deleteCommand } from './commands/delete';
import { logger } from './utils/logger';

// Initialize the main CLI program
const program = new Command();

/**
 * Configure the main CLI program with metadata and global options
 * 
 * Sets up the primary command structure, version info, and global flags
 * that apply to all subcommands.
 * 
 * //? Program name appears in help text and error messages
 * //TODO: Add configuration file support for default options
 * //TODO: Add shell completion support
 */
program
    .name('deployer')
    .description('Deploy Docker containers to AWS EC2 instances')
    .version('1.0.0')
    .option('-v, --verbose', 'Enable verbose logging with detailed debug information')
    .hook('preAction', (thisCommand, actionCommand) => {
        // Set up global configuration before any command executes
        const options = thisCommand.opts();

        // Configure verbose logging if requested
        if (options.verbose) {
            logger.setVerbose(true);
            //? Verbose mode provides detailed AWS API calls and timing information
        }

        // Initialize execution tracking for performance monitoring
        const commandName = actionCommand.name();
        const fullCommand = `deployer ${commandName} ${process.argv.slice(3).join(' ')}`;
        logger.startExecution(fullCommand);

        // Log command execution start for debugging
        logger.debug('Command execution started', {
            command: commandName,
            args: process.argv.slice(3),
            options: options
        });
    });

// Register all available commands
//! ORDER MATTERS: Commands are displayed in help text in registration order
program.addCommand(createCommand);    // Primary deployment command
program.addCommand(clusterCommand);   // Multi-instance management  
program.addCommand(listCommand);      // Instance discovery and status
program.addCommand(logsCommand);      // Container log retrieval
program.addCommand(stopCommand);      // Instance lifecycle management
program.addCommand(startCommand);     // Instance lifecycle management
program.addCommand(deleteCommand);    // Cleanup and termination

// Parse command line arguments and execute the appropriate command
//? Commander.js automatically handles help, version, and error cases
//! CRITICAL: This must be the last line - it triggers command execution
program.parse();