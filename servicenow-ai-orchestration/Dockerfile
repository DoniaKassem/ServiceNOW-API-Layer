# ==================================
# Stage 1: Dependencies
# ==================================
FROM node:20-alpine AS dependencies

# Install security updates and required tools
RUN apk update && \
    apk upgrade && \
    apk add --no-cache \
    dumb-init \
    python3 \
    make \
    g++ \
    && rm -rf /var/cache/apk/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies with production optimizations
RUN npm ci --only=production --ignore-scripts && \
    npm cache clean --force

# ==================================
# Stage 2: Build
# ==================================
FROM node:20-alpine AS builder

# Install build dependencies
RUN apk update && \
    apk add --no-cache \
    python3 \
    make \
    g++ \
    && rm -rf /var/cache/apk/*

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install all dependencies (including devDependencies)
RUN npm ci --ignore-scripts && \
    npm cache clean --force

# Copy source code
COPY . .

# Build the application
RUN npm run build

# ==================================
# Stage 3: Production Runtime
# ==================================
FROM nginx:1.27-alpine AS production

# Install security updates and dumb-init for proper signal handling
RUN apk update && \
    apk upgrade && \
    apk add --no-cache \
    dumb-init \
    curl \
    && rm -rf /var/cache/apk/*

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 -G nodejs

# Copy custom nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf
COPY nginx-default.conf /etc/nginx/conf.d/default.conf

# Copy built assets from builder stage
COPY --from=builder --chown=nodejs:nodejs /app/dist /usr/share/nginx/html

# Create required directories with proper permissions
RUN mkdir -p /var/cache/nginx /var/run /var/log/nginx && \
    chown -R nodejs:nodejs /var/cache/nginx /var/run /var/log/nginx /usr/share/nginx/html && \
    chmod -R 755 /var/cache/nginx /var/run /var/log/nginx

# Create health check script
RUN echo '#!/bin/sh' > /usr/local/bin/healthcheck.sh && \
    echo 'curl -f http://localhost:8080/health || exit 1' >> /usr/local/bin/healthcheck.sh && \
    chmod +x /usr/local/bin/healthcheck.sh

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD ["/usr/local/bin/healthcheck.sh"]

# Use dumb-init to handle signals properly
ENTRYPOINT ["/usr/bin/dumb-init", "--"]

# Start nginx
CMD ["nginx", "-g", "daemon off;"]

# ==================================
# Stage 4: Development Runtime
# ==================================
FROM node:20-alpine AS development

# Install dependencies including git for potential npm packages
RUN apk update && \
    apk upgrade && \
    apk add --no-cache \
    dumb-init \
    git \
    python3 \
    make \
    g++ \
    && rm -rf /var/cache/apk/*

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 -G nodejs

WORKDIR /app

# Change ownership of the app directory
RUN chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Copy package files
COPY --chown=nodejs:nodejs package.json package-lock.json ./

# Install all dependencies
RUN npm ci && \
    npm cache clean --force

# Copy source code
COPY --chown=nodejs:nodejs . .

# Expose Vite dev server port
EXPOSE 5173

# Health check for dev server
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:5173/ || exit 1

# Use dumb-init to handle signals properly
ENTRYPOINT ["/usr/bin/dumb-init", "--"]

# Start development server
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]