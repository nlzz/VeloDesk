package signaling

import (
	"log"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = (pongWait * 9) / 10
	maxMessageSize = 512 * 1024 // 512 KB (amplo para grandes SDPs)
)

type ClientRole string

const (
	RoleUnknown ClientRole = "unknown"
	RoleAgent   ClientRole = "agent"
	RoleViewer  ClientRole = "viewer"
)

// Client representa uma conexão WebSocket ativa (Host ou Viewer)
type Client struct {
	Hub          *Hub
	Conn         *websocket.Conn
	Send         chan []byte
	ID           string
	Role         ClientRole
	Hostname     string
	Version      string
	PasswordHash string
	SessionID    string
	mu           sync.RWMutex
	closed       bool
}

func NewClient(hub *Hub, conn *websocket.Conn) *Client {
	return &Client{
		Hub:    hub,
		Conn:   conn,
		Send:   make(chan []byte, 256),
		Role:   RoleUnknown,
		closed: false,
	}
}

// ReadPump bombeia mensagens do WebSocket para o Hub
func (c *Client) ReadPump() {
	defer func() {
		c.Hub.UnregisterClient(c)
		c.Close()
	}()

	c.Conn.SetReadLimit(maxMessageSize)
	c.Conn.SetReadDeadline(time.Now().Add(pongWait))
	c.Conn.SetPongHandler(func(string) error {
		c.Conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		_, message, err := c.Conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("[Signaling] Erro de leitura WebSocket (%s): %v", c.ID, err)
			}
			break
		}

		c.Hub.HandleMessage(c, message)
	}
}

// WritePump bombeia mensagens do canal Send para o WebSocket
func (c *Client) WritePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.Close()
	}()

	for {
		select {
		case message, ok := <-c.Send:
			c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				// Canal fechado pelo Hub
				c.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			w, err := c.Conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			w.Write(message)

			// Despeja mensagens pendentes no mesmo frame se houver
			n := len(c.Send)
			for i := 0; i < n; i++ {
				w.Write([]byte{'\n'})
				w.Write(<-c.Send)
			}

			if err := w.Close(); err != nil {
				return
			}

		case <-ticker.C:
			c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// SendJSON serializa e enfileira uma mensagem JSON
func (c *Client) SendJSON(v interface{}) error {
	c.mu.RLock()
	defer c.mu.RUnlock()

	if c.closed {
		return nil
	}

	data, err := jsonMarshal(v)
	if err != nil {
		return err
	}

	select {
	case c.Send <- data:
	default:
		log.Printf("[Signaling] Buffer de envio cheio para cliente %s. Desconectando.", c.ID)
		go c.Close()
	}
	return nil
}

// Close fecha o canal de envio com segurança concorrente
func (c *Client) Close() {
	c.mu.Lock()
	defer c.mu.Unlock()

	if !c.closed {
		c.closed = true
		close(c.Send)
		c.Conn.Close()
	}
}
