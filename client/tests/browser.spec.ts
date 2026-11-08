import {expect, test, type Page} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import {decodeSnapshot} from '../src/net/snapshot.ts';
import type {Snapshot} from '../src/net/protocol.ts';
async function create(page: Page): Promise<string> {
  await page.goto('/'); await page.getByRole('button', {name: 'Создать тренировку'}).click();
  await expect(page.locator('#game')).toHaveAttribute('data-running', 'true');
  await expect(page.locator('#disconnect')).toBeHidden();
  const code=(await page.locator('#code').textContent())!;expect(code).toMatch(/^[0-9]{4}$/);return code;
}
test('two independent browsers join, render the pitch, aim, cancel and leave', async ({browser, page}, testInfo) => {
  await page.setViewportSize({width:480,height:720});
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const code = await create(page);
  const secondContext = await browser.newContext({viewport:{width:480,height:720}}); const second = await secondContext.newPage();
  const received: Snapshot[] = [];
  const sent: unknown[] = [];
  second.on('websocket', socket => {
    socket.on('framereceived', event => {if (typeof event.payload !== 'string') received.push(decodeSnapshot(event.payload));});
    socket.on('framesent', event => {if (typeof event.payload === 'string') sent.push(JSON.parse(event.payload));});
  });
  await second.goto(`/?room=${code}`); await second.locator('#nickname').fill('Друг'); await second.getByRole('button', {name: 'Войти', exact: true}).click();
  await expect(second.locator('#game')).toHaveAttribute('data-running', 'true', {timeout:15000});
  await expect(second.locator('#roster')).toContainText('Красные'); await expect(second.locator('#roster')).toContainText('Вы');
  await expect(page.locator('#roster')).toContainText('Друг');
  await second.bringToFront();await second.locator('#game').focus();
  const bounds = (await second.locator('#game').boundingBox())!;
  await second.mouse.move(bounds.x + bounds.width * .7, 300); await second.mouse.down(); await expect(second.locator('#game')).toHaveAttribute('data-preparing', 'true');
  await second.keyboard.press('Escape'); await expect(second.locator('#game')).toHaveAttribute('data-preparing', 'false');
  await second.mouse.up();
  const startY = received.at(-1)!.players.find(p => p.team === 'red')!.y;
  await second.keyboard.down('w'); await second.waitForTimeout(350); await second.keyboard.up('w');
  try {await expect.poll(() => received.at(-1)?.players.find(p => p.team === 'red')?.y ?? -100).toBeGreaterThan(startY + .4);}
  catch (error) {
    await testInfo.attach('movement-wire.json', {body: JSON.stringify({sent, received: received.map(s => ({tick: s.serverTick, recipient: s.recipient, player: s.players.find(p => p.team === 'red')}))}, null, 2), contentType: 'application/json'});
    throw error;
  }
  await expect(second.locator('#disconnect')).toBeHidden();
  await second.mouse.down(); await expect(second.locator('#game')).toHaveAttribute('data-preparing', 'true');
  await second.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(second.locator('#game')).toHaveAttribute('data-preparing', 'false');
  await expect(second.locator('#game')).toHaveAttribute('data-running', 'false');
  await expect.poll(() => received.at(-1)?.players.find(p => p.team === 'red')?.vy).toBe(0);
  await second.mouse.up(); await second.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(second.locator('#game')).toHaveAttribute('data-running', 'true');
  await second.waitForTimeout(300); await expect(second.locator('#disconnect')).toBeHidden();
  await second.screenshot({path: fileURLToPath(new URL('../../docs/sessions/02-desktop.png', import.meta.url))});
  await second.locator('#leave').click(); await expect(second.locator('#entry')).toBeVisible();
  expect(errors).toEqual([]); await secondContext.close();
});
for (const width of [320, 360, 390, 430, 480]) test(`touch layout ${width} CSS px`, async ({browser}) => {
  const context = await browser.newContext({viewport: {width, height: 844}, hasTouch: true, isMobile: true, deviceScaleFactor: 3});
  const page = await context.newPage(); await create(page);
  await page.locator('#game').evaluate(e => e.classList.add('touch-controls'));
  const left = await page.locator('#left-stick').boundingBox(), right = await page.locator('#right-stick').boundingBox();
  expect(left!.width).toBeCloseTo(Math.max(112, Math.min(156, width * .34)), 1);
  expect(left!.x).toBeCloseTo(24, 1); expect(width - right!.x - right!.width).toBeCloseTo(24, 1);
  expect(844 - left!.y - left!.height).toBeCloseTo(40, 1); expect(left!.x + left!.width).toBeLessThan(right!.x);
  const knob = await page.locator('#left-stick .knob').boundingBox(); expect(knob!.width).toBeCloseTo(left!.width * .48, 1);
  await context.close();
});
test('two captured fingers remain independent; third finger and cancellation do not release actions', async ({browser}) => {
  const context = await browser.newContext({viewport: {width: 390, height: 844}, hasTouch: true, isMobile: true});
  const page = await context.newPage(); await create(page);
  await page.locator('#game').evaluate(e => e.classList.add('touch-controls'));
  const l = (await page.locator('#left-stick').boundingBox())!, r = (await page.locator('#right-stick').boundingBox())!;
  const cdp = await context.newCDPSession(page);
  const left = {x: l.x + l.width / 2 - 25, y: l.y + l.height / 2, id: 1};
  const right = {x: r.x + r.width / 2, y: r.y + r.height / 2 - 25, id: 2};
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [left]});
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [left, right]});
  await expect(page.locator('#game')).toHaveAttribute('data-preparing', 'true');
  await page.screenshot({path: fileURLToPath(new URL('../../docs/sessions/02-mobile-emulation.png', import.meta.url))});
  const third = {x: r.x + r.width / 2 + 10, y: r.y + r.height / 2, id: 3};
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [left, right, third]});
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{...left, x: left.x - 100}, right, third]});
  await expect(page.locator('#game')).toHaveAttribute('data-preparing', 'true');
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchCancel', touchPoints: []});
  await expect(page.locator('#game')).toHaveAttribute('data-preparing', 'false');
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await expect(page.locator('#disconnect')).toBeHidden(); await context.close();
});

test('solo play has a visible ball, capture, charged kick, slide, goal and an optional match',async({page})=>{
  const received:Snapshot[]=[];let playerId='';
  page.on('websocket',socket=>socket.on('framereceived',e=>{
    if(typeof e.payload==='string'){const m=JSON.parse(e.payload);if(m.type==='welcome')playerId=m.playerId;}
    else received.push(decodeSnapshot(e.payload));
  }));
  await create(page);expect(received.at(-1)!.ball.state).toBe('free');
  const art=await page.evaluate(async()=>{
    const image=new Image();image.src=new URL('art/football-cats-v1.png',document.baseURI).href;await image.decode();
    const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0);
    return{width:image.width,height:image.height,alpha:ctx.getImageData(0,0,1,1).data[3]};
  });
  expect(art.width).toBeGreaterThanOrEqual(1024);expect(art.width).toBe(art.height);expect(art.alpha).toBe(0);
  await page.keyboard.down('w');await expect.poll(()=>received.at(-1)?.ball.ownerId).toBe(playerId);await page.keyboard.up('w');
  await expect(page.locator('#right-stick .stick-label')).toHaveText('УДАР');
  // The doubled pitch needs an approach: shot power and drag keep their original balance.
  await page.keyboard.down('w');await expect.poll(()=>received.at(-1)?.players.find(p=>p.playerId===playerId)?.y??0,{timeout:10000}).toBeGreaterThan(26);await page.keyboard.up('w');
  const bounds=(await page.locator('#game').boundingBox())!;
  await page.mouse.move(bounds.x+bounds.width/2,220);await page.mouse.down();
  await expect.poll(()=>received.at(-1)?.players.find(p=>p.playerId===playerId)?.preparationMode).toBe('kick');
  await page.waitForTimeout(1050);await page.mouse.up();
  await expect.poll(()=>received.at(-1)?.ball.impulseSeq).toBeGreaterThan(0);
  await page.mouse.move(bounds.x+bounds.width-30,bounds.height/2);await page.mouse.down();await page.waitForTimeout(250);await page.mouse.up();
  await expect.poll(()=>received.some(s=>s.players.some(p=>p.playerId===playerId&&p.actionState==='sliding'))).toBe(true);
  await expect.poll(()=>received.at(-1)?.players.find(p=>p.playerId===playerId)?.cooldownEndTick??0).toBeGreaterThan(0);
  await expect.poll(()=>received.at(-1)?.score[0],{timeout:8000}).toBe(1);
  await expect(page.locator('#game')).toHaveAttribute('data-phase','training',{timeout:6000});
  await page.getByRole('button',{name:'Начать матч'}).click();
  await expect(page.locator('#game')).toHaveAttribute('data-phase','countdown');
  await expect(page.locator('#game')).toHaveAttribute('data-phase','playing',{timeout:8000});
  expect(received.at(-1)!.players).toHaveLength(1);expect(received.at(-1)!.score).toEqual([0,0]);
  await expect(page.locator('#disconnect')).toBeHidden();
  await page.screenshot({path:fileURLToPath(new URL('../../docs/sessions/02-solo-match.png',import.meta.url))});
});

test('carrying follows running direction, slows to ninety percent and plants feet before reversing',async({page})=>{
  const received:Snapshot[]=[];let id='';const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('websocket',socket=>socket.on('framereceived',e=>{
    if(typeof e.payload==='string'){const m=JSON.parse(e.payload);if(m.type==='welcome')id=m.playerId;}
    else received.push(decodeSnapshot(e.payload));
  }));
  await create(page);await page.keyboard.down('w');await expect.poll(()=>received.at(-1)?.ball.ownerId).toBe(id);await page.keyboard.up('w');
  // Cursor remains north while the carrier moves east.
  const bounds=(await page.locator('#game').boundingBox())!;await page.mouse.move(bounds.x+bounds.width/2,220);
  await page.keyboard.down('d');await expect.poll(()=>received.at(-1)?.players.find(p=>p.playerId===id)?.vx).toBeCloseTo(5.04,5);
  const east=received.at(-1)!,p=east.players.find(p=>p.playerId===id)!;
  expect(p.facingY).toBeGreaterThan(.5);expect(east.ball.x-p.x).toBeCloseTo(1.1,5);expect(east.ball.y-p.y).toBeCloseTo(0,5);
  const since=received.length;await page.keyboard.up('d');await page.keyboard.down('a');
  await expect.poll(()=>received.slice(since).some(s=>s.players.some(p=>p.playerId===id&&p.dribbleTurnEndTick>0))).toBe(true);
  await expect.poll(()=>received.at(-1)?.players.find(p=>p.playerId===id)?.vx).toBeLessThan(-4.9);await page.keyboard.up('a');
  const turning=received.slice(since).filter(s=>s.players.find(p=>p.playerId===id)!.dribbleTurnEndTick>0);
  expect(turning.length).toBeGreaterThanOrEqual(4);
  const first=turning[0].players.find(p=>p.playerId===id)!;
  for(const s of turning){const actor=s.players.find(p=>p.playerId===id)!;expect(actor.vx).toBe(0);expect(actor.vy).toBe(0);expect(actor.x).toBeCloseTo(first.x,6);
    if(s.serverTick<actor.dribbleTurnStartTick+12){expect(s.ball.x-actor.x).toBeCloseTo(1.1,5);expect(actor.dribbleX).toBeCloseTo(1,6);}
  }
  const west=received.at(-1)!,actor=west.players.find(p=>p.playerId===id)!;
  expect(west.ball.ownerId).toBe(id);expect(west.ball.x-actor.x).toBeCloseTo(-1.1,5);
  expect(received.every(s=>{const p=s.players.find(p=>p.playerId===id);return s.ball.ownerId!==id||!p||Math.hypot(p.vx,p.vy)<=5.040001;})).toBe(true);
  await expect(page.locator('#disconnect')).toBeHidden();expect(errors).toEqual([]);
  await page.screenshot({path:fileURLToPath(new URL('../../docs/sessions/02-dribbling.png',import.meta.url))});
});

test('shot follows the released arrow opposite to running and survives later cursor changes',async({page})=>{
  const received:Snapshot[]=[];const releases:{aimX:number;aimY:number}[]=[];let id='';
  page.on('websocket',socket=>{
    socket.on('framereceived',e=>{if(typeof e.payload==='string'){const m=JSON.parse(e.payload);if(m.type==='welcome'){id=m.playerId;expect(m.balance.fieldWidth).toBe(48);expect(m.balance.fieldHeight).toBe(80);expect(m.balance.goalWidth).toBe(11.2);}}else received.push(decodeSnapshot(e.payload));});
    socket.on('framesent',e=>{if(typeof e.payload==='string'){const m=JSON.parse(e.payload);for(const f of m.frames??[])for(const t of f.transitions??[])if(t.kind==='release')releases.push(t);}});
  });
  await create(page);await page.keyboard.down('w');await expect.poll(()=>received.at(-1)?.ball.ownerId).toBe(id);await page.keyboard.up('w');
  await page.keyboard.down('d');await expect.poll(()=>received.at(-1)?.players.find(p=>p.playerId===id)?.vx).toBeCloseTo(5.04,5);
  const box=(await page.locator('#game').boundingBox())!;
  await page.mouse.move(box.x+45,box.y+box.height/2);await page.mouse.down();await expect(page.locator('#game')).toHaveAttribute('data-preparing','true');
  await page.waitForTimeout(300);await page.mouse.up();await page.mouse.move(box.x+box.width/2,box.y+210);await page.keyboard.up('d');
  await expect.poll(()=>received.at(-1)?.ball.impulseSeq??0).toBeGreaterThan(0);
  const launch=received.find(s=>s.ball.impulseSeq>0)!.ball;expect(releases).toHaveLength(1);
  expect(releases[0].aimX).toBeCloseTo(-1,5);expect(releases[0].aimY).toBeCloseTo(0,5);
  expect(launch.vx).toBeLessThan(-10);expect(Math.abs(launch.vy)).toBeLessThan(.001);
  await page.waitForTimeout(250);expect(received.at(-1)!.ball.vx).toBeLessThan(0);await expect(page.locator('#disconnect')).toBeHidden();
  await page.screenshot({path:fileURLToPath(new URL('../../docs/sessions/02-ball-camera.png',import.meta.url))});
});

test('players collide without pushing the stationary opponent',async({browser,page})=>{
  const snapshots:Snapshot[]=[];
  page.on('websocket',s=>s.on('framereceived',e=>{if(typeof e.payload!=='string')snapshots.push(decodeSnapshot(e.payload));}));
  const code=await create(page),context=await browser.newContext(),other=await context.newPage();
  await other.goto(`/?room=${code}`);await other.getByRole('button',{name:'Войти',exact:true}).click();await expect(other.locator('#game')).toHaveAttribute('data-running','true');
  await page.bringToFront();await page.locator('#game').focus();await expect(page.locator('#game')).toHaveAttribute('data-running','true');
  await page.keyboard.down('w');await page.waitForTimeout(2200);await page.keyboard.up('w');
  const state=snapshots.at(-1)!,blue=state.players.find(p=>p.team==='blue')!,red=state.players.find(p=>p.team==='red')!;
  expect(red.y).toBeCloseTo(2.5,5);expect(Math.hypot(blue.x-red.x,blue.y-red.y)).toBeGreaterThanOrEqual(.84-1e-5);expect(blue.y).toBeLessThan(red.y);
  await expect(page.locator('#disconnect')).toBeHidden();await context.close();
});
