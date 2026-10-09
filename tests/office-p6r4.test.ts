import { describe, expect, it } from 'vitest';
import type { FillGradient, Graphics } from 'pixi.js';
import { drawOfficeActor } from '../desktop/renderer/pipeline/office/character-art';
import type { InteractionAction } from '../desktop/renderer/pipeline/office/leisure';
import type { AgentState } from '../desktop/renderer/pipeline/office/vendor/types/agent';

function recordActor(state: AgentState, frame: number, seated: boolean, facing: string, activity?: InteractionAction) {
  const calls: { method: string; args: unknown[] }[] = [];
  const graphic: Graphics = new Proxy({} as Graphics, {
    get: (_target, method: string) => (...args: unknown[]) => { calls.push({ method, args }); return graphic; },
  });
  drawOfficeActor(graphic, state, frame, 0x759cc4, seated, facing, 1, () => ({} as FillGradient), activity);
  return calls;
}

function arms(calls: ReturnType<typeof recordActor>) {
  const strokes: { points: unknown[][]; style: Record<string, unknown> }[] = [];
  let points: unknown[][] = [];
  for (const call of calls) {
    if (call.method === 'moveTo' || call.method === 'lineTo' || call.method === 'quadraticCurveTo') points.push(call.args);
    if (call.method === 'stroke') strokes.push({ points, style: call.args[0] as Record<string, unknown> });
    if (call.method === 'fill' || call.method === 'stroke' || call.method === 'clear') points = [];
  }
  return {
    sleeves: strokes.filter(stroke => [-7, 7].some(shoulder => stroke.points[0]?.[0] === shoulder && stroke.points[0]?.[1] === -23)),
    forearms: strokes.filter(stroke => stroke.style.color === 0xc79876),
    hands: calls.filter(call => call.method === 'circle' && Number(call.args[2]) >= 2.5 && Number(call.args[2]) <= 2.7).map(call => call.args.slice(0, 2)),
  };
}

describe('P6R4 articulated office arms', () => {
  it.each<InteractionAction>(['brew', 'present', 'wander', 'phone', 'coffee', 'read', 'exercise', 'listen'])('draws exactly two connected arms and hands for %s in every frame and facing', activity => {
    for (const frame of [0, 1, 2, 3]) for (const seated of [false, true]) for (const facing of ['front', 'back', 'left', 'right']) {
      const drawing = arms(recordActor('idle', frame, seated, facing, activity));
      expect(drawing.sleeves).toHaveLength(2);
      expect(drawing.forearms).toHaveLength(2);
      expect(drawing.hands).toHaveLength(2);
      for (const [index, sleeve] of drawing.sleeves.entries()) {
        expect(drawing.forearms[index].points[0]).toEqual(sleeve.points.at(-1));
        expect(drawing.forearms[index].points.at(-1)).toEqual(drawing.hands[index]);
      }
    }
  });
  it.each<AgentState>(['idle', 'walking', 'working', 'thinking'])('keeps %s arms connected without an interaction overlay', state => {
    for (const frame of [0, 1, 2, 3]) {
      const drawing = arms(recordActor(state, frame, true, 'front'));
      expect(drawing.sleeves).toHaveLength(2); expect(drawing.forearms).toHaveLength(2); expect(drawing.hands).toHaveLength(2);
      for (const [index, forearm] of drawing.forearms.entries()) {
        expect(forearm.points[0]).toEqual(drawing.sleeves[index].points.at(-1));
        expect(forearm.points.at(-1)).toEqual(drawing.hands[index]);
      }
    }
  });
  it('moves the original wrist with the reaching forearm and keeps the other hand stationary', () => {
    for (const activity of ['brew', 'present', 'wander', 'coffee'] as const) {
      const first = arms(recordActor('idle', 0, false, 'front', activity));
      const lifted = arms(recordActor('idle', activity === 'coffee' ? 2 : 1, false, 'front', activity));
      expect(first.hands[0]).toEqual(lifted.hands[0]);
      expect(first.hands[1]).not.toEqual(lifted.hands[1]);
      expect(lifted.forearms[1].points.at(-1)).toEqual(lifted.hands[1]);
      expect(lifted.hands[1]).not.toEqual([13, -4]);
    }
  });
  it('attaches the cup and both dumbbells to the animated wrist positions', () => {
    for (const frame of [0, 1, 2, 3]) {
      const coffee = recordActor('idle', frame, false, 'front', 'coffee'), coffeeHands = arms(coffee).hands;
      const cup = coffee.find(call => call.method === 'roundRect' && call.args[2] === 9 && call.args[3] === 8)!;
      expect(coffeeHands[1]).toEqual([Number(cup.args[0]) + 10, Number(cup.args[1]) + 3]);
      const exercise = recordActor('idle', frame, false, 'front', 'exercise'), exerciseHands = arms(exercise).hands;
      const weights = exercise.filter(call => call.method === 'roundRect' && call.args[2] === 3 && call.args[3] === 6);
      expect(weights).toHaveLength(4);
      for (const [index, hand] of exerciseHands.entries()) expect([Number(weights[index * 2].args[0]) + 6, Number(weights[index * 2].args[1]) + 3]).toEqual(hand);
    }
  });
});
