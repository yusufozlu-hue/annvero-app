# Railway Docker build — Playwright Chromium on Ubuntu Jammy (includes libglib-2.0, etc.)
FROM mcr.microsoft.com/playwright:v1.61.1-jammy

LABEL org.opencontainers.image.title="annvero-gib-automation"
LABEL org.opencontainers.image.description="Railway GIB automation service (Playwright Docker build)"

ARG RAILWAY_SERVICE_NAME=local
ARG RAILWAY_ENVIRONMENT=local
ARG RAILWAY_GIT_COMMIT_SHA=local

RUN echo "==> Railway Docker build: annvero-gib-automation" && \
    echo "==> Builder: DOCKERFILE (not Nixpacks/Railpack)" && \
    echo "==> Base image: mcr.microsoft.com/playwright:v1.61.1-jammy" && \
    echo "==> Service: ${RAILWAY_SERVICE_NAME} | Environment: ${RAILWAY_ENVIRONMENT}" && \
    echo "==> Git commit: ${RAILWAY_GIT_COMMIT_SHA}"

WORKDIR /app

ENV NODE_ENV=production
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package.json ./
RUN echo "==> Installing npm dependencies..." && npm install --omit=dev

COPY server.mjs ./
COPY src ./src

RUN echo "==> Docker build complete. Start command: npm start (PORT from Railway env)"

EXPOSE 8787

CMD ["npm", "start"]
