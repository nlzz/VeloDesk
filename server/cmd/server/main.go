package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"velodesk-server/internal/config"
	"velodesk-server/internal/handler"
	"velodesk-server/internal/signaling"
)

func main() {
	cfg := config.LoadConfig()
	hub := signaling.NewHub(cfg)
	h := handler.NewHandler(hub, cfg)

	mux := http.NewServeMux()

	// WebSocket de Sinalização
	mux.HandleFunc("/ws", h.HandleWebSocket)

	// Endpoints REST de Saúde e Credenciais
	mux.HandleFunc("/api/v1/health", h.HandleHealth)
	mux.HandleFunc("/api/v1/turn-credentials", h.HandleTURNCredentials)

	// Servidor de Arquivos Estáticos (Web Client / PWA)
	fs := http.FileServer(http.Dir(cfg.StaticDir))
	mux.Handle("/", fs)

	server := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      mux,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Inicia servidor em goroutine
	go func() {
		log.Printf("==================================================")
		log.Printf("  VeloDesk Signaling Server - High Performance")
		log.Printf("  Porta HTTP/WS  : %s", cfg.Port)
		log.Printf("  STUN URL       : %s", cfg.StunURL)
		log.Printf("  TURN URL       : %s", cfg.TurnURL)
		log.Printf("  Realm TURN     : %s", cfg.TurnRealm)
		log.Printf("==================================================")

		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("[Signaling] Erro fatal no servidor HTTP: %v", err)
		}
	}()

	// Graceful Shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, os.Interrupt, syscall.SIGTERM)
	<-quit

	log.Println("[Signaling] Desligando servidor de sinalização...")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		log.Fatalf("[Signaling] Erro ao encerrar servidor: %v", err)
	}

	fmt.Println("[Signaling] Servidor finalizado com sucesso.")
}
