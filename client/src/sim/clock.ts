/** Render frames accumulate fixed global simulation steps, never variable dt movement. */
export class FixedClock {
  private accumulator = 0;
  reset(): void {this.accumulator = 0;}
  advance(seconds: number, step: () => void): boolean {
    if (seconds > .25) {this.reset(); return false;}
    this.accumulator += Math.max(0, seconds);
    let count = 0;
    while (this.accumulator >= 1 / 60 - 1e-10 && count < 15) {
      this.accumulator -= 1 / 60; count++; step();
    }
    return true;
  }
}
