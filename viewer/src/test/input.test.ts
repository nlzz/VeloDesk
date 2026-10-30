import { describe, it, expect } from 'vitest';
import {
  createMouseMoveMessage,
  createMouseDownMessage,
  createMouseUpMessage,
  createKeyDownMessage,
  createKeyUpMessage,
  createMouseWheelMessage,
  getVirtualKeyCode,
  serializeInputMessage,
} from '../protocol/input';

describe('Input Protocol Serialization', () => {
  it('serializes mouse move message correctly', () => {
    const msg = createMouseMoveMessage(0.45123, 0.89319);
    expect(msg).toEqual({ t: 'mm', x: 0.4512, y: 0.8932 });
    const json = serializeInputMessage(msg);
    expect(json).toBe('{"t":"mm","x":0.4512,"y":0.8932}');
  });

  it('clamps mouse move values strictly between 0 and 1', () => {
    const msg = createMouseMoveMessage(-0.5, 1.5);
    expect(msg).toEqual({ t: 'mm', x: 0, y: 1 });
  });

  it('serializes mouse down and up messages', () => {
    const md = createMouseDownMessage(0); // Left click
    expect(md).toEqual({ t: 'md', b: 0 });
    expect(serializeInputMessage(md)).toBe('{"t":"md","b":0}');

    const mu = createMouseUpMessage(2); // Right click
    expect(mu).toEqual({ t: 'mu', b: 2 });
    expect(serializeInputMessage(mu)).toBe('{"t":"mu","b":2}');

    const mm = createMouseDownMessage(1); // Middle click
    expect(mm).toEqual({ t: 'md', b: 1 });
  });

  it('serializes keyboard down and up messages with accurate virtual key codes', () => {
    const kd = createKeyDownMessage('KeyA');
    expect(kd).toEqual({ t: 'kd', c: 'KeyA', v: 65 });
    expect(serializeInputMessage(kd)).toBe('{"t":"kd","c":"KeyA","v":65}');

    const ku = createKeyUpMessage('Enter');
    expect(ku).toEqual({ t: 'ku', c: 'Enter', v: 13 });
    expect(serializeInputMessage(ku)).toBe('{"t":"ku","c":"Enter","v":13}');

    const space = createKeyDownMessage('Space');
    expect(space.v).toBe(32);

    const escape = createKeyDownMessage('Escape');
    expect(escape.v).toBe(27);
  });

  it('serializes mouse wheel messages in Windows WHEEL_DELTA scale', () => {
    const scrollUp = createMouseWheelMessage(0, -100);
    expect(scrollUp).toEqual({ t: 'wh', dx: 0, dy: 120 });
    expect(serializeInputMessage(scrollUp)).toBe('{"t":"wh","dx":0,"dy":120}');

    const scrollDown = createMouseWheelMessage(0, 100);
    expect(scrollDown).toEqual({ t: 'wh', dx: 0, dy: -120 });
    expect(serializeInputMessage(scrollDown)).toBe('{"t":"wh","dx":0,"dy":-120}');
  });

  it('resolves virtual key codes with fallback', () => {
    expect(getVirtualKeyCode('KeyZ')).toBe(0x5a);
    expect(getVirtualKeyCode('ArrowUp')).toBe(0x26);
    expect(getVirtualKeyCode('UnknownKey', 999)).toBe(999);
  });
});
