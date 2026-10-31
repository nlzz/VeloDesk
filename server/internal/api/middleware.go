package api

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"velodesk-server/internal/auth"
	"velodesk-server/internal/database"
)

type contextKey string

const (
	ContextKeyTenant contextKey = "tenant"
	ContextKeyClaims contextKey = "claims"
)

// JSONResponse envia resposta em JSON com código de status HTTP.
func JSONResponse(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

// ErrorResponse envia erro JSON padronizado.
func ErrorResponse(w http.ResponseWriter, status int, message string) {
	JSONResponse(w, status, map[string]interface{}{
		"error":   true,
		"message": message,
	})
}

// CORSMiddleware aplica cabeçalhos para permitir acesso cross-origin.
func CORSMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Tenant-Slug, X-Tenant-ID")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// TenantMiddleware extrai o tenant a partir do slug ou cabeçalho.
func TenantMiddleware(store database.Store) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			var tenant *database.Tenant
			var err error

			slug := r.Header.Get("X-Tenant-Slug")
			tenantIDStr := r.Header.Get("X-Tenant-ID")

			if slug != "" {
				tenant, err = store.GetTenantBySlug(r.Context(), slug)
			} else if tenantIDStr != "" {
				if uid, parseErr := uuid.Parse(tenantIDStr); parseErr == nil {
					tenant, err = store.GetTenantByID(r.Context(), uid)
				}
			}

			if tenant != nil && err == nil {
				ctx := context.WithValue(r.Context(), ContextKeyTenant, tenant)
				r = r.WithContext(ctx)
			}

			next.ServeHTTP(w, r)
		})
	}
}

// AuthMiddleware valida o token JWT e popula as claims no contexto.
func AuthMiddleware(jwtSecret string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")
			if authHeader == "" || !strings.HasPrefix(authHeader, "Bearer ") {
				ErrorResponse(w, http.StatusUnauthorized, "Token de autorização não fornecido")
				return
			}

			tokenStr := strings.TrimPrefix(authHeader, "Bearer ")
			claims, err := auth.ValidateToken(jwtSecret, tokenStr)
			if err != nil {
				ErrorResponse(w, http.StatusUnauthorized, "Token inválido ou expirado")
				return
			}

			// Se houver tenant no contexto da requisição, assegura que coincide
			if tenantVal := r.Context().Value(ContextKeyTenant); tenantVal != nil {
				tenant := tenantVal.(*database.Tenant)
				if claims.Role != database.RoleSuperAdmin && claims.TenantID != tenant.ID {
					ErrorResponse(w, http.StatusForbidden, "Acesso negado para este Tenant")
					return
				}
			}

			ctx := context.WithValue(r.Context(), ContextKeyClaims, claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// OptionalAuthMiddleware extrai o token JWT caso fornecido, sem bloquear se ausente.
func OptionalAuthMiddleware(jwtSecret string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")
			if authHeader != "" && strings.HasPrefix(authHeader, "Bearer ") {
				tokenStr := strings.TrimPrefix(authHeader, "Bearer ")
				if claims, err := auth.ValidateToken(jwtSecret, tokenStr); err == nil {
					ctx := context.WithValue(r.Context(), ContextKeyClaims, claims)
					r = r.WithContext(ctx)
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}

// RequireRoles restringe a rota para roles específicas.
func RequireRoles(allowedRoles ...string) func(http.Handler) http.Handler {
	roleMap := make(map[string]bool)
	for _, r := range allowedRoles {
		roleMap[r] = true
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claimsVal := r.Context().Value(ContextKeyClaims)
			if claimsVal == nil {
				ErrorResponse(w, http.StatusUnauthorized, "Não autenticado")
				return
			}

			claims := claimsVal.(*auth.JWTClaims)
			if claims.Role == database.RoleSuperAdmin || claims.Role == database.RoleLegacySuperAdmin || claims.Role == "SUPERADMIN" || claims.Role == "SUPER_ADMIN" || roleMap[claims.Role] {
				next.ServeHTTP(w, r)
				return
			}

			ErrorResponse(w, http.StatusForbidden, "Permissão insuficiente para esta ação")
		})
	}
}
