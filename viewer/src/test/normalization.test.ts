import { describe, it, expect } from 'vitest';
import {
  calculateRenderedVideoRect,
  normalizeCoordinates,
} from '../protocol/normalization';

describe('Normalization Algorithm', () => {
  it('calculates rendered video rect without letterboxing when aspect ratios match', () => {
    // 16:9 viewport e 16:9 video
    const rect = calculateRenderedVideoRect(1920, 1080, 1920, 1080);
    expect(rect.renderedWidth).toBe(1920);
    expect(rect.renderedHeight).toBe(1080);
    expect(rect.offsetX).toBe(0);
    expect(rect.offsetY).toBe(0);
  });

  it('calculates pillarboxing (black bars on left/right) correctly', () => {
    // Viewport ultra-wide 2000x1000 (2:1), video 1000x1000 (1:1)
    const rect = calculateRenderedVideoRect(2000, 1000, 1000, 1000);
    expect(rect.renderedHeight).toBe(1000);
    expect(rect.renderedWidth).toBe(1000);
    expect(rect.offsetX).toBe(500); // (2000 - 1000) / 2
    expect(rect.offsetY).toBe(0);
  });

  it('calculates letterboxing (black bars on top/bottom) correctly', () => {
    // Viewport vertical 1000x2000 (1:2), video 1000x1000 (1:1)
    const rect = calculateRenderedVideoRect(1000, 2000, 1000, 1000);
    expect(rect.renderedWidth).toBe(1000);
    expect(rect.renderedHeight).toBe(1000);
    expect(rect.offsetX).toBe(0);
    expect(rect.offsetY).toBe(500); // (2000 - 1000) / 2
  });

  it('normalizes exact center to (0.5, 0.5)', () => {
    const viewport = {
      elementWidth: 800,
      elementHeight: 600,
      videoWidth: 1920,
      videoHeight: 1080,
      elementLeft: 100,
      elementTop: 50,
    };

    // Centro da tela: 100 + 400 = 500, 50 + 300 = 350
    const coords = normalizeCoordinates(500, 350, viewport);
    expect(coords.x).toBeCloseTo(0.5, 2);
    expect(coords.y).toBeCloseTo(0.5, 2);
    expect(coords.isInsideVideo).toBe(true);
  });

  it('clamps coordinates to [0.0, 1.0] when clicking in black letterbox borders', () => {
    const viewport = {
      elementWidth: 1000,
      elementHeight: 1000,
      videoWidth: 1920,
      videoHeight: 1080, // Video 16:9 dentro de quadrado -> barras pretas no topo e base
      elementLeft: 0,
      elementTop: 0,
    };

    // Clique bem no topo (y = 50, dentro da barra preta superior)
    const topBorder = normalizeCoordinates(500, 50, viewport);
    expect(topBorder.y).toBe(0.0);
    expect(topBorder.isInsideVideo).toBe(false);

    // Clique bem abaixo (y = 950, dentro da barra preta inferior)
    const bottomBorder = normalizeCoordinates(500, 950, viewport);
    expect(bottomBorder.y).toBe(1.0);
    expect(bottomBorder.isInsideVideo).toBe(false);

    // Clique bem à esquerda de pillarboxing
    const wideViewport = {
      elementWidth: 2000,
      elementHeight: 500,
      videoWidth: 500,
      videoHeight: 500, // 1:1 dentro de 4:1 -> barras nas laterais
      elementLeft: 0,
      elementTop: 0,
    };

    const leftBorder = normalizeCoordinates(10, 250, wideViewport);
    expect(leftBorder.x).toBe(0.0);
    expect(leftBorder.isInsideVideo).toBe(false);

    const rightBorder = normalizeCoordinates(1990, 250, wideViewport);
    expect(rightBorder.x).toBe(1.0);
    expect(rightBorder.isInsideVideo).toBe(false);
  });

  it('handles zero or uninitialized video dimensions gracefully', () => {
    const viewport = {
      elementWidth: 800,
      elementHeight: 600,
      videoWidth: 0,
      videoHeight: 0,
      elementLeft: 0,
      elementTop: 0,
    };

    const coords = normalizeCoordinates(400, 300, viewport);
    expect(coords.x).toBe(0.5);
    expect(coords.y).toBe(0.5);
  });
});
