# Railway Docker build — Playwright Chromium on Ubuntu Jammy (libglib-2.0, etc.)
FROM mcr.microsoft.com/playwright:v1.61.1-jammy

LABEL org.opencontainers.image.title="annvero-gib-automation"
LABEL org.opencontainers.image.description="Railway GIB automation service (Playwright Docker build)"
LABEL org.opencontainers.image.base.name="mcr.microsoft.com/playwright:v1.61.1-jammy"

ARG RAILWAY_SERVICE_NAME=local
ARG RAILWAY_ENVIRONMENT=local
ARG RAILWAY_GIT_COMMIT_SHA=local

RUN echo "============================================================" && \
    echo ">>> Railway proof: Using Detected Dockerfile <<<" && \
    echo ">>> FROM mcr.microsoft.com/playwright:v1.61.1-jammy <<<" && \
    echo "Railway builder: DOCKERFILE" && \
    echo "Base image: mcr.microsoft.com/playwright:v1.61.1-jammy" && \
    echo "Service: ${RAILWAY_SERVICE_NAME}" && \
    echo "Environment: ${RAILWAY_ENVIRONMENT}" && \
    echo "Git commit: ${RAILWAY_GIT_COMMIT_SHA}" && \
    echo "============================================================" && \
    node --version && \
    npx playwright --version

WORKDIR /app

ENV NODE_ENV=production
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV GIB_RUNTIME_LABEL=docker-playwright
ENV GIB_RUNTIME_IMAGE=mcr.microsoft.com/playwright:v1.61.1-jammy

COPY package.json ./
RUN npm install --omit=dev

COPY server.mjs ./
COPY src ./src

RUN node --input-type=module -e "import { chromium } from 'playwright'; console.log('Docker build chromium path:', chromium.executablePath());" && \
    printf '%s\n' \
      '{' \
      '  "builder": "DOCKERFILE",' \
      '  "proof": "Using Detected Dockerfile — built from mcr.microsoft.com/playwright:v1.61.1-jammy",' \
      '  "from": "mcr.microsoft.com/playwright:v1.61.1-jammy",' \
      "  \"builtAt\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"," \
      "  \"gitCommit\": \"${RAILWAY_GIT_COMMIT_SHA}\"" \
      '}' > /app/build-proof.json && \
    echo ">>> build-proof.json <<<" && \
    cat /app/build-proof.json && \
    echo ">>> Docker image ready. CMD: npm start <<<"

EXPOSE 8787

CMD ["npm", "start"]
