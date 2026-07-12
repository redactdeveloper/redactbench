# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim

ARG HARNESS
ARG REDACTBENCH_VERSION
LABEL org.redactbench.harness=$HARNESS \
      org.redactbench.runtime-version=$REDACTBENCH_VERSION

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates git python3 ripgrep \
    && rm -rf /var/lib/apt/lists/*

COPY --from=harness_tool / /opt/harness/tool/
COPY --chmod=755 docker/harnesses/runner.mjs /usr/local/bin/redactbench-harness

ENTRYPOINT []
