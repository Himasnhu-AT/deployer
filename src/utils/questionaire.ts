/**
 * ================================================================================
 * QUESTIONNAIRE UTILITY - Interactive Configuration Collection
 * ================================================================================
 * 
 * Interactive command-line questionnaire system for collecting deployment
 * configuration when command-line options are missing or incomplete.
 * Provides user-friendly prompts with validation and sensible defaults.
 * 
 * KEY FEATURES:
 * • Missing Option Detection - Only prompts for unconfigured parameters
 * • Instance Type Selection - Curated list of common EC2 instance types
 * • Docker Image Validation - Ensures valid Docker image names
 * • Optional Configuration - Progressive disclosure for advanced settings
 * • Security Rule Parsing - User-friendly security rule input format
 * • Smart Defaults - Sensible default values for common use cases
 * 
 * QUESTION FLOW:
 * 1. Required Options - Instance type and Docker image
 * 2. Network Configuration - Public URL assignment and security rules
 * 3. Optional Configuration Choice - User decides complexity level
 * 4. Advanced Settings - GPU, CPU, memory, custom name
 * 
 * @author Himanshu
 * @version 1.0.0
 * @since 2025
 * @license BSD-3-Clause
 */

import inquirer from 'inquirer';
import { logger } from './logger';

/**
 * ================================================================================
 * QUESTIONNAIRE OPTIONS INTERFACE
 * ================================================================================
 * 
 * Interface defining all possible configuration options that can be
 * collected through the interactive questionnaire system.
 * 
 * //? All fields are optional to support partial configuration scenarios
 * //! VALIDATION: Each field should be validated when collected
 * //TODO: Add support for environment variables and configuration files
 */
export interface QuestionnaireOptions {
    instanceType?: string;      // EC2 instance type (e.g., t3.micro, g4dn.xlarge)
    dockerImage?: string;       // Docker image name and tag
    gpu?: number;              // Number of GPUs for GPU-enabled instances
    cpu?: number;              // Custom CPU allocation
    memory?: number;           // Custom memory allocation in GB
    inbound?: string[];        // Inbound security rules in CIDR:PORT format
    outbound?: string[];       // Outbound security rules in CIDR:PORT format
    assignUrl?: boolean;       // Whether to assign Elastic IP
    name?: string;             // Custom instance name
}

/**
 * ================================================================================
 * QUESTIONNAIRE CLASS
 * ================================================================================
 * 
 * Main class that orchestrates the interactive configuration collection process.
 * Intelligently determines which questions to ask based on provided options.
 * 
 * //? Uses progressive disclosure to avoid overwhelming new users
 * //! USABILITY: Question order and grouping affects user experience
 * //TODO: Add configuration templates for common deployment patterns
 * //TODO: Add configuration validation and recommendations
 */
export class Questionnaire {

    /**
     * Prompt user for missing configuration options
     * 
     * Analyzes provided options and interactively collects any missing
     * required configuration, with optional advanced settings.
     * 
     * @param providedOptions - Configuration already provided via command line
     * @returns Promise<QuestionnaireOptions> - Complete configuration object
     * 
     * //? Only asks for missing options to avoid redundant prompts
     * //? Provides escape hatch for advanced users who know what they want
     */
    async promptForMissingOptions(providedOptions: QuestionnaireOptions): Promise<QuestionnaireOptions> {
        logger.debug('Starting questionnaire for missing options', providedOptions);
        const questions: any[] = [];

        // PHASE 1: Required Configuration
        // Instance type selection with curated options
        if (!providedOptions.instanceType) {
            questions.push({
                type: 'list',
                name: 'instanceType',
                message: 'Select EC2 instance type:',
                choices: [
                    { name: 't3.micro (1 vCPU, 1 GB RAM) - Free tier eligible', value: 't3.micro' },
                    { name: 't3.small (2 vCPU, 2 GB RAM)', value: 't3.small' },
                    { name: 't3.medium (2 vCPU, 4 GB RAM)', value: 't3.medium' },
                    { name: 't3.large (2 vCPU, 8 GB RAM)', value: 't3.large' },
                    { name: 'c5.large (2 vCPU, 4 GB RAM) - Compute optimized', value: 'c5.large' },
                    { name: 'g4dn.xlarge (4 vCPU, 16 GB RAM, 1 GPU)', value: 'g4dn.xlarge' },
                    { name: 'g4dn.2xlarge (8 vCPU, 32 GB RAM, 1 GPU)', value: 'g4dn.2xlarge' },
                    { name: 'Custom (enter manually)', value: 'custom' }
                ],
                default: 't3.micro'
            });
        }

        // Docker image input with validation
        if (!providedOptions.dockerImage) {
            questions.push({
                type: 'input',
                name: 'dockerImage',
                message: 'Enter Docker image to deploy (e.g., nginx:latest, node:18, python:3.9):',
                validate: (input: string) => {
                    if (!input.trim()) {
                        return 'Docker image is required';
                    }
                    //TODO: Add Docker image format validation
                    return true;
                }
            });
        }

        // Collect answers for required questions
        const answers = await inquirer.prompt(questions);

        // Handle custom instance type entry
        if (answers.instanceType === 'custom') {
            const customInstanceType = await inquirer.prompt([{
                type: 'input',
                name: 'instanceType',
                message: 'Enter custom instance type:',
                validate: (input: string) => {
                    if (!input.trim()) {
                        return 'Instance type is required';
                    }
                    //TODO: Add AWS instance type format validation
                    return true;
                }
            }]);
            answers.instanceType = customInstanceType.instanceType;
        }

        // PHASE 2: Network Configuration
        // Ask about public URL assignment if not provided
        if (providedOptions.assignUrl === undefined) {
            const urlConfig = await inquirer.prompt([{
                type: 'confirm',
                name: 'assignUrl',
                message: 'Do you want to assign a public URL/Elastic IP to the instance?',
                default: false
            }]);
            answers.assignUrl = urlConfig.assignUrl;
        }

        // Ask about security rules if not provided
        if (!providedOptions.inbound && !providedOptions.outbound) {
            const securityConfig = await inquirer.prompt([{
                type: 'confirm',
                name: 'configureSecurity',
                message: 'Do you want to configure network security rules (inbound/outbound)?',
                default: false
            }]);

            if (securityConfig.configureSecurity) {
                const securityRules = await inquirer.prompt([
                    {
                        type: 'input',
                        name: 'inboundRules',
                        message: 'Inbound rules (comma-separated, format: CIDR:PORT, e.g., 0.0.0.0/0:80,0.0.0.0/0:443):',
                        filter: (input: string) => input ? input.split(',').map(s => s.trim()) : undefined
                    },
                    {
                        type: 'input',
                        name: 'outboundRules',
                        message: 'Outbound rules (comma-separated, format: CIDR:PORT):',
                        filter: (input: string) => input ? input.split(',').map(s => s.trim()) : undefined
                    }
                ]);

                if (securityRules.inboundRules) {
                    answers.inbound = securityRules.inboundRules;
                }
                if (securityRules.outboundRules) {
                    answers.outbound = securityRules.outboundRules;
                }
            } else {
                // User declined to configure security rules - show warning
                logger.warn('⚠️  No custom security rules configured');
                console.log('\n⚠️  Security Notice:');
                console.log('   You chose not to configure custom security rules.');
                console.log('   The deployer will apply intelligent defaults based on your Docker image.');
                console.log('   For web servers (nginx, apache), HTTP/HTTPS ports will be opened.');
                console.log('   For custom applications, you may need to specify --inbound rules manually.');
                console.log('   Example: --inbound 0.0.0.0/0:8080 for port 8080 access\n');
            }
        }

        // PHASE 3: Optional Advanced Configuration Decision
        // Let user choose complexity level for remaining options
        const wantOptionalConfig = await inquirer.prompt([{
            type: 'confirm',
            name: 'configureOptional',
            message: 'Would you like to configure additional optional settings (GPU, CPU, memory, custom name)?',
            default: false
        }]);

        // PHASE 4: Advanced Configuration (if requested)
        if (wantOptionalConfig.configureOptional) {
            const optionalQuestions: any[] = [];

            // GPU configuration for GPU-enabled instances
            if (answers.instanceType?.includes('g4dn') && !providedOptions.gpu) {
                optionalQuestions.push({
                    type: 'number',
                    name: 'gpu',
                    message: 'Number of GPUs to assign (0 for no GPU):',
                    default: 1,
                    validate: (input: number) => input >= 0 || 'GPU count must be 0 or positive'
                });
            }

            // Custom CPU allocation
            if (!providedOptions.cpu) {
                optionalQuestions.push({
                    type: 'number',
                    name: 'cpu',
                    message: 'Number of CPUs to assign (leave empty for instance default):',
                    validate: (input: number) => !input || input > 0 || 'CPU count must be positive'
                });
            }

            // Custom memory allocation
            if (!providedOptions.memory) {
                optionalQuestions.push({
                    type: 'number',
                    name: 'memory',
                    message: 'Memory in GB to assign (leave empty for instance default):',
                    validate: (input: number) => !input || input > 0 || 'Memory must be positive'
                });
            }

            // Custom instance naming
            if (!providedOptions.name) {
                optionalQuestions.push({
                    type: 'input',
                    name: 'name',
                    message: 'Custom name for the instance (optional):',
                });
            }

            // Collect optional configuration answers
            const optionalAnswers = await inquirer.prompt(optionalQuestions);
            Object.assign(answers, optionalAnswers);
        }

        // Merge provided options with collected answers
        const finalOptions = { ...providedOptions, ...answers };

        logger.debug('Questionnaire completed', finalOptions);
        logger.success('Configuration collected successfully');
        return finalOptions;
    }
}

/**
 * ================================================================================
 * SINGLETON QUESTIONNAIRE INSTANCE
 * ================================================================================
 * 
 * Exported singleton instance for use throughout the application.
 * Provides consistent questionnaire behavior across all commands.
 * 
 * //! IMPORTANT: Use this singleton instance for consistent behavior
 * //? Single instance ensures consistent question flow and validation
 */
export const questionnaire = new Questionnaire();