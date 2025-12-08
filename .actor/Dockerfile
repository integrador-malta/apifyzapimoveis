FROM apify/actor-node-playwright-chrome:20

# Copy and install dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy source code
COPY src ./src
COPY .actor ./.actor

# Run the actor
CMD ["npm", "start"]
