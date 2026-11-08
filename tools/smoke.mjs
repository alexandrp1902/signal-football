import assert from 'node:assert/strict';
import {decodeSnapshot} from '../client/src/net/snapshot.ts';

const serverIndex = process.argv.indexOf('--server');
const server = serverIndex < 0 ? 'ws://localhost:5101/ws' : process.argv[serverIndex + 1];
if (!server) throw new Error('--server requires a WebSocket URL');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
class Peer {
  messages = []; snapshots = []; seq = 0; target = 0; interval = null;
  constructor(name, create, code = '', version = 3) {
    this.ws = new WebSocket(server); this.ws.binaryType = 'arraybuffer';
    this.ws.onopen = () => this.send({type: 'hello', protocolVersion: version, name, create, code}, false);
    this.ws.onmessage = e => {
      if (typeof e.data === 'string') {
        const m = JSON.parse(e.data); this.messages.push(m);
        if (m.type === 'welcome') {this.welcome=m;this.seq=0;this.anchorTime=null;this.held=false;this.transitions=[];}
        if (m.type === 'pong') {this.anchorTime = performance.now(); this.anchorTick = m.serverTick + (performance.now() - m.clientTime) * .03;}
      } else this.snapshots.push(decodeSnapshot(new Uint8Array(e.data)));
      if (this.snapshots.length > 180) this.snapshots.shift();
    };
    this.ws.onerror = e => {if (!this.expectedClose && !this.messages.some(m => m.type === 'error')) this.failure = new Error(`WebSocket error: ${e.message || server}`);};
  }
  send(m, identified = true) {
    if (identified && this.welcome) m = {...m, roomId: this.welcome.roomId, matchId: this.welcome.matchId, connectionEpoch: this.welcome.connectionEpoch};
    this.ws.send(JSON.stringify(m));
  }
  async until(predicate, description, timeout = 7000) {
    const end = performance.now() + timeout;
    while (performance.now() < end) {if (this.failure) throw this.failure; const value = predicate(); if (value) return value; await delay(10);}
    throw new Error(`Timeout: ${description}; ${JSON.stringify(this.messages.slice(-3))}`);
  }
  async ready() {await this.until(() => this.welcome, 'welcome'); await this.until(() => this.snapshots.at(-1), 'snapshot'); return this;}
  async move(x, y) {
    this.moveX = x; this.moveY = y;
    this.send({type: 'ping', id: 1, clientTime: performance.now()});
    await this.until(() => this.anchorTime, 'pong');
    this.target = Math.floor(this.anchorTick + (performance.now() - this.anchorTime) * .06) + 4;
    let next = performance.now(); const frames = [];
    this.interval = setInterval(() => {
      while (performance.now() >= next) {
        frames.push({inputSeq: ++this.seq, targetTick: this.target++, moveX: this.moveX, moveY: this.moveY, aimX: this.aimX??0, aimY: this.aimY??1, actionHeld: this.held??false, transitions: (this.transitions??[]).splice(0)});
        next += 1000 / 60;
        if (frames.length === 2) {this.send({type: 'inputBatch', frames: frames.splice(0)});}
      }
    }, 4);
  }
  stop() {clearInterval(this.interval);}
  close() {this.expectedClose = true; this.stop(); this.ws.close();}
}

const peers = [];
try {
  const a = new Peer('Котик', true); peers.push(a); await a.ready();
  const roster = await a.until(() => a.messages.find(m => m.type === 'roomState'), 'roomState');
  assert.match(roster.code,/^[0-9]{4}$/);
  const b = new Peer('Котик', false, roster.code); peers.push(b); await b.ready();
  assert.notEqual(a.welcome.playerId, b.welcome.playerId); assert.equal(a.welcome.team, 'blue'); assert.equal(b.welcome.team, 'red');
  assert.deepEqual(a.welcome.balance, b.welcome.balance); assert.equal(a.welcome.balanceHash, b.welcome.balanceHash);
  assert.equal(a.welcome.balanceHash.length, 64);
  const both = await a.until(() => a.messages.findLast(m => m.type === 'roomState' && m.players.length === 2), 'two-player roster');
  assert.notEqual(both.players[0].name, both.players[1].name);
  const third = new Peer('Третий', false, roster.code); peers.push(third);
  await third.until(() => third.messages.find(m => m.code === 'roomFull'), 'third-player rejection'); third.close();
  const incompatible = new Peer('Old', true, '', 999); peers.push(incompatible);
  await incompatible.until(() => incompatible.messages.find(m => m.code === 'protocolMismatch'), 'version rejection'); incompatible.close();
  await Promise.all([a.move(1, 0), b.move(-1, 0)]);
  await a.until(() => a.snapshots.at(-1)?.players.find(p => p.playerId === a.welcome.playerId)?.x > 3, 'blue moves');
  await b.until(() => b.snapshots.at(-1)?.players.find(p => p.playerId === b.welcome.playerId)?.x < -3, 'red moves');
  const common = a.snapshots.findLast(s => s.players.length === 2 && b.snapshots.some(t => t.snapshotSeq === s.snapshotSeq));
  assert.ok(common, 'shared snapshot tick');
  const other = b.snapshots.find(s => s.snapshotSeq === common.snapshotSeq);
  assert.equal(other.serverTick, common.serverTick); assert.deepEqual(other.players, common.players);
  assert.ok(common.ball);assert.deepEqual(common.ball,other.ball);assert.deepEqual(common.score,[0,0]);
  a.moveX = b.moveX = 0;
  await a.until(() => a.snapshots.at(-1)?.players.every(p => p.vx === 0 && p.vy === 0), 'neutral input brakes both players');
  a.stop(); b.stop();
  await delay(600);
  const stopped = a.snapshots.at(-1), mine = stopped.players.find(p => p.playerId === a.welcome.playerId);
  assert.equal(mine.vx, 0); assert.equal(mine.vy, 0); assert.equal(mine.preparing, false); assert.equal(stopped.recipient.needsResync, true);
  await delay(150); assert.equal(a.snapshots.at(-1).players.find(p => p.playerId === mine.playerId).x, mine.x);
  b.send({type: 'leave'}); b.close();
  await a.until(() => a.messages.findLast(m => m.type === 'roomState')?.players.length === 1, 'slot released');
  const replacement = new Peer('Новый', false, roster.code); peers.push(replacement); await replacement.ready();
  assert.equal(replacement.welcome.team, 'red');
  const oldMatch=a.welcome.matchId;
  a.send({type:'startMatch'});
  await a.until(()=>a.welcome.matchId!==oldMatch,'fresh match identity');
  await replacement.until(()=>replacement.welcome.matchId===a.welcome.matchId,'second player match identity');
  await Promise.all([a.move(0,0),replacement.move(0,0)]);
  await a.until(()=>a.snapshots.at(-1)?.phase==='playing','countdown and kickoff',8000);
  assert.equal(a.snapshots.at(-1).ball.ownerId,a.welcome.playerId);
  replacement.moveX=1;
  await replacement.until(()=>replacement.snapshots.at(-1)?.players.find(p=>p.playerId===replacement.welcome.playerId)?.x>2,'defender moves off shooting line');
  a.moveY=1;
  await a.until(()=>a.snapshots.at(-1)?.players.find(p=>p.playerId===a.welcome.playerId)?.y>a.welcome.balance.fieldHeight/2-14,'approach enlarged goal',10000);a.moveY=0;
  a.held=true;a.transitions=[{kind:'begin',actionId:1,mode:'kick',possessionVersion:a.snapshots.at(-1).ball.possessionVersion}];
  await delay(1100);a.held=false;a.transitions=[{kind:'release',actionId:1,mode:'kick',possessionVersion:a.snapshots.at(-1).ball.possessionVersion}];
  await a.until(()=>a.snapshots.at(-1)?.ball.impulseSeq>0,'authoritative kick');
  await a.until(()=>a.snapshots.at(-1)?.score[0]===1,'real goal from charged shot',7000);
  await replacement.until(()=>replacement.snapshots.at(-1)?.score[0]===1,'shared score');
  assert.equal(a.snapshots.at(-1).phase,'goalPause');
  console.log(`PASS smoke: two real WebSocket clients, C#/TS snapshots, movement, shared tick ${common.serverTick}, timeout, capacity, version and slot release (${server})`);
  console.log('PASS gameplay: four-digit room, new match identity, countdown, kickoff, charged kick, goal and shared score');
} finally {for (const p of peers) p.close();}
