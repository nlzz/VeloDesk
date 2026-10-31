package auth

import (
	"testing"
)

func TestArgon2PasswordHashing(t *testing.T) {
	password := "SenhaSuperSegura@2026!"

	// Usa parâmetros leves para acelerar execução de testes unitários
	testParams := &Argon2Params{
		Memory:      16 * 1024,
		Iterations:  1,
		Parallelism: 2,
		SaltLength:  16,
		KeyLength:   32,
	}

	hash, err := HashPassword(password, testParams)
	if err != nil {
		t.Fatalf("Erro ao gerar hash da senha: %v", err)
	}

	if len(hash) == 0 {
		t.Fatal("Hash gerado está vazio")
	}

	// Validação com a senha correta
	match, err := VerifyPassword(password, hash)
	if err != nil {
		t.Fatalf("Erro inesperado na verificação da senha: %v", err)
	}
	if !match {
		t.Fatal("Senha correta falhou na verificação")
	}

	// Validação com senha incorreta
	wrongMatch, err := VerifyPassword("SenhaIncorreta", hash)
	if err != nil {
		t.Fatalf("Erro inesperado na verificação: %v", err)
	}
	if wrongMatch {
		t.Fatal("Senha incorreta foi validada como verdadeira")
	}
}
