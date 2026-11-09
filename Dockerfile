# orq as an image, for `orq serve` on VPS2 (deploy/). The release job builds and pushes it as
# ghcr.io/saculo/orqestrai:<version>. The image holds the one compiled binary and nothing else.
FROM oven/bun:1.3.10@sha256:b86c67b531d87b4db11470d9b2bd0c519b1976eee6fcd71634e73abfa6230d2e AS build
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
