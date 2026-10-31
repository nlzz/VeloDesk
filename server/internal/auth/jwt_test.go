package auth

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestJWTGenerationAndValidation(t *testing.T) {
	secret := "chave_secreta_jwt_de_teste_123456789"
	tenantID := uuid.New()
	userID := uuid.New()

	tokenStr, err := GenerateToken(secret, tenantID, userID, "Técnico Silva", "silva@alfa.com", "TECH_ATTENDED", 1*time.Hour)
	if err != nil {
		t.Fatalf("Erro ao gerar JWT: %v", err)
	}

	claims, err := ValidateToken(secret, tokenStr)
	if err != nil {
		t.Fatalf("Erro ao validar token válido: %v", err)
	}

	if claims.TenantID != tenantID || claims.UserID != userID || claims.Role != "TECH_ATTENDED" {
		t.Fatalf("Claims incorretas retornadas: %+v", claims)
	}

	// Valida chave incorreta
	_, err = ValidateToken("chave_errada", tokenStr)
	if err == nil {
		t.Fatal("Token foi validado com segredo incorreto")
	}

	// Valida expiração
	expiredToken, err := GenerateToken(secret, tenantID, userID, "Expirado", "exp@alfa.com", "ADMIN", -1*time.Minute)
	if err != nil {
		t.Fatalf("Erro ao gerar token expirado: %v", err)
	}
	_, err = ValidateToken(secret, expiredToken)
	if err == nil {
		t.Fatal("Token expirado foi aceito como válido")
	}
}
