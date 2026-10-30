/**
 * Protocolo de Input do WebRTC Data Channel `velodesk-input`.
 * 
 * Formato de mensagens compactadas enviadas sem ordenação (ordered: false, maxRetransmits: 0)
 * para atingir a menor latência possível na injeção de periféricos no host remoto.
 */

export type MouseButton = 0 | 1 | 2; // 0 = Esquerdo, 1 = Meio, 2 = Direito

export interface MouseMovePayload {
  t: 'mm';
  x: number;
  y: number;
}

export interface MouseDownPayload {
  t: 'md';
  b: MouseButton;
}

export interface MouseUpPayload {
  t: 'mu';
  b: MouseButton;
}

export interface KeyDownPayload {
  t: 'kd';
  c: string; // Scancode físico do navegador (ex: "KeyA", "Space", "Enter")
  v: number; // Virtual Key Code Windows correspondente (ex: 65 para 'A')
}

export interface KeyUpPayload {
  t: 'ku';
  c: string;
  v: number;
}

export interface MouseWheelPayload {
  t: 'wh';
  dx: number;
  dy: number;
}

export type InputMessage =
  | MouseMovePayload
  | MouseDownPayload
  | MouseUpPayload
  | KeyDownPayload
  | KeyUpPayload
  | MouseWheelPayload;

/**
 * Cria payload para movimento do mouse com coordenadas normalizadas.
 */
export function createMouseMoveMessage(x: number, y: number): MouseMovePayload {
  return {
    t: 'mm',
    x: Math.max(0, Math.min(1, Number(x.toFixed(4)))),
    y: Math.max(0, Math.min(1, Number(y.toFixed(4)))),
  };
}

/**
 * Cria payload para pressão de botão do mouse.
 */
export function createMouseDownMessage(button: number): MouseDownPayload {
  const b = normalizeMouseButton(button);
  return { t: 'md', b };
}

/**
 * Cria payload para liberação de botão do mouse.
 */
export function createMouseUpMessage(button: number): MouseUpPayload {
  const b = normalizeMouseButton(button);
  return { t: 'mu', b };
}

/**
 * Cria payload de rolagem da roda do mouse (Windows standard: múltiplos de 120).
 */
export function createMouseWheelMessage(deltaX: number, deltaY: number): MouseWheelPayload {
  // Ajuste padrão: normaliza delta do navegador para a escala WHEEL_DELTA (120) do Win32
  const dx = Math.round(deltaX === 0 ? 0 : deltaX > 0 ? 120 : -120);
  const dy = Math.round(deltaY === 0 ? 0 : deltaY > 0 ? -120 : 120); // No Win32, rolagem para cima é positivo
  return { t: 'wh', dx, dy };
}

/**
 * Converte botão HTMLMouseEvent (0: esq, 1: meio, 2: dir) para formato seguro.
 */
function normalizeMouseButton(button: number): MouseButton {
  if (button === 1) return 1;
  if (button === 2) return 2;
  return 0;
}

/**
 * Mapeamento de Scancode W3C para Virtual Key Code Windows (VK_*).
 */
const SCANCODE_TO_VK: Record<string, number> = {
  // Teclas Especiais e Navegação
  Backspace: 0x08,
  Tab: 0x09,
  Enter: 0x0d,
  ShiftLeft: 0x10,
  ShiftRight: 0x10,
  ControlLeft: 0x11,
  ControlRight: 0x11,
  AltLeft: 0x12,
  AltRight: 0x12,
  Pause: 0x13,
  CapsLock: 0x14,
  Escape: 0x1b,
  Space: 0x20,
  PageUp: 0x21,
  PageDown: 0x22,
  End: 0x23,
  Home: 0x24,
  ArrowLeft: 0x25,
  ArrowUp: 0x26,
  ArrowRight: 0x27,
  ArrowDown: 0x28,
  Insert: 0x2d,
  Delete: 0x2e,
  MetaLeft: 0x5b,  // Tecla Windows Esquerda
  MetaRight: 0x5c, // Tecla Windows Direita
  ContextMenu: 0x5d,

  // Números linha superior
  Digit0: 0x30,
  Digit1: 0x31,
  Digit2: 0x32,
  Digit3: 0x33,
  Digit4: 0x34,
  Digit5: 0x35,
  Digit6: 0x36,
  Digit7: 0x37,
  Digit8: 0x38,
  Digit9: 0x39,

  // Letras A-Z
  KeyA: 0x41,
  KeyB: 0x42,
  KeyC: 0x43,
  KeyD: 0x44,
  KeyE: 0x45,
  KeyF: 0x46,
  KeyG: 0x47,
  KeyH: 0x48,
  KeyI: 0x49,
  KeyJ: 0x4a,
  KeyK: 0x4b,
  KeyL: 0x4c,
  KeyM: 0x4d,
  KeyN: 0x4e,
  KeyO: 0x4f,
  KeyP: 0x50,
  KeyQ: 0x51,
  KeyR: 0x52,
  KeyS: 0x53,
  KeyT: 0x54,
  KeyU: 0x55,
  KeyV: 0x56,
  KeyW: 0x57,
  KeyX: 0x58,
  KeyY: 0x59,
  KeyZ: 0x5a,

  // Numpad
  Numpad0: 0x60,
  Numpad1: 0x61,
  Numpad2: 0x62,
  Numpad3: 0x63,
  Numpad4: 0x64,
  Numpad5: 0x65,
  Numpad6: 0x66,
  Numpad7: 0x67,
  Numpad8: 0x68,
  Numpad9: 0x69,
  NumpadMultiply: 0x6a,
  NumpadAdd: 0x6b,
  NumpadSubtract: 0x6d,
  NumpadDecimal: 0x6e,
  NumpadDivide: 0x6f,

  // Teclas de Função
  F1: 0x70,
  F2: 0x71,
  F3: 0x72,
  F4: 0x73,
  F5: 0x74,
  F6: 0x75,
  F7: 0x76,
  F8: 0x77,
  F9: 0x78,
  F10: 0x79,
  F11: 0x7a,
  F12: 0x7b,

  // Pontuação e Símbolos
  Semicolon: 0xba,
  Equal: 0xbb,
  Comma: 0xbc,
  Minus: 0xbd,
  Period: 0xbe,
  Slash: 0xbf,
  Backquote: 0xc0,
  BracketLeft: 0xdb,
  Backslash: 0xdc,
  BracketRight: 0xdd,
  Quote: 0xde,
};

/**
 * Obtém o código virtual do Windows a partir do evento de teclado nativo.
 */
export function getVirtualKeyCode(code: string, fallbackKeyCode?: number): number {
  if (SCANCODE_TO_VK[code]) {
    return SCANCODE_TO_VK[code];
  }
  return fallbackKeyCode || 0;
}

/**
 * Cria payload para evento KeyDown.
 */
export function createKeyDownMessage(code: string, keyCode?: number): KeyDownPayload {
  return {
    t: 'kd',
    c: code,
    v: getVirtualKeyCode(code, keyCode),
  };
}

/**
 * Cria payload para evento KeyUp.
 */
export function createKeyUpMessage(code: string, keyCode?: number): KeyUpPayload {
  return {
    t: 'ku',
    c: code,
    v: getVirtualKeyCode(code, keyCode),
  };
}

/**
 * Serializa a mensagem de input para formato JSON compactado.
 */
export function serializeInputMessage(message: InputMessage): string {
  return JSON.stringify(message);
}
