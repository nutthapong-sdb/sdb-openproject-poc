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

# Copy package files
COPY package*.json ./

# Install npm dependencies
# Set PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true because we use the system chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
RUN npm install

# Copy application source
COPY . .

# Ensure the database file exists and is writable
RUN touch projects.db && chmod 666 projects.db

# Expose port 3000
EXPOSE 3001

# Tell Puppeteer to use the installed Chromium
# The path is usually /usr/bin/chromium in Debian
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Run the application
# Important: We'll need to use --no-sandbox in puppeteer.launch in the code
CMD [ "npm", "start" ]
