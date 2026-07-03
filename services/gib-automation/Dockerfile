# Includes Chromium and Linux deps (libglib-2.0, etc.) required by Playwright.
FROM mcr.microsoft.com/playwright:v1.61.1-jammy

WORKDIR /app

ENV NODE_ENV=production
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package.json ./
RUN npm install --omit=dev

COPY server.mjs ./
COPY src ./src

EXPOSE 8787

CMD ["npm", "start"]
