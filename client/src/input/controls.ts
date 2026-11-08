import {InputModel, stickLayout, stickVector} from './model.ts';
import type {Vec} from '../sim/movement.ts';
type Stick = {element: HTMLElement; knob: HTMLElement; id: number | null; centerX: number; centerY: number; max: number};
export class Controls {
  readonly model = new InputModel();
  enabled = false;
  private sticks: Stick[];
  private scene: HTMLElement;
  private aimAt: (x: number, y: number) => Vec;
  private onCancel: (suspend: boolean) => void;
  private mouse = {x: 0, y: 0, valid: false};
  private mouseHeld = false;
  constructor(scene: HTMLElement, aimAt: (x: number, y: number) => Vec, cancel: (suspend: boolean) => void) {
    this.scene = scene; this.aimAt = aimAt; this.onCancel = cancel;
    this.sticks = ['left-stick', 'right-stick'].map(id => {
      const element = document.getElementById(id)!;
      return {element, knob: element.querySelector<HTMLElement>('.knob')!, id: null, centerX: 0, centerY: 0, max: 1};
    });
    this.sticks.forEach((s, index) => {
      s.element.addEventListener('pointerdown', e => {
        if (!this.enabled || s.id !== null || e.pointerType === 'mouse' || this.mouseHeld) return;
        const rect = s.element.getBoundingClientRect();
        s.centerX = rect.x + rect.width / 2; s.centerY = rect.y + rect.height / 2;
        if (Math.hypot(e.clientX - s.centerX, e.clientY - s.centerY) > rect.width / 2) return;
        s.max = rect.width * .26; s.id = e.pointerId;
        s.element.setPointerCapture(e.pointerId); e.preventDefault();
        this.scene.classList.add('touch-controls');
        if (index === 0) this.model.touchMove = true; else this.model.beginGesture();
        this.stickPoint(s, index, e);
      });
      s.element.addEventListener('pointermove', e => {if (e.pointerId === s.id) this.stickPoint(s, index, e);});
      s.element.addEventListener('pointerup', e => {
        if (e.pointerId !== s.id) return;
        if (index === 1) {this.stickPoint(s, index, e); this.model.release();}
        this.releaseStick(s, index);
      });
      const cancelStick = (e: PointerEvent) => {
        if (e.pointerId !== s.id) return;
        if (index === 1) {this.model.cancel(); this.onCancel(false);}
        this.releaseStick(s, index);
      };
      s.element.addEventListener('pointercancel', cancelStick);
      s.element.addEventListener('lostpointercapture', cancelStick);
    });
    scene.addEventListener('pointermove', e => {
      if (e.pointerType !== 'mouse' || !this.enabled) return;
      this.mouse = {x: e.clientX, y: e.clientY, valid: true}; this.updateMouse();
    });
    scene.addEventListener('pointerdown', e => {
      if (!this.enabled || e.pointerType !== 'mouse' || e.button !== 0 || (e.target as Element).closest('button,input,label')) return;
      if (this.sticks.some(s => s.id !== null)) return;
      this.scene.classList.remove('touch-controls');
      this.mouseHeld = true; this.model.beginGesture();
      this.mouse = {x: e.clientX, y: e.clientY, valid: true}; this.updateMouse();
    });
    window.addEventListener('pointerup', e => {
      if (e.pointerType === 'mouse' && e.button === 0 && this.mouseHeld) {this.mouseHeld = false; this.model.release();}
    });
    window.addEventListener('keydown', e => {
      if (!this.enabled || (e.target as Element)?.closest('input,textarea,select,[contenteditable]')) return;
      const key = e.key.toLowerCase();
      if (key === 'escape') {this.model.cancel(); this.onCancel(false);}
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
        e.preventDefault(); this.model.keys.add(key);
        if (!this.sticks.some(s => s.id !== null)) this.scene.classList.remove('touch-controls');
      }
    });
    window.addEventListener('keyup', e => this.model.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.suspend());
    document.addEventListener('visibilitychange', () => {if (document.hidden) this.suspend();});
    document.addEventListener('focusin', e => {if ((e.target as Element)?.closest('input,textarea,select')) this.suspend();});
    window.visualViewport?.addEventListener('resize', () => {
      if (window.visualViewport!.height < window.innerHeight * .72) this.suspend();
    });
    const observer = new ResizeObserver(() => this.layout()); observer.observe(scene);
    this.layout();
    if (matchMedia('(pointer: coarse)').matches) scene.classList.add('touch-controls');
  }
  private layout(): void {
    const style = getComputedStyle(this.scene);
    const safe = parseFloat(style.getPropertyValue('--safe-left')) || 0;
    const safeRight = parseFloat(style.getPropertyValue('--safe-right')) || 0;
    const size = stickLayout(this.scene.clientWidth - safe - safeRight);
    for (const s of this.sticks) {
      if (s.id !== null) continue; // Keep geometry stable during a captured gesture.
      s.element.style.width = s.element.style.height = `${size.diameter}px`;
      s.knob.style.width = s.knob.style.height = `${size.knob}px`;
    }
  }
  private stickPoint(s: Stick, index: number, e: PointerEvent): void {
    const dx = e.clientX - s.centerX, dy = e.clientY - s.centerY;
    const k = Math.min(1, s.max / (Math.hypot(dx, dy) || 1));
    s.knob.style.transform = `translate(calc(-50% + ${dx * k}px), calc(-50% + ${dy * k}px))`;
    const v = stickVector(dx, dy, s.max);
    if (index === 0) this.model.left = v;
    else if (this.model.point(v, performance.now())) this.onCancel(false);
  }
  private releaseStick(s: Stick, index: number): void {
    const id = s.id; s.id = null;
    if (id !== null && s.element.hasPointerCapture(id)) s.element.releasePointerCapture(id);
    s.knob.style.transform = 'translate(-50%, -50%)';
    if (index === 0) {this.model.left = {x: 0, y: 0}; this.model.touchMove = false;}
    this.layout();
  }
  updateMouse(): void {
    if (this.enabled && this.mouse.valid && this.sticks[1].id === null)
      this.model.point(this.aimAt(this.mouse.x, this.mouse.y), performance.now());
  }
  suspend(): void {
    if (!this.enabled) return;
    this.reset();
    this.onCancel(true);
  }
  reset(): void {
    this.model.clear(); this.mouseHeld = false; this.mouse.valid = false;
    this.sticks.forEach((s, index) => this.releaseStick(s, index));
  }
}
