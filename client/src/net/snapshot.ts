import {decode} from '@msgpack/msgpack';
import type {Player, Recipient, Snapshot, Phase, Ball} from './protocol.ts';
const int = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= 2_000_000_000;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 100000;
const id = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(v);
export function decodeSnapshot(bytes: Uint8Array): Snapshot {
  if (bytes.byteLength > 16384) throw new Error('Snapshot too large');
  const v = decode(bytes, {maxArrayLength: 64, maxMapLength: 64, maxStrLength: 256, maxBinLength: 16384});
  if (!Array.isArray(v) || v.length !== 13 || v[0] !== 3 || !id(v[1]) || !id(v[2]) || !id(v[3]) ||
    !int(v[4]) || !int(v[5]) || !['training', 'countdown', 'playing', 'goalPause', 'kickoff', 'finished'].includes(v[6]) || !Array.isArray(v[7]) || v[7].length > 6 ||
    !Array.isArray(v[10]) || v[10].length !== 2 || !v[10].every(int) || (v[11] !== null && (!num(v[11]) || v[11] < 0)) || !int(v[12])) throw new Error('Invalid snapshot header');
  const seen = new Set<string>();
  const players: Player[] = v[7].map((p: unknown) => {
    if (!Array.isArray(p) || p.length !== 28 || !id(p[0]) || seen.has(p[0]) || !['blue', 'red'].includes(p[1]) ||
      !p.slice(2, 8).every(num) || typeof p[8] !== 'boolean' || !int(p[9]) || !int(p[10]) || typeof p[11] !== 'boolean' ||
      !['idle', 'running', 'preparing', 'sliding', 'recovering', 'kicking', 'celebrating'].includes(p[12]) || !['', 'kick', 'tackle'].includes(p[13]) || !p.slice(14, 16).every(num) || !p.slice(16,22).every(int) || !p.slice(22,26).every(num) || !p.slice(26).every(int)) throw new Error('Invalid player');
    seen.add(p[0]);
    return {playerId: p[0], team: p[1], x: p[2], y: p[3], vx: p[4], vy: p[5], facingX: p[6], facingY: p[7], preparing: p[8], actionId: p[9], chargeStartTick: p[10], active: p[11],
      actionState: p[12], preparationMode: p[13], slideX: p[14], slideY: p[15], slideEndTick: p[16], recoverEndTick: p[17], cooldownEndTick: p[18], lastActionId: p[19], prepareVersion: p[20], animationEndTick: p[21],
      dribbleX: p[22], dribbleY: p[23], dribbleTargetX: p[24], dribbleTargetY: p[25], dribbleTurnStartTick: p[26], dribbleTurnEndTick: p[27]};
  });
  const r = v[8];
  if (!Array.isArray(r) || r.length !== 9 || !int(r[0]) || !r.slice(1, 5).every(num) || typeof r[5] !== 'boolean' || !int(r[6]) || !int(r[7]) || typeof r[8] !== 'boolean') throw new Error('Invalid recipient');
  const recipient: Recipient = {ackInputSeq: r[0], moveX: r[1], moveY: r[2], aimX: r[3], aimY: r[4], held: r[5], lastInputTick: r[6], barrier: r[7], needsResync: r[8]};
  const b = v[9];
  if (!Array.isArray(b) || b.length !== 11 || !b.slice(0, 4).every(num) || !['free', 'controlled', 'kicked'].includes(b[4]) ||
    (b[5] !== null && !id(b[5])) || !int(b[6]) || !int(b[7]) || (b[8] !== null && !id(b[8])) || !int(b[9]) || !int(b[10]) ||
    (b[4] === 'controlled') !== (b[5] !== null) || (b[5] !== null && !seen.has(b[5]))) throw new Error('Invalid ball');
  const ball: Ball = {x: b[0], y: b[1], vx: b[2], vy: b[3], state: b[4], ownerId: b[5], possessionVersion: b[6], captureBlockedUntilTick: b[7], ownerBlockedId: b[8], ownerBlockedUntilTick: b[9], impulseSeq: b[10]};
  return {protocolVersion: 3, roomId: v[1], matchId: v[2], connectionEpoch: v[3], snapshotSeq: v[4], serverTick: v[5], phase: v[6] as Phase, players, recipient, ball, score: v[10] as [number, number], remainingTime: v[11], phaseEndTick: v[12]};
}
