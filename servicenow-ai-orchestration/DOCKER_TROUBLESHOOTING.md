# Docker Troubleshooting Guide

## Table of Contents

- [Common Issues](#common-issues)
- [Build Issues](#build-issues)
- [Runtime Issues](#runtime-issues)
- [Network Issues](#network-issues)
- [Performance Issues](#performance-issues)
- [Development Issues](#development-issues)
- [Production Issues](#production-issues)
- [Debugging Techniques](#debugging-techniques)
- [Health Check Failures](#health-check-failures)
- [Platform-Specific Issues](#platform-specific-issues)

## Common Issues

### 1. Container Won't Start

**Symptoms:**
- Container exits immediately
- Status shows "Exited (1)"
- No logs available

**Solutions:**

```bash
# Check logs
docker-compose logs app-dev

# Inspect container
docker inspect servicenow-ai-orchestration-dev

# Check if port is already in use
netstat -ano | findstr :5173  # Windows
lsof -i :5173                 # macOS/Linux

# Kill process using the port
# Windows
netstat -ano | findstr :5173
taskkill /PID <PID> /F

# macOS/Linux
kill -9 $(lsof -t -i:5173)
```

### 2. Permission Denied Errors

**Symptoms:**
```
Error: EACCES: permission denied
```

**Solutions:**

```bash
# Fix file permissions (Unix-based systems)
sudo chown -R $USER:$USER .

# Or run with proper user in container
docker-compose exec --user root app-dev sh

# Check volume permissions
docker-compose exec app-dev ls -la /app

# Fix node_modules permissions
docker-compose exec app-dev chown -R nodejs:nodejs /app/node_modules
```

### 3. "Cannot Find Module" Errors

**Symptoms:**
```
Error: Cannot find module 'xxx'
```

**Solutions:**

```bash
# Rebuild node_modules volume
docker-compose down -v
docker-compose up -d --build

# Or manually reinstall
docker-compose exec app-dev npm ci

# Clear npm cache
docker-compose exec app-dev npm cache clean --force
docker-compose exec app-dev rm -rf node_modules package-lock.json
docker-compose exec app-dev npm install
```

### 4. Out of Memory Errors

**Symptoms:**
```
JavaScript heap out of memory
FATAL ERROR: Reached heap limit
```

**Solutions:**

```bash
# Increase Node.js memory limit
# In docker-compose.yml, add:
environment:
  - NODE_OPTIONS=--max-old-space-size=4096

# Or increase Docker memory limit
# Docker Desktop: Settings > Resources > Memory > Increase

# Check current memory usage
docker stats servicenow-ai-orchestration-dev
```

## Build Issues

### 1. Build Fails with Network Errors

**Symptoms:**
```
error: failed to fetch
npm ERR! network
```

**Solutions:**

```bash
# Use a different npm registry
docker build --build-arg NPM_REGISTRY=https://registry.npmjs.org .

# Configure proxy if behind corporate firewall
docker build --build-arg HTTP_PROXY=http://proxy:8080 .

# Increase build timeout
DOCKER_BUILDKIT=1 docker build --progress=plain .

# Use npm retry
docker-compose exec app-dev npm install --retry 3
```

### 2. Build Fails with "No Space Left on Device"

**Symptoms:**
```
no space left on device
```

**Solutions:**

```bash
# Clean Docker system
docker system prune -a --volumes

# Check disk usage
docker system df

# Remove unused images
docker image prune -a

# Remove unused volumes
docker volume prune

# Remove stopped containers
docker container prune
```

### 3. Slow Build Times

**Solutions:**

```bash
# Use BuildKit
DOCKER_BUILDKIT=1 docker-compose build

# Enable layer caching
docker-compose build --cache-from servicenow-ai-orchestration:latest

# Use multi-stage builds (already configured)
# Check if .dockerignore is properly configured

# Build only what changed
docker-compose build --no-cache app-dev
```

### 4. Build Context Too Large

**Symptoms:**
```
Sending build context to Docker daemon: 2.5GB
```

**Solutions:**

```bash
# Ensure .dockerignore is present and includes:
node_modules
dist
.git
*.log

# Check build context size
du -sh .

# Manually exclude directories
docker build --exclude node_modules --exclude dist .
```

## Runtime Issues

### 1. Hot Reload Not Working

**Symptoms:**
- Changes to source files don't trigger rebuild
- Browser doesn't refresh

**Solutions:**

```bash
# Ensure volumes are properly mounted
docker-compose down
docker-compose up -d

# Check Vite config
docker-compose exec app-dev cat vite.config.ts

# Windows: Enable polling in vite.config.ts
server: {
  watch: {
    usePolling: true
  }
}

# Restart container
docker-compose restart app-dev
```

### 2. Environment Variables Not Loading

**Symptoms:**
- `process.env.VITE_*` is undefined
- ServiceNow connection fails

**Solutions:**

```bash
# Check if .env file exists
ls -la .env

# Ensure env_file is specified in docker-compose.yml
docker-compose config

# Print environment variables
docker-compose exec app-dev printenv | grep VITE

# Reload environment
docker-compose down
docker-compose up -d

# For Vite, variables must start with VITE_
# Rename any non-VITE_ variables
```

### 3. Static Assets Not Loading

**Symptoms:**
- 404 errors for CSS, JS, images
- Blank page in production

**Solutions:**

```bash
# Check nginx configuration
docker-compose -f docker-compose.prod.yml exec app-prod cat /etc/nginx/conf.d/default.conf

# Verify build output
docker-compose -f docker-compose.prod.yml exec app-prod ls -la /usr/share/nginx/html

# Check nginx logs
docker-compose -f docker-compose.prod.yml logs app-prod

# Test static file serving
curl -I http://localhost:8080/index.html
```

### 4. ServiceNow API Connection Issues

**Symptoms:**
```
ERR_CONNECTION_REFUSED
CORS errors
```

**Solutions:**

```bash
# Verify ServiceNow instance URL
docker-compose exec app-dev printenv | grep SERVICENOW

# Check proxy configuration in vite.config.ts
docker-compose exec app-dev cat vite.config.ts

# Test connection from container
docker-compose exec app-dev curl -I https://illumindev.service-now.com

# Check network connectivity
docker-compose exec app-dev ping illumindev.service-now.com

# For CORS issues, ensure proxy is configured:
server: {
  proxy: {
    '/api/servicenow': {
      target: process.env.VITE_SERVICENOW_INSTANCE,
      changeOrigin: true,
      secure: true
    }
  }
}
```

## Network Issues

### 1. Cannot Access Container from Host

**Symptoms:**
- `curl localhost:5173` fails
- Browser can't reach application

**Solutions:**

```bash
# Check if container is running
docker-compose ps

# Verify port mapping
docker-compose port app-dev 5173

# Check if port is exposed
docker inspect servicenow-ai-orchestration-dev | grep PortBindings

# Test from inside container
docker-compose exec app-dev wget -O- http://localhost:5173

# Windows: Use 127.0.0.1 instead of localhost
curl http://127.0.0.1:5173
```

### 2. Containers Cannot Communicate

**Symptoms:**
- Service discovery fails
- Database connection errors

**Solutions:**

```bash
# Check network
docker network ls
docker network inspect servicenow-network

# Verify containers are on same network
docker inspect servicenow-ai-orchestration-dev | grep NetworkMode

# Test connectivity between containers
docker-compose exec app-dev ping app-prod

# Recreate network
docker-compose down
docker network rm servicenow-network
docker-compose up -d
```

### 3. DNS Resolution Fails

**Symptoms:**
```
getaddrinfo ENOTFOUND
```

**Solutions:**

```bash
# Use custom DNS servers
# In docker-compose.yml:
services:
  app-dev:
    dns:
      - 8.8.8.8
      - 8.8.4.4

# Test DNS resolution
docker-compose exec app-dev nslookup google.com

# Check /etc/resolv.conf
docker-compose exec app-dev cat /etc/resolv.conf
```

## Performance Issues

### 1. Slow Response Times

**Solutions:**

```bash
# Check container resources
docker stats servicenow-ai-orchestration-prod

# Increase container resources
# In docker-compose.prod.yml:
deploy:
  resources:
    limits:
      cpus: '2'
      memory: 1024M

# Enable nginx caching
# Already configured in nginx-default.conf

# Check for memory leaks
docker-compose exec app-prod top
```

### 2. High CPU Usage

**Solutions:**

```bash
# Profile the application
docker-compose exec app-dev npm run build -- --profile

# Check for infinite loops
docker-compose exec app-dev ps aux

# Limit CPU usage
docker update --cpus="1.5" servicenow-ai-orchestration-prod

# Enable production mode
NODE_ENV=production docker-compose -f docker-compose.prod.yml up -d
```

### 3. Slow Build Times in Development

**Solutions:**

```bash
# Use volume mount optimization
# In docker-compose.yml, use :delegated
volumes:
  - ./src:/app/src:delegated

# Exclude node_modules from sync
# Use named volume (already configured)

# Windows: Enable file sharing in Docker Desktop
# Settings > Resources > File Sharing

# Use WSL2 backend on Windows
# Settings > General > Use WSL2 based engine
```

## Development Issues

### 1. TypeScript Errors Not Showing

**Solutions:**

```bash
# Run type checking manually
docker-compose exec app-dev npm run build

# Check TypeScript config
docker-compose exec app-dev cat tsconfig.json

# Run ESLint
docker-compose exec app-dev npm run lint

# Enable verbose logging
docker-compose exec app-dev npm run dev -- --debug
```

### 2. ESLint Not Working

**Solutions:**

```bash
# Reinstall ESLint
docker-compose exec app-dev npm install --save-dev eslint

# Check ESLint config
docker-compose exec app-dev cat eslint.config.js

# Run manually
docker-compose exec app-dev npm run lint

# Fix auto-fixable issues
docker-compose exec app-dev npm run lint -- --fix
```

### 3. Vite Dev Server Issues

**Solutions:**

```bash
# Clear Vite cache
docker-compose exec app-dev rm -rf node_modules/.vite

# Restart with verbose logging
docker-compose logs -f app-dev

# Check Vite config
docker-compose exec app-dev cat vite.config.ts

# Use different port
# In docker-compose.yml:
ports:
  - "3000:5173"
```

## Production Issues

### 1. Nginx Configuration Errors

**Symptoms:**
```
nginx: [emerg] invalid parameter
```

**Solutions:**

```bash
# Test nginx configuration
docker-compose -f docker-compose.prod.yml exec app-prod nginx -t

# View nginx error log
docker-compose -f docker-compose.prod.yml exec app-prod cat /var/log/nginx/error.log

# Reload nginx
docker-compose -f docker-compose.prod.yml exec app-prod nginx -s reload

# Debug nginx config
docker-compose -f docker-compose.prod.yml exec app-prod nginx -T
```

### 2. Health Check Failing

**Symptoms:**
- Container status shows "unhealthy"

**Solutions:**

```bash
# Check health status
docker inspect --format='{{.State.Health.Status}}' servicenow-ai-orchestration-prod

# View health check logs
docker inspect --format='{{range .State.Health.Log}}{{.Output}}{{end}}' servicenow-ai-orchestration-prod

# Test health endpoint manually
docker-compose -f docker-compose.prod.yml exec app-prod curl -f http://localhost:8080/health

# Adjust health check parameters
# In Dockerfile or docker-compose.prod.yml:
healthcheck:
  interval: 60s
  timeout: 5s
  start_period: 30s
```

### 3. Application Not Serving Correctly

**Solutions:**

```bash
# Check build output
docker-compose -f docker-compose.prod.yml exec app-prod ls -la /usr/share/nginx/html

# Verify file permissions
docker-compose -f docker-compose.prod.yml exec app-prod ls -la /usr/share/nginx/html

# Check nginx access logs
docker-compose -f docker-compose.prod.yml exec app-prod tail -f /var/log/nginx/access.log

# Test specific routes
curl -I http://localhost:8080/
curl -I http://localhost:8080/index.html
```

## Debugging Techniques

### 1. Interactive Shell

```bash
# Access development container shell
docker-compose exec app-dev sh

# Access production container shell (as non-root user)
docker-compose -f docker-compose.prod.yml exec app-prod sh

# Access as root (for debugging only)
docker-compose exec --user root app-dev sh
```

### 2. View All Logs

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f app-dev

# Last N lines
docker-compose logs --tail=100 app-dev

# With timestamps
docker-compose logs -f --timestamps app-dev

# Since specific time
docker-compose logs --since 2024-01-01T00:00:00 app-dev
```

### 3. Inspect Container Details

```bash
# Full container info
docker inspect servicenow-ai-orchestration-dev

# Specific property
docker inspect --format='{{.State.Status}}' servicenow-ai-orchestration-dev
docker inspect --format='{{.NetworkSettings.IPAddress}}' servicenow-ai-orchestration-dev

# Environment variables
docker inspect --format='{{range .Config.Env}}{{println .}}{{end}}' servicenow-ai-orchestration-dev
```

### 4. Network Debugging

```bash
# List all networks
docker network ls

# Inspect network
docker network inspect servicenow-network

# List containers on network
docker network inspect servicenow-network --format='{{range .Containers}}{{.Name}} {{end}}'

# Test connectivity
docker-compose exec app-dev ping app-prod
docker-compose exec app-dev telnet app-prod 8080
docker-compose exec app-dev nc -zv app-prod 8080
```

### 5. Performance Monitoring

```bash
# Real-time stats
docker stats

# Container processes
docker-compose exec app-dev top

# Disk usage
docker system df
docker system df -v

# Container resource usage
docker inspect servicenow-ai-orchestration-dev --format='{{.HostConfig.Memory}}'
```

## Health Check Failures

### Common Causes

1. **Application Not Ready**
   - Increase `start_period` in health check
   - Check application startup logs

2. **Wrong Health Check Command**
   ```bash
   # Test health check manually
   docker-compose exec app-prod /usr/local/bin/healthcheck.sh
   ```

3. **Network Issues**
   - Verify container can reach itself
   - Check firewall rules

4. **Resource Constraints**
   - Increase memory/CPU limits
   - Check for resource exhaustion

### Debugging Health Checks

```bash
# View health check definition
docker inspect --format='{{json .Config.Healthcheck}}' servicenow-ai-orchestration-prod | jq

# View health check logs
docker inspect --format='{{range .State.Health.Log}}{{.Output}}{{end}}' servicenow-ai-orchestration-prod

# Disable health check temporarily
docker-compose -f docker-compose.prod.yml up -d --no-healthcheck
```

## Platform-Specific Issues

### Windows

**Issue: Slow file sync**
```bash
# Solution: Use WSL2 backend
# Docker Desktop > Settings > General > Use WSL2 based engine

# Move project to WSL2 filesystem
wsl
cd /home/username
git clone <repo>
```

**Issue: Line ending issues**
```bash
# Configure git
git config --global core.autocrlf false
git config --global core.eol lf

# Rebuild container
docker-compose down
docker-compose up -d --build
```

**Issue: Drive sharing**
```bash
# Docker Desktop > Settings > Resources > File Sharing
# Add project directory
```

### macOS

**Issue: Performance with volumes**
```bash
# Use :cached or :delegated flags
volumes:
  - ./src:/app/src:delegated

# Or use named volumes
volumes:
  - node_modules:/app/node_modules
```

**Issue: Docker Desktop resource limits**
```bash
# Increase resources
# Docker Desktop > Preferences > Resources
# Memory: 4GB+
# CPUs: 2+
```

### Linux

**Issue: Permission issues**
```bash
# Run containers with same UID/GID as host
docker-compose build --build-arg UID=$(id -u) --build-arg GID=$(id -g)

# Fix file ownership
sudo chown -R $USER:$USER .
```

**Issue: Docker daemon not running**
```bash
# Start Docker service
sudo systemctl start docker
sudo systemctl enable docker

# Check status
sudo systemctl status docker
```

## Advanced Debugging

### 1. Enable Debug Mode

```bash
# Docker daemon debug mode
# /etc/docker/daemon.json
{
  "debug": true,
  "log-level": "debug"
}

sudo systemctl restart docker
```

### 2. Capture Network Traffic

```bash
# Install tcpdump in container
docker-compose exec --user root app-dev apk add tcpdump

# Capture traffic
docker-compose exec app-dev tcpdump -i any -w /tmp/capture.pcap

# Copy to host
docker cp servicenow-ai-orchestration-dev:/tmp/capture.pcap .
```

### 3. Memory Profiling

```bash
# Install heap profiler
docker-compose exec app-dev npm install --save-dev node-heap-profiler

# Generate heap snapshot
docker-compose exec app-dev node --inspect=0.0.0.0:9229 node_modules/.bin/vite

# Connect Chrome DevTools to localhost:9229
```

## Getting Help

If issues persist:

1. **Collect diagnostic information:**
   ```bash
   docker-compose version
   docker version
   docker-compose config
   docker-compose logs > logs.txt
   docker inspect <container> > inspect.txt
   ```

2. **Check documentation:**
   - [DOCKER_DEPLOYMENT.md](DOCKER_DEPLOYMENT.md)
   - [Docker Documentation](https://docs.docker.com/)
   - [Vite Documentation](https://vitejs.dev/)

3. **Search existing issues:**
   - Check GitHub issues
   - Search Stack Overflow
   - Review Vite troubleshooting guide

4. **Create a bug report** with:
   - System information
   - Steps to reproduce
   - Expected vs actual behavior
   - Relevant logs and error messages
   - Configuration files (sanitized)