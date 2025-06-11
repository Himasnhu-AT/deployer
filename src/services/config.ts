/**
 * ================================================================================
 * CONFIG SERVICE - Application Configuration Management
 * ================================================================================
 * 
 * Centralized configuration management service for the deployer CLI. Handles
 * AWS region settings, credential validation, and application-wide configuration
 * state management.
 * 
 * KEY FEATURES:
 * • AWS Region Management - Configurable deployment regions
 * • Credential Validation - Verify AWS authentication status
 * • Profile Support - Multiple AWS profile configuration
 * • Account Discovery - Automatic AWS account ID detection
 * • Configuration State - Centralized config storage and access
 * 
 * CONFIGURATION SCOPE:
 * • AWS Authentication - Credentials and profile management
 * • Regional Settings - Target AWS region for all operations
 * • Account Context - AWS account identification and validation
 * • Service Defaults - Default values for CLI operations
 * 
 * USAGE PATTERNS:
 * • Initialize once at application startup
 * • Validate credentials before AWS operations
 * • Access configuration throughout the application
 * • Switch regions or profiles as needed
 * 
 * @author Himanshu
 * @version 1.0.0
 * @since 2025
 * @license BSD-3-Clause
 */

import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { logger } from '../utils/logger';

/**
 * ================================================================================
 * DEPLOYER CONFIGURATION INTERFACE
 * ================================================================================
 * 
 * Interface defining the complete configuration state for the deployer CLI.
 * Contains all necessary settings for AWS operations and application behavior.
 * 
 * //? All AWS operations will use these configuration values
 * //! IMPORTANT: Region affects service availability and pricing
 * //TODO: Add support for custom endpoints and service configurations
 */
export interface DeployerConfig {
    region: string;         // AWS region for all operations (e.g., 'us-east-1')
    accountId?: string;     // AWS account ID (populated after credential validation)
    profile?: string;       // AWS CLI profile name (optional)
}

/**
 * ================================================================================
 * CONFIG SERVICE CLASS
 * ================================================================================
 * 
 * Main configuration service that manages application settings and AWS context.
 * Provides credential validation and configuration access throughout the CLI.
 * 
 * //? Singleton pattern recommended - create once and reuse
 * //! DEPENDENCY: Requires AWS credentials to be configured
 * //TODO: Add configuration file persistence for user preferences
 * //TODO: Add environment variable override support
 */
export class ConfigService {
    private config: DeployerConfig;

    /**
     * Initialize configuration service with regional and profile settings
     * 
     * Sets up the base configuration that will be used for all AWS operations.
     * Region selection affects service availability, latency, and pricing.
     * 
     * @param region - AWS region code (defaults to us-east-1)
     * @param profile - AWS CLI profile name (optional)
     * 
     * //? us-east-1 is default for cost optimization and service availability
     * //? Profile support allows multiple AWS account management
     * //TODO: Add region validation against available AWS regions
     * //TODO: Add automatic region recommendation based on user location
     */
    constructor(region: string = 'us-east-1', profile?: string) {
        this.config = {
            region,
            profile
        };

        logger.debug('ConfigService initialized', {
            region,
            profile: profile || 'default'
        });
    }

    /**
     * ================================================================
     * CREDENTIAL VALIDATION
     * ================================================================
     */

    /**
     * Validate AWS credentials and populate account information
     * 
     * Tests current AWS credentials by making a GetCallerIdentity call.
     * Populates account ID in configuration if validation succeeds.
     * 
     * @returns Promise<boolean> - True if credentials are valid
     * 
     * //! CRITICAL: This must succeed before any AWS operations
     * //? Uses STS service which is available in all regions
     * //TODO: Add detailed error messages for different failure scenarios
     * //TODO: Add credential expiration checking for temporary credentials
     */
    async validateAWSCredentials(): Promise<boolean> {
        const timer = logger.timer('credential-validation');

        try {
            logger.debug('Validating AWS credentials', {
                region: this.config.region,
                profile: this.config.profile
            });

            // Initialize STS client with current configuration
            const stsClient = new STSClient({
                region: this.config.region,
                ...(this.config.profile && { profile: this.config.profile })
            });

            // Attempt to get caller identity
            const command = new GetCallerIdentityCommand({});
            const result = await stsClient.send(command);

            // Store account information in configuration
            this.config.accountId = result.Account;

            timer.end();
            logger.success(`AWS credentials validated for account: ${result.Account}`);
            logger.debug('Credential validation successful', {
                accountId: result.Account,
                arn: result.Arn,
                userId: result.UserId
            });

            return true;

        } catch (error) {
            timer.end();
            logger.error('AWS credentials validation failed. Please ensure your AWS CLI is configured.');
            logger.debug('Credential validation failed', {
                error: error instanceof Error ? error.message : error,
                region: this.config.region,
                profile: this.config.profile
            });

            // Provide helpful guidance for common credential issues
            if (error instanceof Error) {
                if (error.message.includes('Unable to locate credentials')) {
                    logger.info('Hint: Run "aws configure" to set up your credentials');
                } else if (error.message.includes('Region')) {
                    logger.info('Hint: Check that your AWS region is correctly configured');
                } else if (error.message.includes('expired')) {
                    logger.info('Hint: Your AWS credentials may have expired - refresh them');
                }
            }

            return false;
        }
    }

    /**
     * ================================================================
     * CONFIGURATION ACCESS
     * ================================================================
     */

    /**
     * Get complete configuration object
     * 
     * @returns DeployerConfig - Current configuration state
     * 
     * //? Use this to access all configuration values at once
     * //! IMMUTABLE: Don't modify the returned object directly
     */
    getConfig(): DeployerConfig {
        return { ...this.config }; // Return copy to prevent mutations
    }

    /**
     * Get AWS account ID (if credentials have been validated)
     * 
     * @returns string | undefined - AWS account ID or undefined
     * 
     * //? Account ID is only available after successful credential validation
     * //! WARNING: Returns undefined if credentials haven't been validated
     */
    getAccountId(): string | undefined {
        return this.config.accountId;
    }

    /**
     * Get configured AWS region
     * 
     * @returns string - Current AWS region
     * 
     * //? This region will be used for all AWS service operations
     */
    getRegion(): string {
        return this.config.region;
    }

    /**
     * Get configured AWS profile (if any)
     * 
     * @returns string | undefined - AWS CLI profile name or undefined
     * 
     * //? Profile determines which AWS credentials are used
     */
    getProfile(): string | undefined {
        return this.config.profile;
    }

    /**
     * ================================================================
     * CONFIGURATION UPDATES
     * ================================================================
     */

    /**
     * Update AWS region configuration
     * 
     * Changes the target region for all subsequent AWS operations.
     * Requires credential re-validation after region change.
     * 
     * @param region - New AWS region code
     * 
     * //! IMPORTANT: Changing region may affect service availability and pricing
     * //? Re-validate credentials after region changes
     * //TODO: Add validation of region availability
     */
    setRegion(region: string): void {
        const oldRegion = this.config.region;
        this.config.region = region;

        logger.debug('Region updated', { oldRegion, newRegion: region });
        logger.info(`AWS region changed from ${oldRegion} to ${region}`);

        // Clear account ID to force re-validation
        this.config.accountId = undefined;
    }

    /**
     * Update AWS profile configuration
     * 
     * Changes the AWS CLI profile used for authentication.
     * Requires credential re-validation after profile change.
     * 
     * @param profile - AWS CLI profile name (undefined for default)
     * 
     * //! IMPORTANT: Profile change affects which AWS account is used
     * //? Re-validate credentials after profile changes
     */
    setProfile(profile: string | undefined): void {
        const oldProfile = this.config.profile;
        this.config.profile = profile;

        logger.debug('Profile updated', {
            oldProfile: oldProfile || 'default',
            newProfile: profile || 'default'
        });
        logger.info(`AWS profile changed to ${profile || 'default'}`);

        // Clear account ID to force re-validation
        this.config.accountId = undefined;
    }

    /**
     * ================================================================
     * UTILITY METHODS
     * ================================================================
     */

    /**
     * Check if credentials have been validated
     * 
     * @returns boolean - True if credentials are validated and account ID is known
     * 
     * //? Use this to check if AWS operations can proceed
     */
    isConfigured(): boolean {
        return !!this.config.accountId;
    }

    /**
     * Get configuration summary for display
     * 
     * @returns object - Human-readable configuration summary
     * 
     * //? Useful for displaying current configuration to users
     */
    getSummary(): { region: string; profile: string; account?: string; configured: boolean } {
        return {
            region: this.config.region,
            profile: this.config.profile || 'default',
            account: this.config.accountId,
            configured: this.isConfigured()
        };
    }
}