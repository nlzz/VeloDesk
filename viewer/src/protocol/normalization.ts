/**
 * Módulo de Normalização de Coordenadas de Entrada do VeloDesk.
 * 
 * Garante que eventos de mouse gerados sobre o elemento de visualização <video>
 * sejam mapeados com precisão matemática para o espaço normalizado [0.0, 1.0],
 * compensando aspect ratio, letterboxing (barras pretas no topo/base) e
 * pillarboxing (barras pretas laterais) decorrentes de `object-fit: contain`.
 */

export interface VideoViewportDimensions {
  elementWidth: number;
  elementHeight: number;
  videoWidth: number;
  videoHeight: number;
  elementLeft: number;
  elementTop: number;
}

export interface RenderedVideoRect {
  renderedWidth: number;
  renderedHeight: number;
  offsetX: number;
  offsetY: number;
}

export interface NormalizedCoordinates {
  x: number;
  y: number;
  isInsideVideo: boolean;
}

/**
 * Calcula o retângulo real onde o vídeo está desenhado dentro do elemento <video>,
 * considerando `object-fit: contain`.
 */
export function calculateRenderedVideoRect(
  elementWidth: number,
  elementHeight: number,
  videoWidth: number,
  videoHeight: number
): RenderedVideoRect {
  // Se as dimensões nativas do vídeo forem desconhecidas, assume preenchimento total
  if (videoWidth <= 0 || videoHeight <= 0 || elementWidth <= 0 || elementHeight <= 0) {
    return {
      renderedWidth: Math.max(1, elementWidth),
      renderedHeight: Math.max(1, elementHeight),
      offsetX: 0,
      offsetY: 0,
    };
  }

  const videoRatio = videoWidth / videoHeight;
  const elementRatio = elementWidth / elementHeight;

  let renderedWidth: number;
  let renderedHeight: number;
  let offsetX: number;
  let offsetY: number;

  if (elementRatio > videoRatio) {
    // Pillarboxing: elemento é mais largo que o vídeo -> barras pretas nas laterais
    renderedHeight = elementHeight;
    renderedWidth = elementHeight * videoRatio;
    offsetX = (elementWidth - renderedWidth) / 2;
    offsetY = 0;
  } else {
    // Letterboxing: elemento é mais alto que o vídeo -> barras pretas no topo/base
    renderedWidth = elementWidth;
    renderedHeight = elementWidth / videoRatio;
    offsetX = 0;
    offsetY = (elementHeight - renderedHeight) / 2;
  }

  return {
    renderedWidth,
    renderedHeight,
    offsetX,
    offsetY,
  };
}

/**
 * Converte coordenadas de tela (clientX, clientY) em coordenadas normalizadas (0.0 a 1.0).
 */
export function normalizeCoordinates(
  clientX: number,
  clientY: number,
  viewport: VideoViewportDimensions
): NormalizedCoordinates {
  const { renderedWidth, renderedHeight, offsetX, offsetY } = calculateRenderedVideoRect(
    viewport.elementWidth,
    viewport.elementHeight,
    viewport.videoWidth,
    viewport.videoHeight
  );

  const localX = clientX - viewport.elementLeft - offsetX;
  const localY = clientY - viewport.elementTop - offsetY;

  const isInsideVideo =
    localX >= 0 && localX <= renderedWidth && localY >= 0 && localY <= renderedHeight;

  // Normalização e clamping estrito [0.0, 1.0]
  const unscaledX = renderedWidth > 0 ? localX / renderedWidth : 0;
  const unscaledY = renderedHeight > 0 ? localY / renderedHeight : 0;

  const clampedX = Math.max(0.0, Math.min(1.0, unscaledX));
  const clampedY = Math.max(0.0, Math.min(1.0, unscaledY));

  // 4 casas decimais são suficientes para precisão subpixel até 4K (3840 * 0.0001 = 0.38px)
  const x = Number(clampedX.toFixed(4));
  const y = Number(clampedY.toFixed(4));

  return { x, y, isInsideVideo };
}
