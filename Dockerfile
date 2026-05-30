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

# Expose production environment variable
ENV NODE_ENV=production

# Copy compiled application code and production node_modules from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# Copy static assets and template views
COPY --from=builder /app/views ./views
COPY --from=builder /app/public ./public

# Expose the port the web server listens on
EXPOSE 3000

# Start the application
CMD ["npm", "start"]