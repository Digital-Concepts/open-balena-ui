FROM node:22-alpine AS base

ENV NODE_ENV=production

RUN apk update && apk add --no-cache \
    unzip \
    && rm -rf /var/cache/apk/*

# Install balena-cli
ENV BALENA_CLI_VERSION 20.2.3
RUN curl -sSL https://github.com/balena-io/balena-cli/releases/download/v$BALENA_CLI_VERSION/balena-cli-v$BALENA_CLI_VERSION-linux-x64-standalone.zip > balena-cli.zip && \
  unzip balena-cli.zip && \
  mv balena-cli/* /usr/bin && \
  rm -rf balena-cli.zip balena-cli

ENV BALENARC_BALENA_URL=digital-concepts.eu

WORKDIR /usr/src/app
COPY ./package.json ./
COPY ./package-lock.json ./

RUN npm install --no-fund --no-update-notifier --no-audit && \
    npm install portfinder wait-port node-fetch && \
    npm cache clean --force

FROM base AS builder

COPY ./server ./server
COPY ./src ./src
COPY ./webpack.*.js ./

RUN NODE_ENV=development npm install --no-fund --no-update-notifier --no-audit \
    && npm cache clean --force \
    && BABEL_ENV=node npm run build

FROM base AS production-image

COPY --from=builder /usr/src/app/server/ /usr/src/app/server/
COPY --from=builder /usr/src/app/dist/ /usr/src/app/dist/

CMD ["npm", "run", "serve"]