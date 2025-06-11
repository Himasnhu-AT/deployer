/**
 * ================================================================================
 * TYPE DEFINITIONS - Core Data Structures
 * ================================================================================
 * 
 * Central type definitions for the Deployer CLI application. These interfaces
 * define the structure of data used throughout the system for AWS operations,
 * instance management, and configuration.
 * 
 * KEY INTERFACES:
 * • DeployerInstance - Complete EC2 instance representation
 * • CreateInstanceOptions - Instance creation configuration
 * • SecurityRule - Network security rule definition
 * • ClusterConfig - Multi-instance cluster settings
 * 
 * DESIGN PRINCIPLES:
 * • Strong Typing - All data structures are strictly typed
 * • Optional Fields - Non-required fields are marked optional
 * • AWS Compatibility - Types align with AWS SDK structures
 * • Extensibility - Interfaces can be extended for future features
 * 
 * @author Himanshu
 * @version 1.0.0
 * @since 2025
 * @license BSD-3-Clause
 */

/**
 * ================================================================================
 * INSTANCE REPRESENTATION
 * ================================================================================
 */

/**
 * Complete representation of a deployed EC2 instance
 * 
 * This interface captures all relevant information about an EC2 instance
 * managed by the deployer CLI, including AWS metadata and deployment details.
 * 
 * //? Combines AWS instance data with deployer-specific information
 * //! IMPORTANT: instanceId is the primary key for all operations
 * //TODO: Add deployment status and health check fields
 */
export interface DeployerInstance {
    // Core AWS identifiers
    instanceId: string;                    // AWS instance ID (e.g., i-1234567890abcdef0)
    instanceType: string;                  // EC2 instance type (e.g., t3.micro, m5.large)

    // Container deployment information
    dockerImage: string;                   // Docker image deployed on instance

    // Instance lifecycle state
    state: 'pending' | 'running' | 'stopping' | 'stopped' | 'terminated';

    // Network configuration
    publicIp?: string;                     // Public IPv4 address (if assigned)
    publicDns?: string;                    // Public DNS name (if available)
    assignedUrl?: string;                  // Elastic IP or custom URL (if configured)

    // Metadata and tracking
    tags: Record<string, string>;          // AWS instance tags as key-value pairs
    launchTime: Date;                      // Instance launch timestamp

    // Hardware specifications (optional)
    gpuCount?: number;                     // Number of GPUs (for GPU instances)
    cpu?: number;                          // CPU count or specification
    memory?: number;                       // Memory in GB
}

/**
 * ================================================================================
 * INSTANCE CREATION CONFIGURATION
 * ================================================================================
 */

/**
 * Configuration options for creating new EC2 instances
 * 
 * Defines all parameters needed to create and configure a new EC2 instance
 * with Docker container deployment and network security rules.
 * 
 * //? Most fields are optional with sensible defaults
 * //! REQUIRED: instanceType and dockerImage must be specified
 * //TODO: Add support for multiple containers per instance
 * //TODO: Add custom user data script support
 */
export interface CreateInstanceOptions {
    // Core instance configuration
    instanceType: string;                  // EC2 instance type (required)
    dockerImage: string;                   // Docker image to deploy (required)

    // Hardware specifications (optional)
    gpu?: number;                          // Number of GPUs to allocate
    cpu?: number;                          // CPU cores or specification  
    memory?: number;                       // Memory allocation in GB

    // Network security configuration
    inbound?: string[];                    // Inbound rules in "CIDR:PORT" format
    outbound?: string[];                   // Outbound rules in "CIDR:PORT" format

    // Additional configuration
    assignUrl?: boolean;                   // Whether to assign Elastic IP
    name?: string;                         // Custom instance name (defaults to generated)
}

/**
 * ================================================================================
 * NETWORK SECURITY CONFIGURATION
 * ================================================================================
 */

/**
 * Network security rule definition
 * 
 * Represents a single inbound or outbound network rule for EC2 security groups.
 * Used to control network access to deployed instances.
 * 
 * //? Maps to AWS security group rule structure
 * //! SECURITY: Validate CIDR ranges to prevent overly permissive rules
 * //TODO: Add support for named port ranges (e.g., "http", "https")
 * //TODO: Add support for security group references
 */
export interface SecurityRule {
    cidr: string;                          // IP address range in CIDR notation (e.g., "0.0.0.0/0")
    port: number;                          // Target port number (e.g., 80, 443, 8080)
    protocol?: 'tcp' | 'udp';              // Network protocol (defaults to TCP)
}

/**
 * ================================================================================
 * CLUSTER MANAGEMENT CONFIGURATION
 * ================================================================================
 */

/**
 * Configuration for multi-instance cluster management
 * 
 * Defines autoscaling and load balancing parameters for managing groups
 * of instances as a cohesive cluster with automatic scaling policies.
 * 
 * //? Enables horizontal scaling based on resource utilization
 * //! COST: More instances = higher AWS costs
 * //TODO: Add support for different scaling metrics (memory, network, custom)
 * //TODO: Add support for scheduled scaling
 */
export interface ClusterConfig {
    // Scaling limits
    minInstances: number;                  // Minimum number of instances to maintain
    maxInstances: number;                  // Maximum number of instances allowed

    // Scaling triggers
    targetCpuUtilization: number;          // Target CPU percentage (0-100)

    // Scaling timing controls
    scaleUpCooldown: number;               // Cooldown period after scaling up (seconds)
    scaleDownCooldown: number;             // Cooldown period after scaling down (seconds)
}