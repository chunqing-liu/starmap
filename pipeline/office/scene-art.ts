import { Container, Graphics, Rectangle } from 'pixi.js';
import type { Prop } from './vendor/runtime/model';
import type { PropView } from './vendor/scene/views/propViews';
import type { OfficeArtwork } from './artwork';

export function sceneObjectArtwork(art: OfficeArtwork, prop: Prop): PropView {
  const root = new Container(), graphic = new Graphics();
  root.addChild(graphic);
  art.shadow(graphic, 43, 2, 67, 10, .09);
  const kind = prop.templateId;
  if (kind === 'starmap.coffee') {
    graphic.roundRect(-25, -44, 116, 18, 4).fill(art.gradient(0xe5c9a7, 0xc5a585));
    graphic.roundRect(-22, -27, 108, 20, 3).fill(0xd9e2ed);
    graphic.roundRect(-18, -78, 97, 35, 5).fill(art.gradient(0x52677d, 0x283e54));
    for (const stationX of [0, 50]) {
      graphic.roundRect(stationX - 12, -73, 35, 20, 2).fill(0x1e3349);
      graphic.roundRect(stationX - 8, -69, 11, 7, 1).fill(0x8cc9c0);
      graphic.circle(stationX + 16, -65, 2).fill(0xc2d6e8);
      graphic.moveTo(stationX + 10, -56).lineTo(stationX + 10, -47).stroke({ color: 0xc0d0df, width: 3 });
      graphic.roundRect(stationX + 5, -46, 10, 7, 2).fill(0xffffff);
      graphic.ellipse(stationX + 10, -46, 5, 1.5).fill(0x866c53);
    }
    for (const stoolX of [48, 72]) { graphic.moveTo(stoolX, -2).lineTo(stoolX - 7, 12).moveTo(stoolX, -2).lineTo(stoolX + 7, 12).stroke({ color: 0x8b9eaf, width: 2 }); graphic.ellipse(stoolX, -6, 11, 5).fill(0x9cb3c9); }
  } else if (kind === 'starmap.exercise') {
    graphic.roundRect(-18, -8, 91, 28, 8).fill(art.gradient(0xb4cfcb, 0x8bb6b1));
    graphic.moveTo(-13, 0).lineTo(66, 0).stroke({ color: 0xdcf0e9, alpha: .6, width: 1 });
    graphic.moveTo(-19, -20).lineTo(-19, -64).lineTo(79, -64).lineTo(79, -20).stroke({ color: 0x8398ab, width: 3 });
    for (let tier = 0; tier < 2; tier++) for (let weight = 0; weight < 4; weight++) {
      const center = -7 + weight * 23, level = -60 + tier * 20;
      graphic.moveTo(center - 6, level).lineTo(center + 6, level).stroke({ color: 0xb5c2d0, width: 2 });
      graphic.roundRect(center - 9, level - 5, 5, 10, 2).fill(0x546b86); graphic.roundRect(center + 4, level - 5, 5, 10, 2).fill(0x546b86);
    }
    graphic.circle(87, -17, 9).fill(0xd8b7b0);
  } else if (kind === 'starmap.read') {
    graphic.roundRect(72, -95, 38, 70, 3).fill(art.gradient(0xd8bd99, 0xb69b7d));
    for (let shelf = 0; shelf < 3; shelf++) {
      graphic.rect(77, -88 + shelf * 22, 28, 19).fill(0x94806f);
      for (let book = 0; book < 5; book++) graphic.roundRect(79 + book * 5, -86 + shelf * 22 + book % 2 * 3, 4, 16 - book % 2 * 3, 1).fill([0x92b4c2, 0xb9cbb7, 0xdab681, 0xa9acd0, 0xeadccc][book]);
    }
    for (const chairX of [0, 50]) {
      graphic.roundRect(chairX - 19, -38, 38, 42, 10).fill(art.gradient(0xbed0e5, 0x90accb));
      graphic.roundRect(chairX - 14, -20, 28, 22, 6).fill(0xd5e0ed);
      graphic.roundRect(chairX - 23, -19, 8, 25, 4).fill(0xa1b9d1); graphic.roundRect(chairX + 15, -19, 8, 25, 4).fill(0xa1b9d1);
      graphic.moveTo(chairX - 15, 5).lineTo(chairX - 15, 12).moveTo(chairX + 15, 5).lineTo(chairX + 15, 12).stroke({ color: 0x8e9aab, width: 2 });
    }
    graphic.moveTo(-33, 1).lineTo(-33, -86).stroke({ color: 0x8ea2b7, width: 2 });
    graphic.ellipse(-33, 3, 12, 3).fill(0xa7b7c8); graphic.poly([-48, -74, -43, -94, -23, -94, -18, -74]).fill(0xffebc2);
  } else {
    graphic.roundRect(-24, -38, 148, 42, 10).fill(art.gradient(0xa9c7bd, 0x7aa99b));
    for (let cushion = 0; cushion < 3; cushion++) graphic.roundRect(-17 + cushion * 47, -22, 44, 26, 5).fill(0xc7ddd2);
    graphic.roundRect(-28, -23, 10, 29, 4).fill(0x92b8a9); graphic.roundRect(119, -23, 10, 29, 4).fill(0x92b8a9);
    graphic.moveTo(-18, 5).lineTo(-18, 12).moveTo(119, 5).lineTo(119, 12).stroke({ color: 0x869b9a, width: 3 });
    graphic.ellipse(50, 42, 40, 15).fill(art.gradient(0xfafcff, 0xdce5ed));
    graphic.moveTo(30, 48).lineTo(27, 61).moveTo(72, 48).lineTo(75, 61).stroke({ color: 0xa4b3c0, width: 3 });
    graphic.roundRect(32, 36, 22, 8, 1).fill(0x96b2c1); graphic.ellipse(65, 37, 6, 3).fill(0xffffff);
    art.plant(graphic, 149, 3, .8);
  }
  root.hitArea = new Rectangle(-48, -96, 208, 158);
  return { roots: [root], hitTarget: root, update(current) { root.position.set(current.position.x * 50 + 25, (current.position.y + 1) * 50 + 25); root.zIndex = root.y - 30; } };
}
