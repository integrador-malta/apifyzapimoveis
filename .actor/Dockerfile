FROM apify/actor-node-playwright-chrome:20

# Copy and install dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npx playwright install chromium

# Copy source code
COPY src ./src
COPY .actor ./.actor

# Run the actor
CMD ["npm", "start"]
