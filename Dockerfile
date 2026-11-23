# orq-server as an image. The release job builds and pushes it as
# ghcr.io/saculo/orqestrai:<version>. The image holds the one compiled binary and nothing else.
FROM oven/bun:1.4.4@sha256:1d22548f177f4ff38e0c15baa3c2c46c6c2060ba2d1bc573bb4720b407548f1d AS build
WORKDIR /src
COPY package.json bun.lock tsconfig.json ./
COPY packages/core/package.json packages/core/
COPY packages/cli/package.json packages/cli/
COPY packages/server/package.json packages/server/
RUN bun install --frozen-lockfile --production --filter orqestrai-server
COPY packages/core/src packages/core/src
COPY packages/server/src packages/server/src
RUN cd packages/server && bun run build

FROM gcr.io/distroless/base-debian12:nonroot@sha256:7f0c72cd138b442ae0deeb69c08b1acf5525439ba251a49ad93c320a061567e5
COPY --from=build /src/packages/server/dist/orq-server /usr/local/bin/orq-server
USER 65532:65532
ENTRYPOINT ["/usr/local/bin/orq-server"]
CMD ["--host", "0.0.0.0", "--port", "7400"]
