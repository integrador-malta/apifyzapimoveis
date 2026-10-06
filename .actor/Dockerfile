FROM apify/actor-node-playwright-chrome:20

# Copy and install dependencies
COPY --chown=myuser:myuser package.json package-lock.json ./
RUN npm ci --omit=dev

# The base image's shared browser directory is owned by root.
USER root
RUN PLAYWRIGHT_SKIP_BROWSER_GC=1 npx playwright install chromium
USER myuser
RUN test -x "$(node -e 'process.stdout.write(require("playwright").chromium.executablePath())')"

# Copy source code
COPY --chown=myuser:myuser src ./src
COPY --chown=myuser:myuser .actor ./.actor

# Run the actor
CMD ["npm", "start"]
