FROM node:22-alpine AS base

ENV NODE_ENV=production

WORKDIR /usr/src/app
COPY ./package.json ./
COPY ./package-lock.json ./

FROM base AS builder

COPY ./server ./server
COPY ./src ./src
COPY ./webpack.*.js ./

# Install ALL dependencies with legacy peer deps flag
RUN NODE_ENV=development npm install --legacy-peer-deps --no-fund --no-update-notifier --no-audit \
    && npm cache clean --force\
    && BABEL_ENV=node npm run build

FROM base AS production-image

# Install system dependencies
RUN apk update && apk add --no-cache \
    curl \
    unzip \
    gcompat \
    libstdc++ \
    libc6-compat \
    bash \
    nodejs \
    jq \
    openssh-client \
    sshpass \
    zip \
    && rm -rf /var/cache/apk/*

# Install balena-cli
ENV BALENA_CLI_VERSION=20.2.3
RUN curl -sSL https://github.com/balena-io/balena-cli/releases/download/v$BALENA_CLI_VERSION/balena-cli-v$BALENA_CLI_VERSION-linux-x64-standalone.zip > balena-cli.zip && \
    unzip balena-cli.zip && \
    chmod +x /usr/src/app/balena-cli/balena && \
    ln -s /usr/src/app/balena-cli/balena /usr/bin/balena && \
    rm balena-cli.zip

ENV BALENARC_BALENA_URL=digital-concepts.eu

# Install Node.js dependencies with legacy peer deps
RUN npm install --legacy-peer-deps --no-fund --no-update-notifier --no-audit && \
    npm dedupe && \
    npm install portfinder wait-port node-fetch multer react-helmet && \
    npm cache clean --force

COPY --from=builder /usr/src/app/server/ /usr/src/app/server/
COPY --from=builder /usr/src/app/src/ /usr/src/app/src/
COPY --from=builder /usr/src/app/webpack.*.js /usr/src/app/
COPY --from=builder /usr/src/app/dist/ /usr/src/app/dist/

CMD ["npm", "run", "serve"]