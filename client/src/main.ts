import './ui/style.css';
import './ui/entry.css';
import './ui/gameplay.css';
import {Controls} from './input/controls.ts';
import {Connection} from './net/connection.ts';
import {Prediction} from './net/prediction.ts';
import {Interpolation} from './net/interpolation.ts';
import type {InputFrame, Roster, Snapshot, Welcome} from './net/protocol.ts';
import {teamToWorld} from './sim/coordinates.ts';
import {Scene} from './render/scene.ts';
import {FixedClock} from './sim/clock.ts';
import {icons} from './ui/icons.ts';
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const entry = el('entry'), game = el('game');
let prediction: Prediction | null = null, interpolation = new Interpolation(), welcome: Welcome | null = null;
let snapshot: Snapshot | null = null, seq = 0, target = 0, batch: InputFrame[] = [], resync = false;
let running = false, debug = false, last = performance.now(), lastResumeMs = 0;
const clock = new FixedClock();
let sceneReady: Promise<void> | null = null;
let roster: Roster | null = null;
let prepMode: 'kick' | 'tackle' = 'tackle', prepVersion = 0;
const scene = new Scene(el('canvas-host'));
function status(message: string, disconnected: boolean): void {
  el('entry-status').textContent = message; el('connection-status').textContent = message;
  if (disconnected) {
    running = false; controls.enabled = false; controls.reset(); controls.model.takeTransitions(); prediction?.stop(); batch = [];
    el<HTMLButtonElement>('create').disabled = false; el<HTMLButtonElement>('join').disabled = false;
    if (!game.hidden) {el('disconnect').hidden = false; el('disconnect-status').textContent = message;}
  }
}
function startFrames(): void {
  if (!welcome || !prediction || !connection.synced || document.hidden || game.hidden) return;
  if (snapshot?.recipient.needsResync) resync = true;
  target = connection.firstTarget; clock.reset(); batch = []; running = true; controls.enabled = true; lastResumeMs = performance.now();
  // The two-tick delivery budget assumes frame 1 is sampled now, not one render step later.
  last = performance.now(); fixedStep();
}
const connection = new Connection({status, sync: startFrames,
  welcome: w => {
    running = false; controls.enabled = false; controls.reset(); controls.model.takeTransitions();
    welcome = w; prediction = new Prediction(w.balance); interpolation = new Interpolation(); seq = 0; snapshot = null; resync = false;
    batch = []; roster = null;
    scene.configure(w.balance, w.team, w.playerId);
  },
  roster: (r: Roster) => {
    roster = r;
    el('code').textContent = r.code; scene.roster(r);
    const rosterElement = el('roster'); rosterElement.replaceChildren();
    for (const p of r.players) {const span = document.createElement('span'); span.className = p.team;
      span.textContent = `${p.team === 'blue' ? 'Синие' : 'Красные'} · ${p.name}${p.playerId === welcome?.playerId ? ' · Вы' : ''}`; rosterElement.append(span);}
    if (r.players.length === 1) {const span = document.createElement('span'); span.textContent = 'Можно играть одному'; rosterElement.append(span);}
  },
  snapshot: s => {
    if (snapshot && s.ball.possessionVersion !== snapshot.ball.possessionVersion && controls.model.preparing) {
      controls.model.cancel(); controls.model.takeTransitions(); batch = [];
      connection.send({type: 'cancelAction', throughInputSeq: seq});
    }
    snapshot = s; interpolation.push(s, performance.now()); prediction?.reconcile(s, welcome!.playerId);
    if (s.recipient.needsResync && running && !resync && performance.now() - lastResumeMs > 500) {suspend(); resume();}
  },
});
const controls = new Controls(game, (x, y) => scene.aimAt(x, y), suspendControl => {
  controls.model.takeTransitions(); batch = [];
  connection.send({type: suspendControl ? 'suspend' : 'cancelAction', throughInputSeq: seq});
  if (suspendControl) {running = false; resync = true; prediction?.stop();}
});
function suspend(): void {controls.suspend();}
function resume(): void {
  if (running) return;
  if (welcome && connection.socket && !document.hidden && !game.hidden) {
    connection.send({type: 'suspend', throughInputSeq: seq});
    resync = true; startFrames();
  }
}
window.addEventListener('focus', resume);
document.addEventListener('visibilitychange', () => {if (!document.hidden) resume();});
game.addEventListener('pointerdown', () => {if (!running && welcome && connection.synced) resume();}, {capture: true});

async function connect(create: boolean): Promise<void> {
  el<HTMLButtonElement>('create').disabled = true; el<HTMLButtonElement>('join').disabled = true;
  try {
    game.hidden = false; entry.hidden = true; el('disconnect').hidden = true;
    if (!sceneReady) sceneReady = scene.init();
    await sceneReady;
    game.focus();
    connection.connect(el<HTMLInputElement>('nickname').value, el<HTMLInputElement>('room-code').value, create);
  } catch (error) {game.hidden = true; entry.hidden = false; status(error instanceof Error ? error.message : 'Не удалось запустить графику. Нужен браузер с WebGL.', true);}
}
el('create').addEventListener('click', () => void connect(true));
el('join-form').addEventListener('submit', e => {e.preventDefault(); void connect(false);});
el<HTMLInputElement>('room-code').value = new URLSearchParams(location.search).get('room')?.slice(0, 4) || '';
el<HTMLInputElement>('room-code').addEventListener('input', e => {const input=e.target as HTMLInputElement;input.value=input.value.replace(/\D/g,'').slice(0,4);});
function leave(): void {
  suspend(); connection.send({type: 'leave'}); connection.close(); welcome = null; prediction = null; snapshot = null;
  controls.enabled = false; running = false; seq = 0; batch = []; resync = false;
  game.hidden = true; entry.hidden = false; el('disconnect').hidden = true;
  el('entry-status').textContent = ''; el<HTMLButtonElement>('create').disabled = el<HTMLButtonElement>('join').disabled = false;
}
el('leave').addEventListener('click', leave); el('back').addEventListener('click', leave);
el('start-match').addEventListener('click', () => connection.send({type: 'startMatch'}));
el('practice').addEventListener('click', () => connection.send({type: 'practice'}));
el('create').querySelector('.button-icon')!.innerHTML = icons.arrowUpRight;
el('join').querySelector('.button-icon')!.innerHTML = icons.arrowRight;
el('left-stick').querySelector('.knob span')!.innerHTML = icons.move;
el('right-stick').querySelector('.knob span')!.innerHTML = icons.tackle;
el('leave').innerHTML = icons.leave;
el('copy').querySelector('span')!.innerHTML = icons.copy;
el('ball-pointer').innerHTML = icons.ball;
el('copy').addEventListener('click', async () => {
  const url = new URL(location.href); url.searchParams.set('room', el('code').textContent!);
  try {await navigator.clipboard.writeText(url.toString()); el('connection-status').textContent = 'Ссылка скопирована';}
  catch {prompt('Ссылка для друга', url.toString());}
});
el('debug-toggle').addEventListener('click', () => {debug = !debug; el('debug').hidden = !debug;});

function fixedStep(): void {
  if (!running || !welcome || !prediction) return;
  const drift = target - connection.serverTick;
  if (drift > 30 || drift < -8) {suspend(); resume(); return;}
  controls.updateMouse();
  const model = controls.model, move = teamToWorld(model.move, welcome.team), aim = teamToWorld(model.aim, welcome.team);
  const transitions = model.takeTransitions().map(t => {
    if (t.kind === 'begin') {prepMode=snapshot?.ball.ownerId===welcome!.playerId?'kick':'tackle';prepVersion=snapshot?.ball.possessionVersion??0;}
    return {...t,mode:prepMode,possessionVersion:prepVersion};
  });
  const f: InputFrame = {inputSeq: ++seq, targetTick: target++, moveX: move.x, moveY: move.y, aimX: aim.x, aimY: aim.y,
    actionHeld: model.preparing, transitions};
  if (!prediction.push(f)) {suspend(); resume(); return;}
  batch.push(f);
  if (batch.length >= 2) {connection.send({type: 'inputBatch', frames: batch, resync}); batch = []; resync = false;}
}
let smoothFps = 60;
function frame(now: number): void {
  const elapsed = Math.max(0, (now - last) / 1000); last = now;
  if (!clock.advance(elapsed, fixedStep) && running) {suspend(); resume();}
  smoothFps += ((1 / Math.max(elapsed, .001)) - smoothFps) * .05;
  if (welcome && prediction && snapshot && !game.hidden) {
    const own = prediction.render(Math.min(elapsed, .1));
    const players = interpolation.sample(now);
    if (!players.some(p => p.playerId === welcome!.playerId)) {
      const mine = snapshot.players.find(p => p.playerId === welcome!.playerId); if (mine) players.push(mine);
    }
    const mine=snapshot.players.find(p=>p.playerId===welcome!.playerId),ownsBall=snapshot.ball.ownerId===welcome.playerId;
    const mode=ownsBall?'kick':'tackle',active=['training','playing'].includes(snapshot.phase);
    const cooldown=Math.max(0,((mine?.cooldownEndTick??0)-connection.serverTick)/60);
    controls.model.canPrepare=active&&connection.serverTick>=(mine?.recoverEndTick??0)&&(ownsBall||cooldown<=0);
    if(!controls.model.canPrepare&&controls.model.preparing){controls.model.cancel();controls.model.takeTransitions();batch=[];connection.send({type:'cancelAction',throughInputSeq:seq});}
    const charge=controls.model.preparing?Math.min(1,(now-controls.model.startMs)/(1000*(mode==='kick'?welcome.balance.shotChargeSeconds:welcome.balance.tackleChargeSeconds))):-1;
    let ball=interpolation.ball(now);
    if(ownsBall)ball={...snapshot.ball,x:own.x+prediction.dribble.x*welcome.balance.dribbleDistance,y:own.y+prediction.dribble.y*welcome.balance.dribbleDistance};
    scene.draw(players,own,controls.model.aim,charge,Math.min(elapsed,.1),ball,mode);
    el('right-stick').style.setProperty('--charge', `${Math.max(0, charge)}`);
    if(el('right-stick').dataset.mode!==mode){el('right-stick').dataset.mode=mode;el('right-stick').querySelector('.knob span')!.innerHTML=icons[mode];el('right-stick').querySelector('.stick-label')!.textContent=ownsBall?'УДАР':'ПОДКАТ';}
    el('right-stick').classList.toggle('cooldown',!ownsBall&&cooldown>0);
    el('blue-score').textContent=String(snapshot.score[0]);el('red-score').textContent=String(snapshot.score[1]);
    const seconds=snapshot.remainingTime===null?null:Math.ceil(snapshot.remainingTime);
    el('match-clock').textContent=seconds===null?'Свободная игра':`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
    const organizer=roster?.organizerId===welcome.playerId;
    el('start-match').hidden=!organizer||!['training','finished'].includes(snapshot.phase);
    el('start-match').textContent=snapshot.phase==='finished'?'Ещё матч':'Начать матч';el('practice').hidden=!organizer||snapshot.phase!=='finished';
    const message=el('match-message'),paused=['countdown','kickoff','goalPause','finished'].includes(snapshot.phase);message.hidden=!paused;
    if(paused)message.textContent=snapshot.phase==='countdown'?`Начинаем через ${Math.max(1,Math.ceil((snapshot.phaseEndTick-snapshot.serverTick)/60))}`:snapshot.phase==='kickoff'?'Розыгрыш':snapshot.phase==='goalPause'?'ГОЛ!':snapshot.score[0]===snapshot.score[1]?'Матч окончен · Ничья':`Матч окончен · ${snapshot.score[0]>snapshot.score[1]?'Синие':'Красные'} победили`;
    el('action-hint').textContent=!active?'':mine?.actionState==='recovering'?'Восстановление':ownsBall&&prediction.dribble.turnEndTick>0?'Разворот с мячом':!ownsBall&&cooldown>0?`Подкат через ${cooldown.toFixed(1)} с`:ownsBall?'Удерживайте правый стик / ЛКМ и отпустите — удар':'Без мяча — подкат. Подойдите к мячу, чтобы забрать его';
    game.dataset.preparing = `${controls.model.preparing}`; game.dataset.running = `${running}`;
    game.dataset.phase=snapshot.phase;game.dataset.ballOwner=snapshot.ball.ownerId??'';game.dataset.action=mine?.actionState??'';
    if (debug) el('debug').textContent = `FPS ${smoothFps.toFixed(0)}\nRTT ${connection.rtt.toFixed(0)} ms\nДжиттер ${interpolation.jitter.toFixed(1)} ms\nТик ${snapshot.serverTick}\nОжидают ack ${prediction.history.length}\nКоррекция ${prediction.correction.toFixed(3)} м`;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
