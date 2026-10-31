# Multi-stage build para gerar binário ultraleve em Go do VeloDesk v2.0 Enterprise Hub
FROM golang:1.22-alpine AS builder

WORKDIR /app

RUN apk add --no-cache ca-certificates git

# Cache de dependências do módulo Go
COPY server/go.mod server/go.sum* ./
RUN go mod download

# Copia código fonte do servidor e assets web pre-compilados
COPY server/ .

# Compila binário estático sem dependências externas
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o /app/velodesk-server ./cmd/server/main.go

# Imagem de produção mínima
FROM alpine:3.19

WORKDIR /app

RUN apk --no-cache add ca-certificates tzdata

COPY --from=builder /app/velodesk-server /app/velodesk-server
COPY --from=builder /app/web /app/web

EXPOSE 8080

ENTRYPOINT ["/app/velodesk-server"]
