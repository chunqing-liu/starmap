import type { Graphics } from 'pixi.js';
import type { AgentState } from './vendor/types/agent';

const standing = [
  '....hhhhhh....', '...hhhhhhhh...', '...hhsssshh...', '...ssessess...',
  '....ssssss....', '.....ssss.....', '...cccccccc...', '..cccccccccc..',
  '..ccwwwwwwcc..', '..ccwwwwwwcc..', '...cwwwwwwc...', '....pppppp....',
  '....pp..pp....', '....pp..pp....', '...bbb..bbb...',
];
const seated = [...standing.slice(0, 11), '...pppppppp...', '...pp....pp...', '..bbb....bbb..'];

export const PIXEL_FRAME_COUNTS = { idle: 1, seated: 1, walking: 4, working: 4, thinking: 4 } as const;

export function drawPixelActor(graphic: Graphics, state: AgentState, phase: number, color: number, atDesk: boolean) {
  const frame = Math.floor(phase) % 4;
  const palette: Record<string, number> = { h: 0x343948, s: 0xf0c9a1, e: 0x293342, c: color, w: 0xf1efdf, p: 0x46566b, b: 0x303a48 };
  const pixels = (atDesk && state !== 'walking' ? seated : standing).map(row => row.split(''));
  if (state === 'walking') {
    pixels[13] = (frame % 2 ? '...pp....pp...' : '....pp..pp....').split('');
    pixels[14] = (frame % 2 ? '..bbb....bbb..' : '...bbb..bbb...').split('');
  }
  if (state === 'working') {
    pixels[8] = (frame % 2 ? '..ccwwwssscc..' : '..ccssswwwcc..').split('');
    pixels[9] = '..ccwwwwwwcc..'.split('');
  }
  if (state === 'thinking') pixels[5] = '.....ssss..s..'.split('');
  graphic.clear();
  graphic.ellipse(0, 12, 16, 4).fill({ color: 0x344434, alpha: 0.14 });
  const shift = state === 'walking' && frame % 2 ? -2 : 0;
  for (let row = 0; row < pixels.length; row++) for (let column = 0; column < pixels[row].length; column++) {
    const ink = palette[pixels[row][column]];
    if (ink !== undefined) graphic.rect((column - 7) * 3, row * 3 - 33 + shift, 3, 3).fill(ink);
  }
  if (state === 'thinking') for (let dot = 0; dot < 3; dot++) graphic.rect(24 + dot * 5, -29 - dot * 3, 3, 3).fill({ color: 0x6e8080, alpha: dot <= frame ? 1 : 0.3 });
}

