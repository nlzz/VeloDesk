package auth

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"fmt"
	"time"
)

// ICEServer representa a configuração de servidor ICE compatível com RTCPeerConnection no WebRTC
type ICEServer struct {
	URLs       []string `json:"urls"`
	Username   string   `json:"username,omitempty"`
	Credential string   `json:"credential,omitempty"`
}

// TURNCredentialsResponse armazena os servidores STUN/TURN e tempo de expiração
type TURNCredentialsResponse struct {
	ICEServers []ICEServer `json:"ice_servers"`
	TTL        int64       `json:"ttl"`
	ExpiresAt  int64       `json:"expires_at"`
}

// GenerateTURNCredentials gera credenciais efêmeras baseadas em HMAC-SHA1 (RFC 5766 / Coturn)
func GenerateTURNCredentials(secret, stunURL, turnURL, clientID string, ttl time.Duration) *TURNCredentialsResponse {
	expiresAt := time.Now().Add(ttl).Unix()
	username := fmt.Sprintf("%d:%s", expiresAt, clientID)

	mac := hmac.New(sha1.New, []byte(secret))
	mac.Write([]byte(username))
	credential := base64.StdEncoding.EncodeToString(mac.Sum(nil))

	iceServers := []ICEServer{
		{
			URLs: []string{stunURL},
		},
		{
			URLs: []string{
				fmt.Sprintf("%s?transport=udp", turnURL),
				fmt.Sprintf("%s?transport=tcp", turnURL),
			},
			Username:   username,
			Credential: credential,
		},
	}

	return &TURNCredentialsResponse{
		ICEServers: iceServers,
		TTL:        int64(ttl.Seconds()),
		ExpiresAt:  expiresAt,
	}
}

// ValidateTURNAuth valida se o username e a credencial calculada conferem com o secret
func ValidateTURNAuth(secret, username, credential string) bool {
	mac := hmac.New(sha1.New, []byte(secret))
	mac.Write([]byte(username))
	expectedCredential := base64.StdEncoding.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(expectedCredential), []byte(credential))
}
