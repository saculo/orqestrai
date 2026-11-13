# orq as an image, for `orq serve`. The release job builds and pushes it as
# ghcr.io/saculo/orqestrai:<version>. The image holds the one compiled binary and nothing else.
FROM oven/bun:1.4.4@sha256:1d22548f177f4ff38e0c15baa3c2c46c6c2060ba2d1bc573bb4720b407548f1d AS build
WORKDIR /src
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY src src
COPY templates templates
RUN bun run build

FROM gcr.io/distroless/base-debian12:nonroot@sha256:7f0c72cd138b442ae0deeb69c08b1acf5525439ba251a49ad93c320a061567e5
COPY --from=build /src/dist/orq /usr/local/bin/orq
USER 65532:65532
ENTRYPOINT ["/usr/local/bin/orq"]
CMD ["serve", "--host", "0.0.0.0", "--port", "7400"]
