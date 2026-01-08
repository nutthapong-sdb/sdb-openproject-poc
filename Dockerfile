# Use Node.js 20 (Debian Bookworm)
FROM node:20

# Install Chromium and necessary fonts
# This works for both amd64 (Intel) and arm64 (Apple Silicon)
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-thai-tlwg \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-kacst \
    fonts-freefont-ttf \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files first (for better layer caching)
COPY package*.json ./

# Install npm dependencies
# Use npm ci for reproducible builds and --only=production for smaller image
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
RUN npm ci --only=production

# Copy application source
COPY . .

# Create non-root user for security
RUN groupadd -r appuser && useradd -r -g appuser appuser

# Ensure the database file exists and set proper ownership
RUN touch projects.db && chown appuser:appuser projects.db && chmod 644 projects.db

# Change ownership of app directory to non-root user
RUN chown -R appuser:appuser /app

# Switch to non-root user
USER appuser

# Expose port 3001
EXPOSE 3001

# Tell Puppeteer to use the installed Chromium
# The path is /usr/bin/chromium in Debian
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Add health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3001/', (r) => r.statusCode === 200 ? process.exit(0) : process.exit(1))" || exit 1

# Run the application
CMD ["npm", "start"]
