# ==============================================================================
# STAGE 1: Builder (Builds application and installs dependencies)
# ==============================================================================
FROM node:22-alpine AS builder

# Install build dependencies for compilation of native C++ modules (like bcrypt and better-sqlite3)
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy dependency manifests
COPY package*.json tsconfig.json ./

# Install ALL dependencies (including devDependencies required for compilation)
RUN npm ci

# Copy the rest of the application source code
COPY . .

# Compile TypeScript into JavaScript (dist/)
RUN npm run build

# Prune development dependencies, leaving only production packages in node_modules
RUN npm prune --omit=dev


# ==============================================================================
# STAGE 2: Runner (Minimal production container)
# ==============================================================================
FROM node:22-alpine AS runner

WORKDIR /app

# Set production environment
ENV NODE_ENV=production

# Create database directory and set permissions for node user
RUN mkdir -p /app/data && chown -R node:node /app/data

# Copy compiled application code, production dependencies, and assets with node user ownership
COPY --chown=node:node --from=builder /app/dist ./dist
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/package.json ./package.json
COPY --chown=node:node --from=builder /app/views ./views
COPY --chown=node:node --from=builder /app/public ./public

# Use the non-root node user for security
USER node

# Expose the port the web server listens on
EXPOSE 3000

# Start the application
CMD ["npm", "start"]