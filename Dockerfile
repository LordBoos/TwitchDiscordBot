# Use Node.js 18 LTS
FROM node:18-alpine

# Install curl for health checks
RUN apk add --no-cache curl

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY src/ ./src/

# Create necessary directories
RUN mkdir -p logs data

# Set environment variables
ENV NODE_ENV=production

# Version reported by portainer-deployer (set by the GitHub Actions build)
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION

# Expose webhook port
EXPOSE 8081

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8081/health || exit 1

# Automatic deployment: github.com/LordBoos/portainer-deployer pulls :latest from GHCR
# and redeploys the Portainer stack. The SQLite DB lives in a volume, so no pre-deploy hook.
LABEL deployer.enable="true" \
      deployer.github_repo="LordBoos/TwitchDiscordBot"

# Start the application
CMD ["npm", "start"]
