FROM debian:bookworm

ARG DEBIAN_FRONTEND=noninteractive

# Update nodejs version to 20.x
RUN apt-get update && apt-get install -y curl && \
    curl -sL https://deb.nodesource.com/setup_20.x | bash -

RUN apt-get update && apt-get install -y \
    nodejs \
    node-typescript \
    jq \
    unzip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

# Install balena-cli
ENV BALENA_CLI_VERSION 15.2.3
RUN curl -sSL https://github.com/balena-io/balena-cli/releases/download/v$BALENA_CLI_VERSION/balena-cli-v$BALENA_CLI_VERSION-linux-x64-standalone.zip > balena-cli.zip && \
  unzip balena-cli.zip && \
  mv balena-cli/* /usr/bin && \
  rm -rf balena-cli.zip balena-cli

ENV BALENARC_BALENA_URL=digital-concepts.eu

COPY ./server ./server
COPY ./src ./src
COPY ./webpack.config.js ./
COPY ./package.json ./
COPY ./package-lock.json ./

RUN npm ci --no-fund --no-update-notifier

COPY start.sh ./

CMD ["bash", "start.sh"]