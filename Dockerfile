FROM node:22-slim

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates ffmpeg procps python3 \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/client/package.json apps/client/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN npm ci

COPY apps/api apps/api
COPY apps/client apps/client
COPY packages/shared packages/shared

ARG BROADSIDE_API_BASE_URL=http://127.0.0.1:3101
ENV BROADSIDE_API_BASE_URL=${BROADSIDE_API_BASE_URL}

RUN npm run build -w @broadside/shared \
  && npm run build -w @broadside/api \
  && npm run build -w @broadside/client

ENV API_PORT=3101
ENV HOST=127.0.0.1
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["sh", "-c", "npx concurrently -k -s first -n api,client \"HOST=${HOST:-127.0.0.1} PORT=${API_PORT:-3101} npm run start -w @broadside/api\" \"npm run start -w @broadside/client -- -H 0.0.0.0 -p ${PORT:-3000}\""]
