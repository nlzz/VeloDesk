package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/google/uuid"
	"velodesk-server/internal/api"
	"velodesk-server/internal/audit"
	"velodesk-server/internal/auth"
	"velodesk-server/internal/config"
	"velodesk-server/internal/database"
	"velodesk-server/internal/handler"
	"velodesk-server/internal/hub"
	"velodesk-server/internal/signaling"
)

func main() {
	cfg := config.LoadConfig()

	// 1. Inicializa persistência (PostgreSQL com RLS ou MemoryStore para dev/standalone)
	var store database.Store
	if cfg.DatabaseURL != "" {
		log.Printf("[Database] Conectando ao PostgreSQL Enterprise...")
		pgStore, err := database.NewPostgresStore(cfg.DatabaseURL)
		if err != nil {
			log.Fatalf("[Database] Falha crítica ao conectar no PostgreSQL: %v", err)
		}
		defer pgStore.Close()

		log.Printf("[Database] Aplicando migrações com Row-Level Security forçado...")
		if err := pgStore.Migrate(context.Background(), database.SchemaSQL); err != nil {
			log.Fatalf("[Database] Falha ao aplicar migrações: %v", err)
		}
		store = pgStore
		log.Printf("[Database] PostgreSQL migrado e pronto com RLS.")
	} else {
		log.Printf("[Database] DATABASE_URL não configurada; operando com MemoryStore isolado.")
		store = database.NewMemoryStore()
	}

	// 1.1. Seed Automático do Super-Admin Inicial
	seedSuperAdmin(store)

	// 2. Componentes de Auditoria Criptográfica e Hubs
	auditMgr := audit.NewManager([]byte(cfg.AuditMasterKey))
	realtimeHub := hub.NewRealtimeHub()
	sigHub := signaling.NewHub(cfg)
	h := handler.NewHandler(sigHub, cfg)

	mux := http.NewServeMux()

	// 3. Registra Rotas da API REST Enterprise (Multi-Tenancy, Helpdesk, Auditoria, Hub WS)
	api.SetupRouter(mux, store, cfg, realtimeHub, auditMgr)

	// 4. WebSocket de Sinalização WebRTC (P2P e TURN Relay)
	mux.HandleFunc("/ws", h.HandleWebSocket)

	// 5. Endpoints de Diagnóstico e Credenciais TURN
	mux.HandleFunc("/api/v1/health", h.HandleHealth)
	mux.HandleFunc("/api/v1/turn-credentials", h.HandleTURNCredentials)

	// 6. Servidor de Arquivos Estáticos com Fallback SPA (Single Page Application)
	fs := http.FileServer(http.Dir(cfg.StaticDir))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// Não intercepta requisições de API ou WebSockets
		if strings.HasPrefix(r.URL.Path, "/api/") || strings.HasPrefix(r.URL.Path, "/ws") {
			http.NotFound(w, r)
			return
		}

		filePath := filepath.Join(cfg.StaticDir, filepath.Clean(r.URL.Path))
		if info, err := os.Stat(filePath); err == nil && !info.IsDir() {
			fs.ServeHTTP(w, r)
			return
		}

		// Fallback SPA: qualquer rota desconhecida entrega o index.html
		indexPath := filepath.Join(cfg.StaticDir, "index.html")
		if _, err := os.Stat(indexPath); err == nil {
			http.ServeFile(w, r, indexPath)
			return
		}

		fs.ServeHTTP(w, r)
	})

	// Orquestra handler raiz com CORS
	rootHandler := api.CORSMiddleware(mux)

	server := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      rootHandler,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Inicia servidor em goroutine
	go func() {
		log.Printf("==================================================")
		log.Printf("  VeloDesk v2.0 Enterprise Hub - High Performance")
		log.Printf("  Porta HTTP/WS  : %s", cfg.Port)
		log.Printf("  STUN URL       : %s", cfg.StunURL)
		log.Printf("  TURN URL       : %s", cfg.TurnURL)
		log.Printf("  Realm TURN     : %s", cfg.TurnRealm)
		log.Printf("  Static Dir     : %s", cfg.StaticDir)
		log.Printf("==================================================")

		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("[Server] Erro fatal no servidor HTTP: %v", err)
		}
	}()

	// Graceful Shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, os.Interrupt, syscall.SIGTERM)
	<-quit

	log.Println("[Server] Desligando servidor VeloDesk Enterprise...")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		log.Fatalf("[Server] Erro ao encerrar servidor: %v", err)
	}

	fmt.Println("[Server] Servidor finalizado com sucesso.")
}

func seedSuperAdmin(store database.Store) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	count, err := store.CountUsers(ctx)
	if err != nil {
		log.Printf("[Seed] Aviso: erro ao verificar usuários existentes: %v", err)
		return
	}

	if count == 0 {
		initialPassword := os.Getenv("ADMIN_INITIAL_PASSWORD")
		if initialPassword == "" {
			initialPassword = "VeloDeskAdmin2026!"
		}

		passHash, err := auth.HashPassword(initialPassword, auth.DefaultArgon2Params)
		if err != nil {
			log.Fatalf("[Seed] Erro crítico ao gerar hash da senha do super-admin: %v", err)
		}

		superAdmin := &database.User{
			ID:           uuid.New(),
			TenantID:     uuid.Nil,
			Name:         "Super Administrator",
			Email:        "admin@velodesk.com",
			PasswordHash: passHash,
			Role:         database.RoleSuperAdmin,
			Status:       database.UserStatusActive,
		}

		if err := store.CreateUser(ctx, superAdmin); err != nil {
			log.Fatalf("[Seed] Erro crítico ao criar Super-Admin inicial: %v", err)
		}

		log.Printf("==================================================")
		log.Printf("  [Seed] Super-Admin inicial criado com sucesso!")
		log.Printf("  E-mail : admin@velodesk.com")
		log.Printf("  Role   : %s", database.RoleSuperAdmin)
		log.Printf("==================================================")
	}
}
