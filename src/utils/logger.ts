/**
 * ================================================================================
 * LOGGER UTILITY - Structured Logging and Monitoring
 * ================================================================================
 * 
 * Comprehensive logging solution providing console output, file logging, and
 * execution tracking for the Deployer CLI. Combines visual console feedback
 * with detailed file-based logging for debugging and monitoring.
 * 
 * KEY FEATURES:
 * • Multi-level Logging - info, warn, error, debug, success
 * • Execution Tracking - UUID-based execution correlation
 * • File Persistence - JSON-structured logs written to deployer.log
 * • Console Formatting - Colored, emoji-enhanced console output
 * • Performance Timing - Built-in timer functionality
 * • Progress Indicators - Spinner support for long operations
 * • Verbose Mode - Detailed debug output when enabled
 * 
 * LOG LEVELS:
 * • ERROR - Critical failures and exceptions
 * • WARN  - Non-critical issues and warnings
 * • INFO  - General operational information
 * • DEBUG - Detailed diagnostic information (verbose mode only)
 * 
 * OUTPUT DESTINATIONS:
 * • Console - Formatted, colored output for user interaction
 * • File - JSON-structured logs for analysis and debugging
 * 
 * @author Himanshu
 * @version 1.0.0
 * @since 2025
 * @license BSD-3-Clause
 */

import winston from 'winston';
import chalk from 'chalk';
import ora, { Ora } from 'ora';
import { randomUUID } from 'crypto';
import path from 'path';

/**
 * ================================================================================
 * LOGGER CLASS
 * ================================================================================
 * 
 * Main logging class that handles all output operations. Provides both console
 * and file logging with execution tracking and performance monitoring.
 * 
 * //! IMPORTANT: Singleton pattern - use the exported 'logger' instance
 * //? Log files are written to 'deployer.log' in the current working directory
 * //TODO: Add log rotation for large deployments
 * //TODO: Add structured log querying capabilities
 */
export class Logger {
    private winston: winston.Logger;          // Winston instance for file logging
    private verbose: boolean = false;         // Verbose mode flag
    private executionId: string = '';         // Current execution UUID
    private logFilePath: string;              // Absolute path to log file

    /**
     * Initialize logger with Winston backend and console formatting
     * 
     * Sets up dual-output logging: console for user interaction and
     * JSON file logging for debugging and analysis.
     * 
     * //? Log file is created in current working directory for easy access
     * //TODO: Add configurable log file location
     * //TODO: Add log compression and archiving
     */
    constructor() {
        // Set log file path in current working directory
        this.logFilePath = path.resolve(process.cwd(), 'deployer.log');

        // Configure Winston for structured file logging
        this.winston = winston.createLogger({
            level: 'info',
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.errors({ stack: true }),
                winston.format.json()
            ),
            transports: [
                new winston.transports.File({ filename: this.logFilePath })
            ]
        });
    }

    /**
     * Enable or disable verbose logging mode
     * 
     * Verbose mode shows detailed data objects
     * in both console and file output.
     * 
     * @param verbose - Verbose mode
     * 
     * //? Verbose mode is essential for troubleshooting AWS API issues
     * //TODO: Add granular control (e.g., AWS-only verbose)
     */
    setVerbose(verbose: boolean): void {
        this.verbose = verbose;
        this.winston.level = verbose ? 'debug' : 'info';
        this.debug('Verbose logging enabled');
    }

    /**
     * Start a new execution session with unique tracking ID
     * 
     * Creates a UUID for tracking all operations within a single command
     * execution. Displays execution metadata to user.
     * 
     * @param command - Full command being executed
     * @returns string - Generated execution ID
     * 
     * //? Execution ID helps correlate logs across complex operations
     * //? First 8 characters of UUID are shown for brevity
     */
    startExecution(command: string): string {
        this.executionId = randomUUID();
        const logMessage = `Starting execution: ${command}`;

        // Display execution metadata to user
        console.log(chalk.cyan('🚀'), chalk.bold(`Execution ID: ${this.executionId}`));
        console.log(chalk.gray('📄'), `Log file: ${this.logFilePath}`);
        console.log('');

        // Log to file with full context
        this.winston.info(logMessage, {
            executionId: this.executionId,
            command,
            timestamp: new Date().toISOString()
        });

        this.debug(`Execution started with ID: ${this.executionId}`, { command });
        return this.executionId;
    }

    /**
     * Format console messages with execution ID prefix
     * 
     * @param message - Message to format
     * @returns string - Formatted message with execution ID
     * 
     * //? Shows first 8 chars of UUID for compact display
     */
    private formatMessage(message: string): string {
        return this.executionId ? `[${this.executionId.slice(0, 8)}] ${message}` : message;
    }

    /**
     * ================================================================================
     * LOGGING METHODS - Different Log Levels
     * ================================================================================
     */

    /**
     * Log informational message
     * 
     * @param message - Information message
     * @param data - Optional structured data
     * 
     * //? Use for general operational information
     */
    info(message: string, data?: any): void {
        const formattedMessage = this.formatMessage(message);
        console.log(chalk.blue('ℹ'), formattedMessage);
        this.winston.info(message, { executionId: this.executionId, data });
    }

    /**
     * Log success message with green checkmark
     * 
     * @param message - Success message
     * @param data - Optional structured data
     * 
     * //? Use for completed operations and achievements
     */
    success(message: string, data?: any): void {
        const formattedMessage = this.formatMessage(message);
        console.log(chalk.green('✓'), formattedMessage);
        this.winston.info(message, { executionId: this.executionId, data, level: 'success' });
    }

    /**
     * Log warning message with yellow warning icon
     * 
     * @param message - Warning message
     * @param data - Optional structured data
     * 
     * //? Use for non-critical issues that need attention
     */
    warn(message: string, data?: any): void {
        const formattedMessage = this.formatMessage(message);
        console.log(chalk.yellow('⚠'), formattedMessage);
        this.winston.warn(message, { executionId: this.executionId, data });
    }

    /**
     * Log error message with red X icon
     * 
     * @param message - Error message
     * @param error - Optional Error object with stack trace
     * @param data - Optional structured data
     * 
     * //! CRITICAL: Always log errors for debugging failed operations
     * //? Include stack traces for better debugging
     */
    error(message: string, error?: Error, data?: any): void {
        const formattedMessage = this.formatMessage(message);
        console.log(chalk.red('✗'), formattedMessage);

        if (error) {
            console.log(chalk.red(error.stack));
            this.winston.error(message, {
                executionId: this.executionId,
                error: error.stack,
                data
            });
        } else {
            this.winston.error(message, { executionId: this.executionId, data });
        }
    }

    /**
     * Log debug message (only shown in verbose mode)
     * 
     * @param message - Debug message
     * @param data - Optional structured data
     * 
     * //? Essential for troubleshooting AWS API calls and internal operations
     * //? Always logged to file regardless of verbose mode
     */
    debug(message: string, data?: any): void {
        const formattedMessage = this.formatMessage(message);

        // Only show in console if verbose mode is enabled
        if (this.verbose) {
            console.log(chalk.gray('🔍'), chalk.gray(formattedMessage));
            if (data) {
                console.log(chalk.gray('   Data:'), chalk.gray(JSON.stringify(data, null, 2)));
            }
        }

        // Always log to file for later analysis
        this.winston.debug(message, { executionId: this.executionId, data });
    }

    /**
     * Log operation step with magenta step icon
     * 
     * Used for tracking major workflow steps and phases.
     * 
     * @param step - Step identifier (e.g., 'AWS_CREATE', 'DEPLOY')
     * @param message - Step description
     * @param data - Optional step data
     * 
     * //? Steps help track workflow progress in complex operations
     * //? Only shown in verbose mode to reduce console noise
     */
    step(step: string, message: string, data?: any): void {
        const formattedMessage = this.formatMessage(`${step}: ${message}`);

        if (this.verbose) {
            console.log(chalk.magenta('📋'), chalk.magenta(formattedMessage));
            if (data) {
                console.log(chalk.gray('   Data:'), chalk.gray(JSON.stringify(data, null, 2)));
            }
        }

        this.winston.info(`${step}: ${message}`, {
            executionId: this.executionId,
            step,
            data,
            type: 'step'
        });
    }

    /**
     * ================================================================================
     * UTILITY METHODS - Timing and Progress
     * ================================================================================
     */

    /**
     * Create a performance timer for measuring operation duration
     * 
     * @param label - Timer label for identification
     * @returns Object with end() method that returns duration in milliseconds
     * 
     * //? Essential for identifying performance bottlenecks
     * //? Use for timing AWS API calls and long operations
     * //TODO: Add timer statistics and aggregation
     */
    timer(label: string): { end: () => number } {
        const startTime = Date.now();
        this.debug(`Timer started: ${label}`);

        return {
            end: () => {
                const duration = Date.now() - startTime;
                this.debug(`Timer ended: ${label} (${duration}ms)`, { duration, label });
                return duration;
            }
        };
    }

    /**
     * Create a spinner for long-running operations
     * 
     * @param message - Spinner message
     * @returns Ora spinner instance
     * 
     * //? Provides visual feedback during AWS operations
     * //? Remember to call .succeed(), .fail(), or .stop() when done
     */
    spinner(message: string): Ora {
        const formattedMessage = this.formatMessage(message);
        return ora(formattedMessage).start();
    }

    /**
     * ================================================================================
     * GETTER METHODS - Access Internal State
     * ================================================================================
     */

    /**
     * Get current execution ID
     * 
     * @returns string - Current execution UUID
     * 
     * //? Useful for correlating operations across different services
     */
    getExecutionId(): string {
        return this.executionId;
    }

    /**
     * Get absolute path to log file
     * 
     * @returns string - Full path to log file
     * 
     * //? Useful for displaying log location to users
     */
    getLogFilePath(): string {
        return this.logFilePath;
    }
}

/**
 * ================================================================================
 * SINGLETON LOGGER INSTANCE
 * ================================================================================
 * 
 * Exported singleton logger instance for use throughout the application.
 * Import this instance rather than creating new Logger instances.
 * 
 * //! IMPORTANT: Always use this singleton instance for consistent logging
 * //? Single instance ensures execution ID consistency across modules
 */
export const logger = new Logger();