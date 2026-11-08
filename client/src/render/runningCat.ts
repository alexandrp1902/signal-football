import {Container, Rectangle, Sprite, Texture} from 'pixi.js';
import type {Vec} from '../sim/movement.ts';

export function gaitPose(phase: number, direction: Vec) {
  const length = Math.hypot(direction.x, direction.y) || 1;
  const dx = direction.x / length, dy = direction.y / length;
  const foot = (swing: number) => ({
    x: dx * swing * 4,
    y: -Math.max(0, swing) * 5 - dy * swing * 1.5,
    angle: -swing * (.28 + .22 * Math.abs(dx)),
    scaleY: 1 - dy * swing * .08,
  });
  const swing = Math.sin(phase);
  return {left: foot(swing), right: foot(-swing), bodyY: -swing * swing, bodyAngle: .018 * swing - .025 * dx};
}

/** Articulates the actual two paws from the existing mascot art, rather than swapping near-identical poses. */
export class RunningCat extends Container {
  readonly leftLeg: Sprite;
  readonly rightLeg: Sprite;
  readonly body: Sprite;
  private phase = 0;
  private bases: {x: number; y: number}[];
  private legScale: number[];

  constructor(idle: Texture) {
    super();
    const size = 68, frame = idle.frame, scale = size / frame.width;
    const crop = (left: number, top: number, right: number, bottom: number) => {
      const x = Math.floor(frame.x + frame.width * left), y = Math.floor(frame.y + frame.height * top);
      return new Texture({source: idle.source, frame: new Rectangle(x, y, Math.floor(frame.x + frame.width * right) - x, Math.floor(frame.y + frame.height * bottom) - y)});
    };
    const leg = (left: number, right: number) => {
      const sprite = new Sprite(crop(left, .77, right, .975));
      sprite.anchor.set(.5, 0); sprite.scale.set(scale);
      sprite.position.set(((left + right) / 2 - .5) * size, (.77 - .94) * size);
      return sprite;
    };
    this.leftLeg = leg(.28, .505);
    this.rightLeg = leg(.505, .75);
    this.body = new Sprite(crop(0, 0, 1, .82));
    this.body.scale.set(scale); this.body.position.set(-size / 2, -.94 * size);
    this.bases = [this.leftLeg.position.clone(), this.rightLeg.position.clone()];
    this.legScale = [this.leftLeg.scale.y, this.rightLeg.scale.y];
    this.addChild(this.leftLeg, this.rightLeg, this.body);
  }

  advance(distance: number, direction: Vec): void {
    // One full left/right stride per 2.1 metres. Standing and turning do not advance the gait.
    this.phase = (this.phase + Math.min(.5, Math.max(0, distance)) / 2.1 * Math.PI * 2) % (Math.PI * 2);
    const pose = gaitPose(this.phase, direction);
    [pose.left, pose.right].forEach((p, index) => {
      const sprite = index === 0 ? this.leftLeg : this.rightLeg, base = this.bases[index];
      sprite.position.set(base.x + p.x, base.y + p.y); sprite.rotation = p.angle;
      sprite.scale.y = this.legScale[index] * p.scaleY;
    });
    this.body.y = -.94 * 68 + pose.bodyY;
    this.body.rotation = pose.bodyAngle;
  }
}
