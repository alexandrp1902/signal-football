import {readFileSync} from 'node:fs';
import {afterEach, expect, it, vi} from 'vitest';
import {encode,decode} from '@msgpack/msgpack';
import balance from '../../../shared/football.json';
import expected from '../../../shared/test-vectors/snapshot.json';
import timeline from '../../../shared/test-vectors/input-timeline.json';
import {decodeSnapshot} from './snapshot.ts';
import {normalizeServerUrl, resolveServerUrl} from './serverUrl.ts';
import {Prediction} from './prediction.ts';
import {Interpolation} from './interpolation.ts';
import type {Snapshot} from './protocol.ts';
const fixture = () => decodeSnapshot(readFileSync(new URL('../../../shared/test-vectors/snapshot.msgpack', import.meta.url)));
it('decodes the binary produced by the actual C# encoder', () => expect(fixture()).toEqual(expected));
it('rejects truncated/oversized/incompatible/nonfinite/duplicate-player snapshots', () => {
  const bytes = readFileSync(new URL('../../../shared/test-vectors/snapshot.msgpack', import.meta.url));
  expect(() => decodeSnapshot(bytes.subarray(0, 20))).toThrow(); expect(() => decodeSnapshot(new Uint8Array(17000))).toThrow();
  expect(() => decodeSnapshot(encode([999]))).toThrow();
  const array=decode(bytes) as unknown[];const player=(array[7] as unknown[][])[0];array[7]=[player,player];
  expect(() => decodeSnapshot(encode(array))).toThrow();
  const invalid=decode(bytes) as unknown[];(invalid[7] as unknown[][])[0][2]=NaN;expect(() => decodeSnapshot(encode(invalid))).toThrow();
});
it('replay removes expired tick even when its sequence is above ack', () => {
  const p = new Prediction(balance); const s = fixture(); s.players[0].y = 0;
  for (const row of timeline.slice(0, 3)) for (const f of row.frames) p.push(f);
  p.reconcile(s, 'player-fixture');
  expect(p.history.map(f => f.inputSeq)).toEqual([3]); expect(p.state.x).toBeCloseTo(.28, 10);
});
it('reconciliation preserves an in-progress carry turn and replays its remaining pause',()=>{
  const prediction=new Prediction(balance),s=fixture(),p=s.players[0];s.ball.ownerId=p.playerId;s.ball.state='controlled';
  Object.assign(p,{x:0,y:0,vx:0,vy:0,dribbleX:1,dribbleY:0,dribbleTargetX:-1,dribbleTargetY:0,dribbleTurnStartTick:101,dribbleTurnEndTick:122});
  Object.assign(s.recipient,{moveX:-1,moveY:0,lastInputTick:101});prediction.reconcile(s,p.playerId,true);
  for(let tick=102;tick<=113;tick++)prediction.push({inputSeq:tick,targetTick:tick,moveX:-1,moveY:0,aimX:0,aimY:1,actionHeld:false,transitions:[]});
  expect(prediction.state.x).toBe(0);expect(prediction.dribble.x).toBeCloseTo(Math.cos(Math.PI/9),9);
  const checkpoint=structuredClone(s);checkpoint.serverTick=113;checkpoint.recipient.ackInputSeq=113;checkpoint.recipient.lastInputTick=113;
  Object.assign(checkpoint.players[0],{dribbleX:prediction.dribble.x,dribbleY:prediction.dribble.y});
  for(let tick=114;tick<=130;tick++)prediction.push({inputSeq:tick,targetTick:tick,moveX:-1,moveY:0,aimX:0,aimY:1,actionHeld:false,transitions:[]});
  const before={...prediction.state},carry={...prediction.dribble};prediction.reconcile(checkpoint,p.playerId);
  expect(prediction.state.x).toBeCloseTo(before.x,9);expect(prediction.dribble).toEqual(carry);expect(prediction.state.vx).toBeLessThan(0);
});
it('prediction history is bounded and stop clears it', () => {
  const p = new Prediction(balance);
  for (let i = 1; i <= 240; i++) expect(p.push({inputSeq: i, targetTick: i, moveX: 0, moveY: 0, aimX: 0, aimY: 1, actionHeld: false, transitions: []})).toBe(true);
  expect(p.push({inputSeq: 241, targetTick: 241, moveX: 0, moveY: 0, aimX: 0, aimY: 1, actionHeld: false, transitions: []})).toBe(false);
  p.stop(); expect(p.history).toHaveLength(0);
});
it('interpolation recovers from skipped snapshots and limits extrapolation to 100ms', () => {
  const buffer = new Interpolation();
  const s = fixture(); s.serverTick = 0; s.snapshotSeq = 1; s.players[0].x = 0; s.players[0].vx = 6;
  buffer.push(s, 0);
  const later = structuredClone(s); later.serverTick = 6; later.snapshotSeq = 3; later.players[0].x = .6;
  buffer.push(later, 100);
  const sampled = buffer.sample(1000)[0]; expect(sampled.x).toBeCloseTo(1.2, 10);
  expect(buffer.sample(2000)[0].x).toBeCloseTo(1.2, 10);
  for (let i = 4; i <= 100; i++) buffer.push({...later, snapshotSeq: i, serverTick: i}, i * 1000 / 60);
  expect(buffer.frames).toHaveLength(60); expect(buffer.delay).toBeGreaterThanOrEqual(75); expect(buffer.delay).toBeLessThanOrEqual(150);
});
it('validates every server URL including stored preferences and mixed content', () => {
  expect(normalizeServerUrl('http://localhost:5101')).toBe('ws://localhost:5101/ws');
  expect(normalizeServerUrl('https://example.test', 'https:')).toBe('wss://example.test/ws');
  for (const bad of ['javascript:alert(1)', 'file:///tmp/a', 'http://user:pass@example.test', 'ws://example.test?token=1']) expect(() => normalizeServerUrl(bad)).toThrow();
  expect(() => normalizeServerUrl('ws://localhost:5101', 'https:')).toThrow();
});

afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
it('Pages connects to the deployed game server and keeps explicit server overrides',()=>{
  vi.stubGlobal('location',{search:'',protocol:'https:',origin:'https://alexandrp1902.github.io'});
  const storage=new Map<string,string>();
  vi.stubGlobal('localStorage',{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value)});
  vi.stubEnv('VITE_GAME_SERVER_URL','https://game.example.test');
  expect(resolveServerUrl()).toBe('wss://game.example.test/ws');
  storage.set('catsFootball.server','https://saved.example.test');
  expect(resolveServerUrl()).toBe('wss://saved.example.test/ws');
  location.search='?server=https://override.example.test';
  expect(resolveServerUrl()).toBe('wss://override.example.test/ws');
  expect(storage.get('catsFootball.server')).toBe('wss://override.example.test/ws');
});
it('local development continues to use its own origin without a deployed default',()=>{
  vi.stubGlobal('location',{search:'',protocol:'http:',origin:'http://localhost:5174'});
  vi.stubGlobal('localStorage',{getItem:()=>null});vi.stubEnv('VITE_GAME_SERVER_URL','');
  expect(resolveServerUrl()).toBe('ws://localhost:5174/ws');
});
