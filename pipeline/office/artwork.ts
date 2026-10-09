import { Container, FillGradient, Graphics, Rectangle, Text } from 'pixi.js';
import type { Prop } from './vendor/runtime/model';
import type { PropView } from './vendor/scene/views/propViews';
import { propPixels } from './vendor/scene/gridProjection';
import { computeChairLayerZ, computeDeskLayerZ } from './vendor/scene/systems/deskDepthSort';
import type { OfficeRole } from './roles';

export class OfficeArtwork {
  private gradients = new Map<string, FillGradient>();
  gradient(top: number, bottom: number, horizontal = false) {
    const key = [top, bottom, horizontal].join(':');
    let fill = this.gradients.get(key);
    if (!fill) {
      fill = new FillGradient({ start: { x: 0, y: 0 }, end: { x: horizontal ? 1 : 0, y: horizontal ? 0 : 1 }, colorStops: [{ offset: 0, color: top }, { offset: 1, color: bottom }] });
      this.gradients.set(key, fill);
    }
    return fill;
  }
  shadow(graphic: Graphics, centerX: number, centerY: number, radiusX: number, radiusY: number, strength = .13) {
    for (let ring = 5; ring > 0; ring--) graphic.ellipse(centerX, centerY, radiusX * (1 + ring * .06), radiusY * (1 + ring * .09)).fill({ color: 0x344b68, alpha: strength / 5 });
  }
  plant(graphic: Graphics, centerX: number, centerY: number, size = 1) {
    this.shadow(graphic, centerX + 3, centerY + 4, 16 * size, 5 * size, .08);
    graphic.roundRect(centerX - 10 * size, centerY - 18 * size, 20 * size, 21 * size, 4 * size).fill(this.gradient(0xfafcff, 0xd6e1ee));
    graphic.ellipse(centerX, centerY - 18 * size, 10 * size, 3 * size).fill(0x7c988d);
    for (let leaf = 0; leaf < 5; leaf++) {
      const direction = leaf % 2 ? 1 : -1;
      const tipX = centerX + direction * (10 + leaf * 2) * size, tipY = centerY - (28 + leaf * 7) * size;
      graphic.moveTo(centerX, centerY - 18 * size).quadraticCurveTo(centerX, tipY + 10 * size, tipX, tipY).stroke({ color: 0x659f8d, width: 1.4 * size });
      graphic.ellipse(tipX, tipY, 7 * size, 10 * size).fill(this.gradient(0x90caba, 0x5fa58e));
    }
  }
  room(width: number, height: number, count: number) {
    const root = new Container(), graphic = new Graphics();
    root.addChild(graphic);
    this.shadow(graphic, width / 2, height - 13, width * .43, 12, .06);
    graphic.roundRect(18, 18, width - 36, height - 43, 16).fill(this.gradient(0xffffff, 0xeaf0f7));
    graphic.roundRect(26, 104, width - 52, height - 137, 9).fill(this.gradient(0xf6f8fc, 0xe8eef6));
    graphic.roundRect(18, 18, width - 36, 96, 12).fill(this.gradient(0xfcfdff, 0xe4edf7));
    graphic.rect(26, 110, width - 52, 4).fill(0xd7e2ef);
    const windowWidth = Math.max(110, width - 270);
    graphic.roundRect(52, 42, windowWidth, 53, 7).fill(this.gradient(0xd2e9f9, 0xf4faff));
    graphic.moveTo(52 + windowWidth * .4, 42).lineTo(52 + windowWidth * .4, 95).moveTo(52 + windowWidth * .7, 42).lineTo(52 + windowWidth * .7, 95).stroke({ color: 0xffffff, width: 4 });
    graphic.poly([53, 44, 90, 44, 68, 94, 53, 94]).fill({ color: 0xffffff, alpha: .35 });
    graphic.moveTo(31, 118).lineTo(31, height - 40).stroke({ color: 0xffffff, width: 3 });
    graphic.moveTo(width - 31, 118).lineTo(width - 31, height - 40).stroke({ color: 0xdce5ef, width: 2 });
    const loungeY = height - 106;
    graphic.roundRect(56, loungeY, Math.max(180, width - 112), 66, 18).fill({ color: 0xe1e9f5, alpha: .7 });
    this.plant(graphic, width - 52, 108, .65);
    const title = new Text({ text: count ? 'STUDIO  /  ' + String(count).padStart(2, '0') : 'STUDIO  /  等待伙伴上线', style: { fontFamily: 'system-ui, sans-serif', fontSize: 10, letterSpacing: 2, fill: 0x58728c } });
    title.position.set(52, 26); root.addChild(title);
    return root;
  }
  screen(graphic: Graphics, centerX: number, centerY: number, width: number, height: number, role: OfficeRole, powered = false) {
    graphic.roundRect(centerX - 9, centerY + height / 2 + 2, 18, 3, 1.5).fill(0xa3b3c9);
    graphic.rect(centerX - 1.5, centerY + height / 2 - 3, 3, 7).fill(0xc0ccdc);
    graphic.roundRect(centerX - width / 2, centerY - height / 2, width, height, 4).fill(this.gradient(0x8396af, 0x51647e));
    graphic.roundRect(centerX - width / 2 + 2, centerY - height / 2 + 2, width - 4, height - 5, 2).fill(powered ? this.gradient(0x244469, 0x3f638b) : this.gradient(0x26374c, 0x35485e));
    if (!powered) { graphic.moveTo(centerX - width / 2 + 5, centerY - height / 2 + 4).lineTo(centerX - width / 2 + 15, centerY + height / 2 - 7).stroke({ color: 0xffffff, alpha: .04, width: 5 }); return; }
    const left = centerX - width / 2 + 6, top = centerY - height / 2 + 7;
    if (role === 'engine' || role === 'frontend' || role === 'product') {
      graphic.roundRect(left, top, width - 12, height - 14, 2).fill(0xe5f3fb);
      graphic.rect(left + 3, top + 3, width - 18, 3).fill(0x8eb3de);
      graphic.roundRect(left + 3, top + 10, (width - 18) * .55, Math.max(3, height - 27), 2).fill(0xaccddd);
      graphic.rect(left + width * .55, top + 10, Math.max(2, width * .22), 2).fill(0x6d95ba);
      graphic.rect(left + width * .55, top + 15, Math.max(2, width * .18), 2).fill(0x9ebcce);
    } else {
      for (let row = 0; row < 5; row++) graphic.roundRect(left + row % 2 * 3, top + row * 4, Math.max(3, (width - 17) * (.3 + row % 3 * .19)), 1.5, .5).fill(row % 2 ? 0xc4ddfb : 0x8dcfc6);
    }
    graphic.circle(centerX + width / 2 - 5, centerY + height / 2 - 2, .7).fill(0xbcefdc);
  }
  whiteboard(prop: Prop): PropView {
    const root = new Container(), graphic = new Graphics();
    graphic.roundRect(-61, -67, 122, 55, 5).fill(this.gradient(0xd6e2ef, 0xbacbdc));
    graphic.roundRect(-58, -64, 116, 49, 3).fill(0xfcfdff);
    graphic.moveTo(-46, -12).lineTo(-52, 20).lineTo(-61, 20).moveTo(46, -12).lineTo(52, 20).lineTo(61, 20).stroke({ color: 0x99afc2, width: 3 });
    for (let note = 0; note < 3; note++) {
      graphic.roundRect(-49 + note * 32, -45, 24, 21, 3).fill([0xd6e5fb, 0xd3ece5, 0xe6dff5][note]);
      graphic.moveTo(-45 + note * 32, -38).lineTo(-31 + note * 32, -38).moveTo(-45 + note * 32, -33).lineTo(-36 + note * 32, -33).stroke({ color: 0x829bb7, width: 1 });
    }
    const label = new Text({ text: 'TEAM NOTES', style: { fontFamily: 'system-ui', fontSize: 7, letterSpacing: 1, fill: 0x58708d } });
    label.position.set(-48, -57); root.addChild(graphic, label);
    return { roots: [root], hitTarget: root, update(current) { const pixel = propPixels(current); root.position.set(pixel.x, pixel.y + 30); root.zIndex = pixel.y - 100; } };
  }
  dispose() { this.gradients.forEach(gradient => gradient.destroy()); this.gradients.clear(); }
  workstation(prop: Prop): PropView {
    const shadow = new Graphics(), desk = new Graphics(), chair = new Graphics();
    const role = String(prop.state.role || 'general') as OfficeRole;
    this.shadow(shadow, 6, 63, 71, 11, .09);
    desk.moveTo(-55, 13).lineTo(-55, 60).moveTo(57, 13).lineTo(57, 60).stroke({ color: 0xa1b3c9, width: 4 });
    desk.moveTo(-60, 60).lineTo(-48, 60).moveTo(51, 60).lineTo(63, 60).stroke({ color: 0x8a9fb8, width: 3 });
    desk.roundRect(40, 26, 19, 28, 3).fill(this.gradient(0xe4ebf5, 0xc5d2e3));
    desk.moveTo(44, 38).lineTo(55, 38).stroke({ color: 0xa2b2c9, width: 1 });
    desk.poly([-72, -15, 62, -15, 75, 19, -59, 19]).fill(this.gradient(0xffffff, 0xe6edf7));
    desk.poly([-59, 19, 75, 19, 75, 24, -59, 24]).fill(this.gradient(0xcbd8ea, 0xb7c8df));
    desk.moveTo(-71, -14).lineTo(61, -14).lineTo(74, 18).stroke({ color: 0xffffff, width: 1 });
    desk.poly([-42, -7, 30, -7, 38, 14, -34, 14]).fill(0xd3dfee);
    this.screen(desk, -10, -34, 65, 40, role);
    if (role === 'engine' || role === 'frontend') this.screen(desk, 40, -29, 31, 32, role === 'engine' ? 'backend' : 'frontend');
    desk.poly([-24, 3, 17, 3, 21, 13, -20, 13]).fill(0xfafcff);
    for (let row = 0; row < 3; row++) for (let key = 0; key < 10; key++) desk.roundRect(-20 + key * 3.6 + row * 1.3, 4 + row * 2.4, 2.6, 1.5, .4).fill(0xa6b8ce);
    desk.ellipse(34, 9, 4, 5).fill(0xffffff);
    desk.roundRect(-59, -4, 10, 12, 2).fill(0xeaf0f8);
    desk.ellipse(-54, -4, 5, 2).fill(0x9a7f69);
    desk.ellipse(-47, 1, 2.5, 2.5).stroke({ color: 0xbdccdf, width: 1.6 });
    if (role === 'backend' || role === 'engine') {
      desk.roundRect(-67, -14, 10, 23, 2).fill(this.gradient(0xa1b5cd, 0x6b83a2));
      for (let vent = 0; vent < 3; vent++) desk.moveTo(-65, -9 + vent * 4).lineTo(-59, -9 + vent * 4).stroke({ color: 0xd6e2f2, width: .7 });
    }
    this.shadow(chair, 2, 72, 18, 4, .08);
    chair.moveTo(0, 52).lineTo(0, 69).moveTo(0, 69).lineTo(-17, 73).moveTo(0, 69).lineTo(17, 73).moveTo(0, 69).lineTo(3, 77).stroke({ color: 0x839ab7, width: 2.5 });
    for (const [wheelX, wheelY] of [[-17, 73], [17, 73], [3, 77]]) chair.roundRect(wheelX - 2.5, wheelY - 1, 5, 3, 1).fill(0x647d9b);
    chair.roundRect(-20, 36, 40, 12, 6).fill(this.gradient(0xa1b7db, 0x7896c2));
    chair.roundRect(-16, 28, 32, 16, 7).fill(this.gradient(0xb8cbed, 0x90aad2));
    return { roots: [shadow, desk, chair], hitTarget: desk, update(current, _template, agents) {
      const pixel = propPixels(current), station = { id: current.id, ...pixel, seatX: pixel.x, seatY: pixel.y + 45 };
      shadow.position.set(pixel.x, pixel.y); shadow.zIndex = pixel.y - 110;
      desk.position.set(pixel.x, pixel.y); desk.zIndex = computeDeskLayerZ(station, agents);
      chair.position.set(pixel.x, pixel.y); chair.zIndex = computeChairLayerZ(station, agents);
      desk.hitArea = new Rectangle(-75, -59, 150, 125);
    } };
  }
}
