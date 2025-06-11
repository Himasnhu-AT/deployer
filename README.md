# Deployer - Docker Container Deployment to AWS EC2

A powerful CLI tool for deploying Docker containers to AWS EC2 instances without the complexity of Kubernetes or managed clusters like ECS. Deploy applications with one command, manage lightweight clusters, and scale automatically based on usage.

## Features

- 🚀 **One-command deployment** of Docker containers to EC2
- 🎛️ **Lightweight cluster management** with autoscaling
- 🔒 **Security-first** approach with configurable security groups
- 📊 **Real-time monitoring** and log access via SSM
- 🌐 **Automatic URL assignment** with Elastic IP allocation
- ⚡ **GPU support** for ML/AI workloads
- 🔄 **Instance lifecycle management** (start, stop, delete)

## Installation

### Prerequisites

1. **AWS CLI configured** with appropriate credentials
2. **Node.js 16+** installed
3. **IAM permissions** for EC2, SSM, CloudWatch, Lambda, and Route53

### Install via npm

```bash
npm install -g deployer
```

### Install from source

```bash
git clone https://github.com/himasnhu-at/deployer
cd deployer
pnpm install
pnpm run build
pnpm link
```

## AWS Setup

Before using the deployer, ensure your AWS environment has the following:

### 1. IAM Role for EC2 Instances (EC2SSMRole)

Create an IAM role with the following policies:
- `AmazonSSMManagedInstanceCore`
- `CloudWatchAgentServerPolicy`

### 2. IAM Role for Lambda (lambda-execution-role)

Create an IAM role with the following policies:
- `AWSLambdaBasicExecutionRole`
- Custom policy for EC2 operations:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "ec2:DescribeInstances",
                "ec2:StopInstances",
                "ec2:StartInstances",
                "ec2:RunInstances"
            ],
            "Resource": "*"
        }
    ]
}
```

### 3. Required IAM Permissions for CLI User

Your AWS CLI user needs the following permissions:
- `AmazonEC2FullAccess`
- `AmazonSSMFullAccess`
- `CloudWatchFullAccess`
- `AWSLambdaFullAccess`
- `AmazonRoute53FullAccess`

## Usage

### Quick Start

Deploy a simple web server:

```bash
deployer create \
  --instance-type t3.micro \
  --docker-image nginx:latest \
  --inbound 0.0.0.0/0:80 \
  --assign-url
```

### Commands

#### 1. Create Instance

Deploy a Docker container to a new EC2 instance:

```bash
deployer create \
  --instance-type <type> \
  --docker-image <image> \
  [--gpu <count>] \
  [--cpu <count>] \
  [--memory <gb>] \
  [--inbound <CIDR:PORT>...] \
  [--outbound <CIDR:PORT>...] \
  [--assign-url] \
  [--name <name>]
```

**Examples:**

```bash
# Basic web server
deployer create --instance-type t3.micro --docker-image nginx:latest --inbound 0.0.0.0/0:80

# GPU-enabled ML workload
deployer create --instance-type g4dn.xlarge --docker-image tensorflow/tensorflow:latest-gpu --gpu 1 --inbound 0.0.0.0/0:8888

# Custom application with multiple ports
deployer create \
  --instance-type t3.medium \
  --docker-image myapp:latest \
  --inbound 0.0.0.0/0:3000 0.0.0.0/0:8080 \
  --assign-url \
  --name my-app-server
```

#### 2. List Instances

View all deployer-managed instances:

```bash
deployer list
```

#### 3. Instance Lifecycle Management

```bash
# Stop an instance
deployer stop <instance-id>

# Start a stopped instance
deployer start <instance-id>

# Permanently delete an instance
deployer delete <instance-id> --force
```

#### 4. View Logs

Access Docker container logs via SSM:

```bash
deployer logs <instance-id>
```

#### 5. Cluster Management

Set up autoscaling cluster management:

```bash
# Create cluster management
deployer cluster \
  --create \
  --min-instances 2 \
  --max-instances 10 \
  --target-cpu 70 \
  --scale-up-cooldown 300 \
  --scale-down-cooldown 600

# Check cluster status
deployer cluster --status
```

## Configuration Options

### Instance Types

Support for all EC2 instance types:
- **General Purpose**: t3.micro, t3.small, t3.medium, etc.
- **Compute Optimized**: c5.large, c5.xlarge, etc.
- **Memory Optimized**: r5.large, r5.xlarge, etc.
- **GPU Instances**: g4dn.xlarge, p3.2xlarge, etc.

### Security Rules

Format: `CIDR:PORT`

Examples:
- `0.0.0.0/0:80` - Allow HTTP from anywhere
- `10.0.0.0/16:22` - Allow SSH from VPC
- `192.168.1.0/24:3000` - Allow custom port from subnet

### Docker Images

Any public Docker image from Docker Hub or private registries:
- `nginx:latest`
- `node:18-alpine`
- `tensorflow/tensorflow:latest-gpu`
- `your-registry.com/your-app:v1.0`

## Architecture

The deployer creates:

1. **EC2 Instance** with Amazon Linux 2
2. **Security Group** with specified rules
3. **User Data Script** for Docker installation
4. **SSM Agent** for remote access
5. **CloudWatch Monitoring** for metrics
6. **Optional Elastic IP** for stable URLs
7. **Lambda Function** for autoscaling (cluster mode)

## Autoscaling

The cluster management system uses:
- **CloudWatch Alarms** for CPU monitoring
- **Lambda Functions** for scaling decisions
- **SNS Topics** for notifications
- **Instance Tagging** for cluster identification

Scaling triggers:
- **Scale Up**: CPU > target utilization for 2 periods
- **Scale Down**: CPU < (target - 20%) for 2 periods

## Cost Optimization

- Automatic instance stopping when not needed
- Right-sizing recommendations
- Spot instance support (planned)
- Cost estimation in deployment output

## Security

- **Least privilege IAM** policies
- **VPC security groups** with minimal access
- **SSM Session Manager** instead of SSH keys
- **Secrets Manager** integration for sensitive data
- **Encrypted EBS volumes** by default

## Troubleshooting

### Common Issues

1. **AWS credentials not configured**
   ```bash
   aws configure
   ```

2. **IAM permissions insufficient**
   - Check the AWS Setup section for required permissions

3. **Instance fails to start**
   ```bash
   deployer logs <instance-id>
   ```

4. **Docker container not running**
   - Check user data script execution in CloudWatch logs

### Debug Mode

Enable verbose logging:
```bash
export DEBUG=deployer:*
deployer create ...
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## License

BSD-3-Clause License - see LICENSE file for details.

## Support

- GitHub Issues: Report bugs and feature requests
- Documentation: Comprehensive guides and examples
- Community: Join our Discord/Slack for support

---

**Note**: This tool is designed for development and testing environments. For production workloads, consider using AWS ECS, EKS, or other managed services for better reliability and support.