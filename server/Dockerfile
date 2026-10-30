# Multi-stage build para gerar binário ultraleve em Go
FROM golang:1.22-alpine AS builder

WORKDIR /app

# Instala certificados SSL e git se necessário
RUN apk add --no-cache ca-certificates git

# Cache de dependências do módulo Go
COPY go.mod go.sum* ./
RUN go mod download

# Copia código fonte
COPY . .

# Compila binário estático sem dependências externas
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o /app/velodesk-server ./cmd/server/main.go

# Imagem de produção mínima
FROM alpine:3.19

WORKDIR /app

# Instala certificados de autoridade raiz para conexões TLS seguras
RUN apk --no-cache add ca-certificates tzdata

COPY --from=builder /app/velodesk-server /app/velodesk-server
COPY --from=builder /app/web /app/web

EXPOSE 8080

ENTRYPOINT ["/app/velodesk-server"]
