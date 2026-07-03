# Railway Docker build — Playwright Chromium on Ubuntu Jammy (libglib-2.0, etc.)
FROM mcr.microsoft.com/playwright:v1.61.1-jammy

LABEL org.opencontainers.image.title="annvero-gib-automation"
LABEL org.opencontainers.image.description="Railway GIB automation service (Playwright Docker build)"
LABEL org.opencontainers.image.base.name="mcr.microsoft.com/playwright:v1.61.1-jammy"

ARG RAILWAY_SERVICE_NAME=local
ARG RAILWAY_ENVIRONMENT=local
ARG RAILWAY_GIT_COMMIT_SHA=local

RUN echo "============================================================" && \
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

COPY package.json ./
RUN npm install --omit=dev

COPY server.mjs ./
COPY src ./src

RUN echo "Docker image ready. CMD: npm start (PORT from Railway)"

EXPOSE 8787

CMD ["npm", "start"]
