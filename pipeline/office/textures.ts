import { Graphics, Rectangle, type Renderer, type Texture } from 'pixi.js';
import { drawOfficeActor } from './character-art';
import { OfficeArtwork } from './artwork';
import type { AgentState } from './vendor/types/agent';
import type { InteractionAction } from './leisure';

export class OfficeTextures {
  private frames = new Map<string, Texture>();
  private artwork = new OfficeArtwork();
  constructor(private renderer: Renderer) {}
  get size() { return this.frames.size; }
  actor(state: AgentState, phase: number, color: number, seated: boolean, facing = 'front', variation = 0, activity?: InteractionAction) {
    const frame = activity || ['walking', 'working', 'thinking'].includes(state) ? Math.floor(phase) % 4 : 0;
    const key = [state, frame, color, seated, facing, variation % 12, activity].join(':');
    let texture = this.frames.get(key);
    if (!texture) {
      const graphic = new Graphics();
      drawOfficeActor(graphic, state, frame, color, seated, facing, variation, (top, bottom) => this.artwork.gradient(top, bottom), activity);
      texture = this.renderer.generateTexture({ target: graphic, frame: new Rectangle(-28, -44, 72, 64), resolution: 2 });
      texture.source.scaleMode = 'linear';
      graphic.destroy();
      this.frames.set(key, texture);
    }
    return texture;
  }
  dispose() { this.frames.forEach(texture => texture.destroy(true)); this.frames.clear(); this.artwork.dispose(); }
}
