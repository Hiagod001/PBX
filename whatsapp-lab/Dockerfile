FROM rust:1.95-bookworm AS builder
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config libopus-dev cmake clang && rm -rf /var/lib/apt/lists/*
ENV CARGO_BUILD_JOBS=4
WORKDIR /build
COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY ui ./ui
RUN --mount=type=cache,target=/usr/local/cargo/registry --mount=type=cache,target=/usr/local/cargo/git --mount=type=cache,target=/build/target cargo test --locked && cargo build --release --locked && cp target/release/uai-whatsapp-lab /build/uai-whatsapp-lab

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libopus0 curl && rm -rf /var/lib/apt/lists/* && useradd -u 10001 -m lab
COPY --from=builder /build/uai-whatsapp-lab /usr/local/bin/uai-whatsapp-lab
USER 10001:10001
WORKDIR /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=60s CMD curl -fsS http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["/usr/local/bin/uai-whatsapp-lab"]
