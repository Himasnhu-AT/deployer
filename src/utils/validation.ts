/**
 * ================================================================================
 * VALIDATION UTILITY - Input Validation and Data Processing
 * ================================================================================
 * 
 * Collection of validation functions and data processing utilities for the
 * deployer CLI. Ensures data integrity and provides helpful formatting
 * functions for user output.
 * 
 * KEY FEATURES:
 * • Instance Type Validation - Verify AWS EC2 instance type validity
 * • Docker Image Validation - Validate Docker image name format
 * • Security Rule Validation - Parse and validate CIDR:PORT format
 * • Uptime Formatting - Human-readable time duration display
 * • Cost Estimation - Approximate AWS billing calculations
 * 
 * VALIDATION SCOPE:
 * • Format Validation - Ensure inputs match expected patterns
 * • Range Validation - Check numeric values are within valid ranges
 * • Business Logic - Apply deployer-specific validation rules
 * • User Experience - Provide clear error messages for invalid inputs
 * 
 * @author Himanshu
 * @version 1.0.0
 * @since 2025
 * @license BSD-3-Clause
 */

import { _InstanceType } from '@aws-sdk/client-ec2';

/**
 * ================================================================
 * AWS RESOURCE VALIDATION
 * ================================================================
 */

/**
 * Validate EC2 instance type against known AWS instance types
 * 
 * Checks if the provided instance type is a valid AWS EC2 instance type.
 * Uses a curated list of common instance types for validation.
 * 
 * @param instanceType - EC2 instance type to validate (e.g., 't3.micro')
 * @returns boolean - True if instance type is valid
 * 
 * //? Prevents deployment failures due to invalid instance types
 * //! LIMITATION: Static list may not include newest AWS instance types
 * //TODO: Fetch valid instance types dynamically from AWS API
 * //TODO: Add region-specific instance type availability checking
 */
export function validateInstanceType(instanceType: string): boolean {
    // Common instance types - in a real implementation, you'd fetch this from AWS
    const validTypes = [
        // T2 General Purpose (Previous Generation)
        't2.nano', 't2.micro', 't2.small', 't2.medium', 't2.large', 't2.xlarge', 't2.2xlarge',

        // T3 General Purpose (Current Generation)
        't3.nano', 't3.micro', 't3.small', 't3.medium', 't3.large', 't3.xlarge', 't3.2xlarge',

        // T3a General Purpose (AMD Processors)
        't3a.nano', 't3a.micro', 't3a.small', 't3a.medium', 't3a.large', 't3a.xlarge', 't3a.2xlarge',

        // M5 General Purpose (Balanced Compute)
        'm5.large', 'm5.xlarge', 'm5.2xlarge', 'm5.4xlarge', 'm5.8xlarge', 'm5.12xlarge', 'm5.16xlarge', 'm5.24xlarge',

        // C5 Compute Optimized
        'c5.large', 'c5.xlarge', 'c5.2xlarge', 'c5.4xlarge', 'c5.9xlarge', 'c5.12xlarge', 'c5.18xlarge', 'c5.24xlarge',

        // G4dn GPU Instances (NVIDIA T4 GPUs)
        'g4dn.xlarge', 'g4dn.2xlarge', 'g4dn.4xlarge', 'g4dn.8xlarge', 'g4dn.12xlarge', 'g4dn.16xlarge',

        // P3 GPU Instances (NVIDIA V100 GPUs)
        'p3.2xlarge', 'p3.8xlarge', 'p3.16xlarge',

        // P4d GPU Instances (NVIDIA A100 GPUs)
        'p4d.24xlarge'
    ];

    return validTypes.includes(instanceType);
}

/**
 * ================================================================
 * DOCKER VALIDATION
 * ================================================================
 */

/**
 * Validate Docker image name format
 * 
 * Ensures Docker image names follow valid naming conventions.
 * Supports both simple names and registry paths with tags.
 * 
 * @param image - Docker image name to validate
 * @returns boolean - True if image name format is valid
 * 
 * //? Prevents container deployment failures due to invalid image names
 * //TODO: Add registry connectivity validation
 * //TODO: Add tag existence verification for public images
 */
export function validateDockerImage(image: string): boolean {
    // Basic Docker image name validation
    // Supports: nginx, nginx:latest, registry.com/image:tag
    const dockerImageRegex = /^[a-z0-9]+([-._a-z0-9]*[a-z0-9])*(:[-._a-zA-Z0-9]+)?$/;

    // Allow images with registry paths (contains '/')
    return dockerImageRegex.test(image) || image.includes('/');
}

/**
 * ================================================================
 * NETWORK SECURITY VALIDATION
 * ================================================================
 */

/**
 * Validate security rule format (CIDR:PORT)
 * 
 * Parses and validates security rule strings in the format "CIDR:PORT".
 * Ensures CIDR notation is valid and port numbers are in valid range.
 * 
 * @param rule - Security rule string (e.g., "0.0.0.0/0:80")
 * @returns boolean - True if rule format is valid
 * 
 * //? Prevents security group creation failures due to invalid rules
 * //! SECURITY: Does not validate if rules are overly permissive
 * //TODO: Add warnings for overly broad CIDR ranges (0.0.0.0/0)
 * //TODO: Add support for IPv6 CIDR validation
 */
export function validateSecurityRule(rule: string): boolean {
    try {
        const [cidr, port] = rule.split(':');

        // Validate CIDR notation (IPv4 only)
        const cidrRegex = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
        if (!cidrRegex.test(cidr)) {
            return false;
        }

        // Validate individual IP octets are 0-255
        const [ip, mask] = cidr.split('/');
        const octets = ip.split('.').map(Number);
        if (octets.some(octet => octet < 0 || octet > 255)) {
            return false;
        }

        // Validate subnet mask is 0-32
        const maskNum = parseInt(mask);
        if (maskNum < 0 || maskNum > 32) {
            return false;
        }

        // Validate port number is in valid range
        const portNum = parseInt(port);
        return portNum >= 1 && portNum <= 65535;

    } catch {
        return false;
    }
}

/**
 * ================================================================
 * DISPLAY FORMATTING UTILITIES
 * ================================================================
 */

/**
 * Format instance uptime in human-readable format
 * 
 * Converts instance launch time to a readable uptime duration.
 * Automatically chooses appropriate units (days, hours, minutes).
 * 
 * @param launchTime - Instance launch timestamp
 * @returns string - Formatted uptime (e.g., "2d 5h 30m", "3h 45m", "25m")
 * 
 * //? Provides quick visual reference for instance age and billing duration
 * //TODO: Add support for sub-minute precision for very new instances
 */
export function formatUptime(launchTime: Date): string {
    const now = new Date();
    const uptimeMs = now.getTime() - launchTime.getTime();

    // Calculate time components
    const days = Math.floor(uptimeMs / (1000 * 60 * 60 * 24));
    const hours = Math.floor((uptimeMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((uptimeMs % (1000 * 60 * 60)) / (1000 * 60));

    // Format based on largest relevant unit
    if (days > 0) {
        return `${days}d ${hours}h ${minutes}m`;
    } else if (hours > 0) {
        return `${hours}h ${minutes}m`;
    } else {
        return `${minutes}m`;
    }
}

/**
 * ================================================================
 * COST ESTIMATION
 * ================================================================
 */

/**
 * Estimate AWS EC2 instance cost based on type and uptime
 * 
 * Provides rough cost estimates for AWS EC2 instances based on
 * instance type and running duration. Uses approximate hourly rates.
 * 
 * @param instanceType - EC2 instance type
 * @param uptimeHours - Number of hours instance has been running
 * @returns number - Estimated cost in USD
 * 
 * //? Helps users understand ongoing costs of their deployments
 * //! ACCURACY: Uses approximate rates, not real-time AWS pricing
 * //! LIMITATION: Does not include EBS, data transfer, or other costs
 * //TODO: Integrate with AWS Pricing API for accurate, real-time rates
 * //TODO: Add regional pricing variations
 * //TODO: Include EBS storage costs in estimation
 */
export function estimateCost(instanceType: string, uptimeHours: number): number {
    // Rough cost estimates per hour (USD) - should be fetched from AWS Pricing API in production
    const costPerHour: Record<string, number> = {
        // T2 General Purpose
        't2.nano': 0.0058,
        't2.micro': 0.0116,
        't2.small': 0.023,
        't2.medium': 0.0464,
        't2.large': 0.0928,

        // T3 General Purpose
        't3.micro': 0.0104,
        't3.small': 0.0208,
        't3.medium': 0.0416,
        't3.large': 0.0832,

        // M5 General Purpose
        'm5.large': 0.096,
        'm5.xlarge': 0.192,
        'm5.2xlarge': 0.384,
        'm5.4xlarge': 0.768,

        // C5 Compute Optimized
        'c5.large': 0.085,
        'c5.xlarge': 0.17,
        'c5.2xlarge': 0.34,

        // G4dn GPU Instances
        'g4dn.xlarge': 0.526,
        'g4dn.2xlarge': 0.752,
        'g4dn.4xlarge': 1.204,

        // P3 GPU Instances
        'p3.2xlarge': 3.06,
        'p3.8xlarge': 12.24,
        'p3.16xlarge': 24.48
    };

    // Use known rate or default fallback
    const hourlyRate = costPerHour[instanceType] || 0.1; // Default rate for unknown types

    return hourlyRate * uptimeHours;
}