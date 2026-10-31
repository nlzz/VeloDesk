package auth

import (
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

var (
	ErrInvalidToken = errors.New("token de autenticação inválido ou expirado")
	ErrNoClaims     = errors.New("declarações do token ausentes")
)

// JWTClaims define os campos padronizados do token de sessão.
type JWTClaims struct {
	TenantID uuid.UUID `json:"tenant_id"`
	UserID   uuid.UUID `json:"user_id"`
	Name     string    `json:"name"`
	Email    string    `json:"email"`
	Role     string    `json:"role"`
	jwt.RegisteredClaims
}

// GenerateToken cria um JWT assinado com HMAC-SHA256.
func GenerateToken(secret string, tenantID, userID uuid.UUID, name, email, role string, ttl time.Duration) (string, error) {
	now := time.Now().UTC()
	claims := JWTClaims{
		TenantID: tenantID,
		UserID:   userID,
		Name:     name,
		Email:    email,
		Role:     role,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID.String(),
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
			Issuer:    "velodesk-enterprise-hub",
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString([]byte(secret))
	if err != nil {
		return "", fmt.Errorf("falha ao assinar jwt: %w", err)
	}

	return tokenString, nil
}

// ValidateToken valida o token recebido e decodifica as permissões.
func ValidateToken(secret string, tokenStr string) (*JWTClaims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &JWTClaims{}, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("método de assinatura inesperado: %v", t.Header["alg"])
		}
		return []byte(secret), nil
	})

	if err != nil || !token.Valid {
		return nil, ErrInvalidToken
	}

	claims, ok := token.Claims.(*JWTClaims)
	if !ok {
		return nil, ErrNoClaims
	}

	return claims, nil
}
