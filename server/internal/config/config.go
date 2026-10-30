package config

import (
	"os"
	"strconv"
	"time"
)

// Config armazena as configurações de ambiente do VeloDesk Server
type Config struct {
	Port           string
	TurnSecret     string
	TurnRealm      string
	StunURL        string
	TurnURL        string
	TurnTTL        time.Duration
	StaticDir      string
	AllowedOrigins []string
}

// LoadConfig carrega as configurações das variáveis de ambiente com fallbacks seguros
func LoadConfig() *Config {
	port := getEnv("PORT", "8080")
	turnSecret := getEnv("TURN_SECRET", "velodesk_super_secret_turn_key_change_in_production")
	turnRealm := getEnv("TURN_REALM", "turn.velodesk.local")
	stunURL := getEnv("STUN_URL", "stun:turn.velodesk.local:3478")
	turnURL := getEnv("TURN_URL", "turn:turn.velodesk.local:3478")
	staticDir := getEnv("STATIC_DIR", "./web")

	ttlSecsStr := getEnv("TURN_TTL_SECONDS", "86400")
	ttlSecs, err := strconv.Atoi(ttlSecsStr)
	if err != nil || ttlSecs <= 0 {
		ttlSecs = 86400
	}

	return &Config{
		Port:           port,
		TurnSecret:     turnSecret,
		TurnRealm:      turnRealm,
		StunURL:        stunURL,
		TurnURL:        turnURL,
		TurnTTL:        time.Duration(ttlSecs) * time.Second,
		StaticDir:      staticDir,
		AllowedOrigins: []string{"*"},
	}
}

func getEnv(key, defaultValue string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return defaultValue
}
