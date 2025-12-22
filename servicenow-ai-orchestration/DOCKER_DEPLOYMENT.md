# Docker Deployment Guide

## Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Development Setup](#development-setup)
- [Production Deployment](#production-deployment)
- [Environment Configuration](#environment-configuration)
- [Docker Architecture](#docker-architecture)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)

## Overview

This ServiceNow AI Orchestration application is fully containerized using Docker with multi-stage builds, optimized for both development and production environments. The containerization provides:

- **Consistency**: Same environment across all stages (dev, staging, production)
- **Isolation**: Dependencies and runtime isolated in containers
- **Security**: Non-root user, read-only filesystem, security hardening
- **Performance**: Optimized image sizes with layer caching
- **Scalability**: Easy horizontal scaling with Docker Swarm or Kubernetes

## Prerequisites

### Required Software

- **Docker Engine**: 20.10+ ([Install Docker](https://docs.docker.com/get-docker/))
- **Docker Compose**: 2.0+ ([Install Docker Compose](https://docs.docker.com/compose/install/))
- **Git**: For cloning the repository

### System Requirements

**Development:**
- CPU: 2+ cores
- RAM: 4GB minimum, 8GB recommended
- Disk: 10GB free space

**Production:**
- CPU: 2+ cores
- RAM: 2GB minimum, 4GB recommended
- Disk: 5GB free space

## Quick Start

### 1. Clone the Repository

```bash
git clone <repository-url>
cd servicenow-ai-orchestration
```

### 2. Configure Environment

```bash
# Copy the example environment file
cp .env.docker .env

# Edit .env with your ServiceNow instance URL and other settings
nano .env  # or use your preferred editor
```

### 3. Start Development Server

```bash
# Build and start the development container
docker-compose up -d

# View logs
docker-compose logs -f

# Access the application at http://localhost:5173
```

### 4. Stop the Application

```bash
docker-compose down
```

## Development Setup

### Building the Development Image

```bash
# Build the development image
docker-compose build

# Or rebuild without cache
docker-compose build --no-cache
```

### Running with Hot-Reload

The development setup includes hot-reloading for instant feedback:

```bash
docker-compose up -d
```

**What's included:**
- ✅ Hot module replacement (HMR)
- ✅ Source maps for debugging
- ✅ Volume mounts for live code changes
- ✅ Node modules persistence
- ✅ ESLint and TypeScript checking

### Development Workflow

1. **Start the container:**
   ```bash
   docker-compose up -d
   ```

2. **Edit source files** in your IDE - changes are reflected immediately

3. **View logs:**
   ```bash
   docker-compose logs -f app-dev
   ```

4. **Execute commands in container:**
   ```bash
   docker-compose exec app-dev npm run lint
   docker-compose exec app-dev npm run build
   ```

5. **Restart if needed:**
   ```bash
   docker-compose restart app-dev
   ```

### Debugging in Development

Access the container shell:

```bash
docker-compose exec app-dev sh
```

Install additional debugging tools:

```bash
docker-compose exec app-dev npm install --save-dev <package-name>
```

## Production Deployment

### Building the Production Image

```bash
# Build the optimized production image
docker build -t servicenow-ai-orchestration:latest --target production .

# Or using docker-compose
docker-compose -f docker-compose.prod.yml build
```

### Running in Production

```bash
# Start the production container
docker-compose -f docker-compose.prod.yml up -d

# View logs
docker-compose -f docker-compose.prod.yml logs -f

# Access the application at http://localhost:8080
```

### Production Features

- ✅ Multi-stage build for minimal image size
- ✅ Nginx web server for static file serving
- ✅ Gzip compression enabled
- ✅ Security headers configured
- ✅ Health check endpoints
- ✅ Non-root user execution
- ✅ Read-only filesystem
- ✅ Resource limits configured

### Health Checks

The production container includes health check endpoints:

- **Health**: `http://localhost:8080/health`
- **Readiness**: `http://localhost:8080/ready`

```bash
# Check container health
docker inspect --format='{{.State.Health.Status}}' servicenow-ai-orchestration-prod

# Test health endpoint
curl http://localhost:8080/health
```

## Environment Configuration

### Environment Variables

Create a `.env` file based on `.env.docker`:

```bash
# Required
VITE_SERVICENOW_INSTANCE=https://your-instance.service-now.com

# Optional
VITE_API_URL=http://localhost:5173
VITE_OPENAI_API_KEY=sk-...
VITE_ENABLE_OCR=true
VITE_ENABLE_AI_FEATURES=true
VITE_MAX_FILE_SIZE=20
```

### Production Environment Variables

For production, use Docker secrets or environment variable injection:

```bash
# Using docker-compose with env_file
docker-compose -f docker-compose.prod.yml --env-file .env.production up -d

# Or pass variables directly
docker run -e VITE_SERVICENOW_INSTANCE=https://prod.service-now.com \
  servicenow-ai-orchestration:latest
```

## Docker Architecture

### Multi-Stage Build

The Dockerfile uses 4 stages for optimal efficiency:

1. **Dependencies Stage**: Installs production dependencies only
2. **Builder Stage**: Installs all dependencies and builds the application
3. **Production Stage**: Serves built assets with Nginx
4. **Development Stage**: Runs Vite dev server with hot-reload

### Image Sizes

| Stage | Size | Use Case |
|-------|------|----------|
| Development | ~800MB | Local development with hot-reload |
| Production | ~40MB | Production deployment with Nginx |

### Security Hardening

- ✅ Non-root user (UID 1001)
- ✅ Read-only root filesystem
- ✅ No new privileges
- ✅ Security headers (X-Frame-Options, CSP, etc.)
- ✅ Minimal base image (Alpine Linux)
- ✅ No sensitive data in image layers
- ✅ Regular security updates

## Best Practices

### 1. Image Management

```bash
# Tag images properly
docker build -t servicenow-ai-orchestration:v1.0.0 --target production .

# Push to registry
docker tag servicenow-ai-orchestration:v1.0.0 registry.example.com/servicenow-ai-orchestration:v1.0.0
docker push registry.example.com/servicenow-ai-orchestration:v1.0.0
```

### 2. Volume Management

```bash
# List volumes
docker volume ls

# Remove unused volumes
docker volume prune

# Backup volume data
docker run --rm -v node_modules:/data -v $(pwd):/backup alpine tar czf /backup/node_modules.tar.gz /data
```

### 3. Log Management

```bash
# View logs with timestamps
docker-compose logs -f --timestamps

# Limit log output
docker-compose logs --tail=100 app-dev

# Save logs to file
docker-compose logs > application.log
```

### 4. Resource Optimization

Production resource limits are configured in `docker-compose.prod.yml`:

```yaml
deploy:
  resources:
    limits:
      cpus: '1'
      memory: 512M
    reservations:
      cpus: '0.5'
      memory: 256M
```

Adjust based on your workload:

```bash
# Update resource limits
docker update --cpus="2" --memory="1g" servicenow-ai-orchestration-prod
```

### 5. Security Scanning

```bash
# Scan for vulnerabilities with Trivy
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
  aquasec/trivy image servicenow-ai-orchestration:latest

# Generate SBOM (Software Bill of Materials)
docker sbom servicenow-ai-orchestration:latest
```

## CI/CD Integration

### GitHub Actions

A complete CI/CD pipeline is included in `.github/workflows/docker-build.yml`:

**Features:**
- ✅ Automated builds on push/PR
- ✅ Multi-platform builds (amd64, arm64)
- ✅ Security scanning with Trivy
- ✅ SBOM generation
- ✅ Push to GitHub Container Registry
- ✅ Automated testing

**Usage:**

```bash
# Pipeline triggers automatically on:
# - Push to main/develop branches
# - Pull requests
# - Version tags (v*)

# Manual trigger
gh workflow run docker-build.yml
```

### Other CI/CD Platforms

**GitLab CI:**

```yaml
build:
  image: docker:latest
  services:
    - docker:dind
  script:
    - cd servicenow-ai-orchestration
    - docker build -t $CI_REGISTRY_IMAGE:$CI_COMMIT_SHA .
    - docker push $CI_REGISTRY_IMAGE:$CI_COMMIT_SHA
```

**Jenkins:**

```groovy
pipeline {
  agent any
  stages {
    stage('Build') {
      steps {
        dir('servicenow-ai-orchestration') {
          sh 'docker build -t servicenow-ai-orchestration:latest .'
        }
      }
    }
  }
}
```

## Deployment Scenarios

### 1. Single Server Deployment

```bash
# Deploy to single server
docker-compose -f docker-compose.prod.yml up -d

# With nginx reverse proxy
docker network create web
docker-compose -f docker-compose.prod.yml up -d
```

### 2. Docker Swarm

```bash
# Initialize swarm
docker swarm init

# Deploy stack
docker stack deploy -c docker-compose.prod.yml servicenow-ai

# Scale service
docker service scale servicenow-ai_app-prod=3

# View services
docker stack services servicenow-ai
```

### 3. Kubernetes

Convert to Kubernetes manifests:

```bash
# Install kompose
curl -L https://github.com/kubernetes/kompose/releases/download/v1.28.0/kompose-linux-amd64 -o kompose
chmod +x kompose
sudo mv kompose /usr/local/bin/

# Convert docker-compose to k8s
kompose convert -f docker-compose.prod.yml

# Apply to cluster
kubectl apply -f .
```

### 4. Cloud Platforms

**AWS ECS:**
```bash
# Create ECR repository
aws ecr create-repository --repository-name servicenow-ai-orchestration

# Push image
docker tag servicenow-ai-orchestration:latest <account-id>.dkr.ecr.<region>.amazonaws.com/servicenow-ai-orchestration:latest
docker push <account-id>.dkr.ecr.<region>.amazonaws.com/servicenow-ai-orchestration:latest
```

**Azure Container Instances:**
```bash
# Create resource group
az group create --name servicenow-rg --location eastus

# Deploy container
az container create --resource-group servicenow-rg \
  --name servicenow-ai-orchestration \
  --image servicenow-ai-orchestration:latest \
  --cpu 1 --memory 1 \
  --ports 8080
```

**Google Cloud Run:**
```bash
# Build and push
gcloud builds submit --tag gcr.io/project-id/servicenow-ai-orchestration

# Deploy
gcloud run deploy servicenow-ai-orchestration \
  --image gcr.io/project-id/servicenow-ai-orchestration \
  --platform managed \
  --port 8080
```

## Monitoring and Observability

### Container Metrics

```bash
# Real-time stats
docker stats servicenow-ai-orchestration-prod

# Detailed inspection
docker inspect servicenow-ai-orchestration-prod
```

### Log Aggregation

**Using ELK Stack:**

```yaml
# docker-compose.monitoring.yml
version: '3.9'
services:
  app-prod:
    logging:
      driver: "fluentd"
      options:
        fluentd-address: localhost:24224
        tag: servicenow-ai-orchestration
```

**Using Prometheus:**

Add metrics exporter to nginx configuration:

```nginx
location /metrics {
    stub_status on;
    access_log off;
}
```

## Backup and Recovery

### Backup Strategies

```bash
# Backup volumes
docker run --rm \
  -v servicenow-ai-orchestration_node_modules:/data \
  -v $(pwd)/backups:/backup \
  alpine tar czf /backup/volumes-$(date +%Y%m%d).tar.gz /data

# Backup container state
docker commit servicenow-ai-orchestration-prod servicenow-ai-orchestration:backup-$(date +%Y%m%d)

# Export image
docker save servicenow-ai-orchestration:latest | gzip > servicenow-ai-orchestration-latest.tar.gz
```

### Restore Procedures

```bash
# Restore from volume backup
docker run --rm \
  -v servicenow-ai-orchestration_node_modules:/data \
  -v $(pwd)/backups:/backup \
  alpine tar xzf /backup/volumes-20250101.tar.gz -C /

# Load image
docker load < servicenow-ai-orchestration-latest.tar.gz
```

## Performance Optimization

### Build Optimization

```bash
# Use BuildKit for faster builds
DOCKER_BUILDKIT=1 docker build --target production .

# Multi-platform builds
docker buildx build --platform linux/amd64,linux/arm64 --target production .
```

### Runtime Optimization

```nginx
# nginx-default.conf optimizations
- Enable HTTP/2
- Configure worker processes
- Tune buffer sizes
- Enable caching headers
```

### Network Optimization

```bash
# Use host network mode for better performance (development only)
docker run --network host servicenow-ai-orchestration:dev
```

## Migration Path

### From Local Development

1. **Prepare environment file:**
   ```bash
   cp .env.docker .env
   # Edit .env with your settings
   ```

2. **Build and test:**
   ```bash
   docker-compose build
   docker-compose up -d
   ```

3. **Verify functionality:**
   - Test all features
   - Check ServiceNow connectivity
   - Validate file uploads
   - Test AI features

4. **Deploy to production:**
   ```bash
   docker-compose -f docker-compose.prod.yml up -d
   ```

### From Other Containerization

If migrating from other Docker setups:

1. Review the new Dockerfile structure
2. Update environment variables
3. Test volume mounts
4. Verify networking configuration
5. Update CI/CD pipelines

## Next Steps

- **Development**: Start with `docker-compose up -d`
- **Production**: Use `docker-compose -f docker-compose.prod.yml up -d`
- **Troubleshooting**: See [DOCKER_TROUBLESHOOTING.md](DOCKER_TROUBLESHOOTING.md)
- **CI/CD**: Configure GitHub Actions

## Additional Resources

- [Docker Documentation](https://docs.docker.com/)
- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [Nginx Documentation](https://nginx.org/en/docs/)
- [Vite Documentation](https://vitejs.dev/)
- [React Docker Best Practices](https://mherman.org/blog/dockerizing-a-react-app/)

## Support

For issues or questions:

1. Check the [Troubleshooting Guide](DOCKER_TROUBLESHOOTING.md)
2. Review container logs: `docker-compose logs -f`
3. Inspect container: `docker inspect <container-name>`
4. Open an issue in the repository