FROM node:24-alpine AS base

ENV NODE_ENV=production

WORKDIR /usr/src/app
COPY ./package.json ./
COPY ./package-lock.json ./

RUN npm install --no-fund --no-update-notifier --no-audit \
    && npm cache clean --force

FROM base AS builder

COPY ./server ./server
COPY ./src ./src
COPY ./public ./public
COPY ./types ./types
COPY ./index.html ./
COPY ./tsconfig*.json ./
COPY ./vite.config.mts ./
COPY ./types.d.ts ./

RUN NODE_ENV=development npm install --no-fund --no-update-notifier --no-audit \
    && npm cache clean --force \
    && npm run build

FROM base AS production-image

# Install system dependencies required by fork features:
#  - sshpass / openssh-client: SSH button, file transfer
#  - zip / unzip: backup upload/download, balena-cli install
#  - jq: balena-cli helpers
#  - bash / curl / libstdc++ / libc6-compat / gcompat: balena-cli runtime
RUN apk update && apk add --no-cache \
    curl \
    unzip \
    gcompat \
    libstdc++ \
    libc6-compat \
    bash \
    jq \
    openssh-client \
    sshpass \
    zip \
    && rm -rf /var/cache/apk/*

# Install balena-cli (used by file transfer, ssh, supervisor update endpoints)
ENV BALENA_CLI_VERSION=20.2.3
RUN curl -sSL https://github.com/balena-io/balena-cli/releases/download/v$BALENA_CLI_VERSION/balena-cli-v$BALENA_CLI_VERSION-linux-x64-standalone.zip > balena-cli.zip && \
    unzip balena-cli.zip && \
    chmod +x /usr/src/app/balena-cli/balena && \
    ln -s /usr/src/app/balena-cli/balena /usr/bin/balena && \
    rm balena-cli.zip

ENV BALENARC_BALENA_URL=digital-concepts.eu

COPY --from=builder /usr/src/app/dist/ /usr/src/app/dist/
COPY --from=builder /usr/src/app/index.html /usr/src/app/index.html
COPY --from=builder /usr/src/app/public/ /usr/src/app/public/

CMD ["npm", "run", "serve"]
