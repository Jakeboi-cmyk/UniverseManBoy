const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT || 3000);
const HOST = '0.0.0.0';
const TICK_MS = 1000 / 60;
const SNAPSHOT_MS = 50;
const MAX_PLAYERS = 4;
const VIEW_RADIUS = 99999;

const WORLDS = {
  main:      { w: 2200, h: 1400, name: 'Main World', tag: '🟢 MAIN' },
  universe:  { w: 2600, h: 1600, name: 'MILO UNIVERSE', tag: '🌌 MILO UNIVERSE' },
  jake:      { w: 2800, h: 1700, name: 'JAKE UNIVERSE', tag: '💰 JAKE UNIVERSE' },
  hyper:     { w: 3000, h: 1800, name: 'HYPER UNIVERSE', tag: '⚡ HYPER UNIVERSE' }
};
const COLORS = ['#f1c84b', '#7ec8ff', '#ff7eb9', '#7effa0'];
const rooms = new Map();

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function uid(prefix='id') { return `${prefix}_${Math.random().toString(36).slice(2,9)}_${Date.now().toString(36)}`; }
function roomCode() {
  let c;
  do c = Math.random().toString(36).slice(2, 8).toUpperCase(); while (rooms.has(c));
  return c;
}
function safeName(name) {
  const s = String(name || 'Charlie').replace(/[<>]/g, '').trim().slice(0, 16);
  return s || 'Charlie';
}
function safeColor(color) {
  return /^#[0-9a-fA-F]{6}$/.test(color || '') ? color : '#f1c84b';
}

function buildObstacles(kind) {
  const data = {
    main: [
      [280,110,180,36,0],[620,90,48,200,0],[980,80,190,34,0],[1400,140,160,40,0],[1800,90,50,220,0],
      [220,420,190,40,0],[560,480,140,42,0],[920,400,55,180,0],[1300,520,170,38,0],[1700,450,120,40,0],
      [400,780,200,38,0],[900,850,60,200,0],[1400,900,180,36,0],[1900,780,140,40,0],[300,1150,160,38,0],
      [800,1200,200,36,0],[1400,1100,55,180,0],[1850,1180,150,40,0],[450,250,90,38,80,1],[780,320,100,36,70,1],
      [1150,280,85,38,90,1],[1550,350,110,40,100,1],[350,600,95,36,75,1],[700,700,120,40,110,1],
      [1100,650,90,38,85,1],[1600,700,100,36,95,1],[500,980,110,38,100,1],[1050,1050,95,40,90,1],
      [1500,980,120,36,110,1],[1900,1050,90,38,80,1]
    ],
    universe: [
      [200,150,220,40,0],[600,100,50,250,0],[1000,200,180,36,0],[1500,120,55,220,0],[2000,180,200,40,0],
      [300,500,160,38,0],[800,550,200,40,0],[1300,480,50,200,0],[1800,520,170,36,0],[400,900,190,40,0],
      [900,950,60,220,0],[1400,880,180,38,0],[2000,1000,150,40,0],[250,1300,200,36,0],[1100,1350,220,40,0],
      [1800,1280,55,200,0],[500,300,100,40,120,1],[1100,350,110,38,130,1],[1700,300,95,40,110,1],[650,700,120,42,140,1],
      [1200,750,100,38,120,1],[1900,700,110,40,130,1],[550,1100,115,38,125,1],[1500,1150,130,40,145,1]
    ],
    jake: [
      [180,120,200,40,0],[550,80,55,240,0],[950,160,190,36,0],[1450,100,50,230,0],[2000,150,210,40,0],[2400,200,55,200,0],
      [250,480,170,38,0],[750,520,200,40,0],[1250,450,55,210,0],[1750,500,180,36,0],[2300,480,160,40,0],[350,900,200,40,0],
      [850,950,60,230,0],[1400,880,190,38,0],[1950,980,55,200,0],[2450,920,170,40,0],[200,1350,220,36,0],[1000,1400,200,40,0],
      [1800,1320,55,220,0],[2300,1450,190,36,0],[480,280,110,40,140,1],[1100,320,120,38,150,1],[1700,280,100,40,130,1],
      [2200,350,115,38,145,1],[600,700,130,42,160,1],[1500,720,110,40,140,1],[2100,680,120,38,150,1],[500,1150,125,40,155,1],
      [1300,1200,140,42,165,1],[2000,1180,115,38,150,1]
    ],
    hyper: [
      [200,140,240,40,0],[700,100,55,260,0],[1200,180,200,38,0],[1700,120,55,240,0],[2300,160,220,40,0],[2700,200,55,220,0],
      [300,520,180,40,0],[900,560,220,40,0],[1500,500,55,220,0],[2000,540,200,38,0],[2550,500,180,40,0],[400,950,220,40,0],
      [1000,1000,60,240,0],[1600,920,200,38,0],[2200,980,55,220,0],[2700,940,180,40,0],[250,1450,240,38,0],[1200,1500,220,40,0],
      [2000,1400,55,240,0],[2500,1520,200,38,0],[550,300,120,40,160,1],[1300,340,130,40,170,1],[1900,300,110,40,150,1],
      [2500,360,120,40,165,1],[700,750,140,42,180,1],[1600,780,120,40,160,1],[2300,720,130,40,170,1],[600,1200,130,40,175,1],
      [1400,1250,150,42,185,1],[2200,1220,120,40,160,1]
    ]
  };
  return data[kind].map(([x,y,w,h,hp,breakable]) => ({ x, y, w, h, hp: hp || Infinity, solid: true, breakable: !!breakable }));
}

function newPlayer(slot, name='Charlie', color=COLORS[slot]) {
  const p = {
    id: uid('p'), slot, name: safeName(name), color: safeColor(color),
    x: 180 + slot * 60, y: 700, r: 19, hp: 60, maxHp: 60, shield: 0, speed: 240,
    coins: 0, kills: 0, alive: true, respawn: 0,
    aimX: 1, aimY: 0,
    input: { up:false,down:false,left:false,right:false }, seq: 0, ackSeq: 0, lastInputAt: Date.now(),
    cds: { roar:0, slash:0, heal:0, minion:0, beam:0 },
    stats: {
      roarPower:78, roarCdMax:2.4, roarRange:125, dmgReduce:0, magnet:0,
      slashPower:1, slashCdMax:4.5, slashRange:95,
      minionCount:2, minionDmg:40, minionCdMax:7,
      hyperPower:1, hyperCdMax:5, hyperUnlocked:false,
      slashUnlocked:false, minionUnlocked:false,
      necroUnlocked:false, necroActive:false, necroChance:1
    },
    prices: {
      speed:30,power:36,cd:42,shield:46,maxhp:55,range:50,magnet:60,armor:70,key:180,
      slashDmg:40,slashCdUp:55,slashRange:48,minionCount:60,minionDmg:55,minionCdUp:50,hyperDmg:70,hyperCdUp:65
    },
    nameDirty: false, godMode:false
  };
  return p;
}

function createRoom(code, solo=false) {
  const room = {
    code,
    solo,
    started: false,
    world: 'main',
    worldIndex: 0,
    kills: 0,
    spawnTimer: 1.2,
    obstacles: buildObstacles('main'),
    enemies: [], bosses: [], orbs: [], bullets: [], minions: [], effects: [],
    progression: {
      dictatorDefeated:false,jakeDefeated:false,finalSpawned:false,challengeKeyBought:false,won:false,
      stickDefeated:false,alekunderDefeated:false,fazeDefeated:false,universeWon:false,
      baileyDefeated:false,vittalaDefeated:false,eviljekDefeated:false,jakeUniverseWon:false,
      hawkDefeated:false,epsteinDefeated:false,omegaDefeated:false,hyperWon:false
    },
    bossIndex: { universe:0, jake:0, hyper:0 },
    portal: null,
    shrine: null,
    lastBroadcast: 0,
    events: [],
    nextEntity: 1,
    lastTick: Date.now()
  };
  rooms.set(code, room);
  return room;
}

function spawnOrb(room, x=null, y=null) {
  const pos = findOpen(room, 10, x ?? (60 + Math.random()*(WORLDS[room.world].w-120)), y ?? (60 + Math.random()*(WORLDS[room.world].h-120)));
  room.orbs.push({ id:room.nextEntity++, x:pos.x, y:pos.y, r:8, value:5 });
}
function seedOrbs(room, count) { room.orbs=[]; for (let i=0;i<count;i++) spawnOrb(room); }
function findOpen(room, r, preferredX, preferredY) {
  for (let i=0;i<60;i++) {
    const x = clamp(preferredX + (i? (Math.random()-.5)*260:0), r+10, WORLDS[room.world].w-r-10);
    const y = clamp(preferredY + (i? (Math.random()-.5)*260:0), r+10, WORLDS[room.world].h-r-10);
    if (!room.obstacles.some(o=>o.solid && circleRect({x,y,r},o))) return {x,y};
  }
  return {x:100,y:100};
}
function circleRect(c,o) {
  const x = clamp(c.x,o.x,o.x+o.w), y = clamp(c.y,o.y,o.y+o.h);
  return Math.hypot(c.x-x,c.y-y) < c.r;
}
function moveCircle(room, body, dx, dy) {
  const world = WORLDS[room.world];
  let nx = clamp(body.x + dx, body.r, world.w-body.r);
  if (!room.obstacles.some(o=>o.solid && circleRect({x:nx,y:body.y,r:body.r},o))) body.x = nx;
  let ny = clamp(body.y + dy, body.r, world.h-body.r);
  if (!room.obstacles.some(o=>o.solid && circleRect({x:body.x,y:ny,r:body.r},o))) body.y = ny;
}
function segmentHitsWall(room, x1,y1,x2,y2) {
  const n = 22;
  for (let i=0;i<=n;i++) {
    const t=i/n, x=x1+(x2-x1)*t, y=y1+(y2-y1)*t;
    if (room.obstacles.some(o=>o.solid && x>=o.x && x<=o.x+o.w && y>=o.y && y<=o.y+o.h)) return true;
  }
  return false;
}
function nearestPlayer(room, from) {
  let best=null, d=Infinity;
  for (const p of room.players.values()) {
    if (!p.alive || p.hp<=0) continue;
    const dd=dist(from,p); if (dd<d) { d=dd; best=p; }
  }
  return best;
}
function emit(room, type, data={}) { room.events.push({id:room.nextEntity++,type,...data,ttl:0.45}); }
function setWorld(room, world) {
  room.world = world; room.worldIndex = ['main','universe','jake','hyper'].indexOf(world);
  room.obstacles = buildObstacles(world); room.enemies=[]; room.bosses=[]; room.bullets=[]; room.minions=[]; room.portal=null; room.shrine=null;
  seedOrbs(room, world==='main'?28:world==='universe'?35:world==='jake'?40:45);
  room.kills=0; room.spawnTimer=0.65;
  if (world==='jake') room.shrine={x:WORLDS.jake.w/2,y:WORLDS.jake.h/2,r:36,cost:1000};
  for (const p of room.players.values()) { p.x=200; p.y=WORLDS[world].h/2; p.hp=p.maxHp; p.shield=0; if(world==='universe'||world==='jake'||world==='hyper') p.stats.slashUnlocked=true; if(world==='jake'||world==='hyper') p.stats.minionUnlocked=true; if(world==='hyper') p.stats.hyperUnlocked=true; }
  emit(room,'world',{world});
}

function spawnEnemy(room, type='normal', x=null, y=null) {
  const mult = room.world==='main'?[1,1,1]:room.world==='universe'?[2.6,2,1.25]:room.world==='jake'?[4.5,3.2,1.45]:[5.5,3.8,1.5];
  let e;
  const base = {id:room.nextEntity++, x:0,y:0,r:15,hp:48*mult[0],maxHp:48*mult[0],speed:88*mult[2],dmg:13*mult[1],type,shot:1.5,lastHit:null};
  if(type==='fast') Object.assign(base,{r:13,hp:28*mult[0],maxHp:28*mult[0],speed:155*mult[2],dmg:9*mult[1]});
  if(type==='tank') Object.assign(base,{r:22,hp:95*mult[0],maxHp:95*mult[0],speed:55*mult[2],dmg:18*mult[1]});
  if(type==='ranger') Object.assign(base,{r:14,hp:40*mult[0],maxHp:40*mult[0],speed:95*mult[2],dmg:8*mult[1],shot:1.5,keepDist:220});
  if(type==='boomer') Object.assign(base,{r:12,hp:25*mult[0],maxHp:25*mult[0],speed:180*mult[2],dmg:30*mult[1],fuse:1.2});
  const pos=findOpen(room,base.r, x ?? Math.random()*WORLDS[room.world].w, y ?? Math.random()*WORLDS[room.world].h);
  base.x=pos.x;base.y=pos.y;room.enemies.push(base);return base;
}
function spawnRandomEnemy(room) {
  const roll=Math.random(); let type='normal';
  if(room.world==='hyper'){if(roll<.25)type='ranger';else if(roll<.45)type='boomer';else if(roll<.65)type='fast';else if(roll<.85)type='tank';}
  else if(room.world==='universe'||room.world==='jake'){if(roll<.3)type='fast';else if(roll<.55)type='tank';else if(room.world==='jake'&&roll<.7)type='ranger';}
  else {if(room.kills>=8&&roll<.22)type='fast';else if(room.kills>=14&&roll<.38)type='tank';}
  const alive=[...room.players.values()].filter(p=>p.alive);
  if(!alive.length) return;
  for(let i=0;i<50;i++) { const e=spawnEnemy(room,type); if(alive.every(p=>dist(e,p)>280)) return; room.enemies.pop(); }
}

const BOSS_DEFS = {
  dictator:{name:'FILIP DICTATOR',r:40,hp:340,speed:68}, jake:{name:'JAKE THE JEW',r:42,hp:480,speed:78}, final:{name:'FILIP A',r:52,hp:1100,speed:105},
  stick:{name:'THE STICK',r:36,hp:560,speed:115}, alekunder:{name:'ALEKUNDER',r:44,hp:820,speed:72}, faze:{name:'FAZE MILO NR',r:50,hp:1250,speed:95},
  bailey:{name:'BAILEY',r:40,hp:2000,speed:100}, vittala:{name:'VITTALA KUKIRIN',r:46,hp:5000,speed:80}, eviljek:{name:'EVILJEK64',r:54,hp:10000,speed:100},
  hawking:{name:'TITAN HAWKING',r:48,hp:6000,speed:70}, epstein:{name:'SHADOW EPSTEIN',r:46,hp:8000,speed:90}, omega:{name:'OVERLORD OMEGA YAHU',r:60,hp:20000,speed:85}
};
function spawnBoss(room,type) {
  const d=BOSS_DEFS[type]; const preferred={dictator:[WORLDS[room.world].w-220,180],jake:[WORLDS[room.world].w/2,WORLDS[room.world].h-250],final:[WORLDS[room.world].w-200,WORLDS[room.world].h-320],stick:[WORLDS[room.world].w-250,200],alekunder:[WORLDS[room.world].w/2,WORLDS[room.world].h-200],faze:[WORLDS[room.world].w-200,WORLDS[room.world].h/2],bailey:[WORLDS[room.world].w-220,220],vittala:[WORLDS[room.world].w/2,WORLDS[room.world].h-220],eviljek:[WORLDS[room.world].w-200,WORLDS[room.world].h/2],hawking:[WORLDS[room.world].w-250,250],epstein:[WORLDS[room.world].w/2,WORLDS[room.world].h-250],omega:[WORLDS[room.world].w-220,WORLDS[room.world].h/2]}[type];
  const pos=findOpen(room,d.r,preferred[0],preferred[1]); const b={id:room.nextEntity++,type,name:d.name,x:pos.x,y:pos.y,r:d.r,hp:d.hp,maxHp:d.hp,speed:d.speed,lastHit:null,t1:1.5,t2:2.5,t3:3.5,rage:false,phase:1,rolling:false,rollTime:0,rollDx:0,rollDy:0};
  room.bosses.push(b); emit(room,'bossSpawn',{boss:b.type,name:b.name});
}

function damageObstacle(room,o,amount) { if(!o.breakable||!o.solid)return; o.hp-=amount; if(o.hp<=0){o.hp=0;o.solid=false;emit(room,'smash',{x:o.x+o.w/2,y:o.y+o.h/2});} }
function destroyNear(room,b,radius,dt) { for(const o of room.obstacles){ if(!o.breakable||!o.solid)continue; const cx=clamp(b.x,o.x,o.x+o.w),cy=clamp(b.y,o.y,o.y+o.h); if(Math.hypot(b.x-cx,b.y-cy)<b.r+radius)damageObstacle(room,o,450*dt); } }

function damagePlayer(p, amount, room) {
  if (!p.alive || p.godMode) return;
  amount *= (1-p.stats.dmgReduce); const shield=Math.min(p.shield,amount); p.shield-=shield; amount-=shield; p.hp-=amount;
  emit(room,'hit',{x:p.x,y:p.y,amount:Math.round(amount),target:p.id});
  if(p.hp<=0){ p.hp=0;p.alive=false;p.respawn=3;emit(room,'death',{playerId:p.id}); }
}
function respawnPlayer(room,p) { p.alive=true;p.hp=Math.max(1,Math.round(p.maxHp*.6));p.shield=0;p.x=180+p.slot*60;p.y=WORLDS[room.world].h/2;emit(room,'respawn',{playerId:p.id}); }
function awardKill(room, attackerId) { room.kills++; const p=attackerId?room.players.get(attackerId):null; if(p)p.kills++; }
function damageEnemy(room,e,amount,attackerId) { if(e.hp<=0)return; e.hp-=amount;e.lastHit=attackerId;emit(room,'damage',{x:e.x,y:e.y,amount:Math.round(amount),kind:'enemy',entityId:e.id}); if(e.hp<=0){awardKill(room,attackerId); maybeNecro(room,e,attackerId);emit(room,'enemyDeath',{x:e.x,y:e.y});} }
function damageBoss(room,b,amount,attackerId) { if(b.hp<=0)return; b.hp-=amount;b.lastHit=attackerId;emit(room,'damage',{x:b.x,y:b.y,amount:Math.round(amount),kind:'boss',entityId:b.id}); if(b.hp<=0) maybeNecro(room,b,attackerId); }
function maybeNecro(room,dead,ownerId) {
  const owner=ownerId?room.players.get(ownerId):null; if(!owner||!owner.stats.necroActive) return;
  const allyHp=Math.max(dead.type?Math.round(dead.maxHp*.3):70,70); const ally={id:room.nextEntity++,ownerId:owner.id,x:dead.x,y:dead.y,r:dead.r?Math.min(28,dead.r*.75):11,hp:allyHp,maxHp:allyHp,speed:dead.type?125:160,dmg:dead.type?Math.max(50,Math.round(dead.maxHp*.008)):30,life:dead.type?60:32}; room.minions.push(ally);emit(room,'necro',{x:ally.x,y:ally.y});
}

function hitAbility(room,p,kind) {
  if(!p.alive) return;
  const can = kind==='roar' || kind==='heal' || (kind==='slash'&&p.stats.slashUnlocked) || (kind==='minion'&&p.stats.minionUnlocked) || (kind==='beam'&&p.stats.hyperUnlocked);
  if(!can) return;
  if(p.cds[kind]>0) return;
  if(kind==='heal') { p.hp=Math.min(p.maxHp,p.hp+Math.round(p.maxHp*.65)); p.cds.heal=30; emit(room,'heal',{playerId:p.id,x:p.x,y:p.y}); return; }
  if(kind==='roar') {
    p.cds.roar=p.stats.roarCdMax; emit(room,'roar',{x:p.x,y:p.y,r:p.stats.roarRange});
    for(const e of room.enemies) if(dist(p,e)<p.stats.roarRange && !segmentHitsWall(room,p.x,p.y,e.x,e.y)) damageEnemy(room,e,p.stats.roarPower,p.id);
    for(const b of room.bosses) if(dist(p,b)<p.stats.roarRange+15 && !segmentHitsWall(room,p.x,p.y,b.x,b.y)) damageBoss(room,b,Math.round(p.stats.roarPower*.62),p.id);
    for(const o of room.obstacles){if(o.breakable&&o.solid&&Math.hypot(p.x-clamp(p.x,o.x,o.x+o.w),p.y-clamp(p.y,o.y,o.y+o.h))<p.stats.roarRange)damageObstacle(room,o,42);}
    return;
  }
  if(kind==='slash') {
    p.cds.slash=p.stats.slashCdMax; const angle=Math.atan2(p.aimY,p.aimX); const base=Math.round(p.stats.roarPower*2.4*p.stats.slashPower); const range=p.stats.slashRange; emit(room,'slash',{x:p.x,y:p.y,angle,range});
    for(const e of room.enemies){const d=dist(p,e);if(d>range+e.r)continue;let a=Math.abs(Math.atan2(e.y-p.y,e.x-p.x)-angle);if(a>Math.PI)a=2*Math.PI-a;if(a<1.1)damageEnemy(room,e,base,p.id);}
    for(const b of room.bosses){const d=dist(p,b);if(d>range+b.r)continue;let a=Math.abs(Math.atan2(b.y-p.y,b.x-p.x)-angle);if(a>Math.PI)a=2*Math.PI-a;if(a<1.1)damageBoss(room,b,Math.round(base*.7),p.id);}
    return;
  }
  if(kind==='minion') {
    p.cds.minion=p.stats.minionCdMax; for(let i=0;i<p.stats.minionCount;i++){const a=i/p.stats.minionCount*Math.PI*2;room.minions.push({id:room.nextEntity++,ownerId:p.id,x:p.x+Math.cos(a)*35,y:p.y+Math.sin(a)*35,r:11,hp:110,maxHp:110,speed:160,dmg:p.stats.minionDmg,life:22});} emit(room,'summon',{x:p.x,y:p.y,count:p.stats.minionCount}); return;
  }
  if(kind==='beam') {
    p.cds.beam=p.stats.hyperCdMax;const angle=Math.atan2(p.aimY,p.aimX);const range=420,dmg=p.stats.roarPower*1.8*p.stats.hyperPower;emit(room,'beam',{x:p.x,y:p.y,angle,range});
    for(let s=1;s<=40;s++){const t=s/40,px=p.x+Math.cos(angle)*range*t,py=p.y+Math.sin(angle)*range*t;for(const e of room.enemies)if(Math.hypot(e.x-px,e.y-py)<e.r+14)damageEnemy(room,e,dmg/13,p.id);for(const b of room.bosses)if(Math.hypot(b.x-px,b.y-py)<b.r+14)damageBoss(room,b,dmg/18,p.id);}
  }
}

function updatePlayers(room,dt) {
  for(const p of room.players.values()){
    if(Date.now()-p.lastInputAt>250)p.input={up:false,down:false,left:false,right:false};
    for(const k of Object.keys(p.cds)) p.cds[k]=Math.max(0,p.cds[k]-dt);
    if(!p.alive){p.respawn-=dt;if(p.respawn<=0 && room.players.size>1)respawnPlayer(room,p);continue;}
    const mx=(p.input.right?1:0)-(p.input.left?1:0), my=(p.input.down?1:0)-(p.input.up?1:0);
    if(mx||my){const l=Math.hypot(mx,my)||1;moveCircle(room,p,mx/l*p.speed*dt,my/l*p.speed*dt);}
    p.ackSeq=p.seq;
    for(const orb of [...room.orbs]){if(dist(p,orb)<p.r+orb.r){const idx=room.orbs.indexOf(orb);if(idx>=0)room.orbs.splice(idx,1);p.coins+=orb.value;emit(room,'coin',{x:orb.x,y:orb.y,playerId:p.id,value:orb.value});spawnOrb(room);}}
    if(room.portal&&dist(p,room.portal)<p.r+room.portal.r+12)advanceWorld(room);
    if(room.shrine&&!p.stats.necroUnlocked&&dist(p,room.shrine)<p.r+room.shrine.r+8&&p.coins>=room.shrine.cost){p.coins-=room.shrine.cost;p.stats.necroUnlocked=true;p.stats.necroActive=true;emit(room,'necroUnlock',{playerId:p.id});}
  }
}
function advanceWorld(room){
  const next={main:'universe',universe:'jake',jake:'hyper'}[room.world];if(next)setWorld(room,next);
}

function updateEnemies(room,dt){
  const targets=[...room.players.values()].filter(p=>p.alive); if(!targets.length)return;
  for(let i=room.enemies.length-1;i>=0;i--){const e=room.enemies[i];if(e.hp<=0){room.enemies.splice(i,1);continue;}const t=nearestPlayer(room,e);if(!t)continue;
    if(e.type==='ranger'){const d=dist(e,t);if(d<e.keepDist-35){const a=Math.atan2(e.y-t.y,e.x-t.x);moveCircle(room,e,Math.cos(a)*e.speed*dt,Math.sin(a)*e.speed*dt);}else if(d>e.keepDist+35){moveCircle(room,e,Math.cos(Math.atan2(t.y-e.y,t.x-e.x))*e.speed*dt,Math.sin(Math.atan2(t.y-e.y,t.x-e.x))*e.speed*dt);}e.shot-=dt;if(e.shot<=0){e.shot=1.5;const a=Math.atan2(t.y-e.y,t.x-e.x);room.bullets.push({id:room.nextEntity++,x:e.x,y:e.y,vx:Math.cos(a)*320,vy:Math.sin(a)*320,dmg:e.dmg*.8,r:5,owner:'enemy',life:3});}}
    else {moveCircle(room,e,Math.cos(Math.atan2(t.y-e.y,t.x-e.x))*e.speed*dt,Math.sin(Math.atan2(t.y-e.y,t.x-e.x))*e.speed*dt);if(e.type==='boomer'){e.fuse-=dt;if(e.fuse<=0||dist(e,t)<e.r+t.r+6){for(const p of targets)if(dist(e,p)<80)damagePlayer(p,e.dmg,room);e.hp=0;emit(room,'boom',{x:e.x,y:e.y});room.enemies.splice(i,1);continue;}}else if(dist(e,t)<e.r+t.r+4){damagePlayer(t,e.dmg*dt,room);}}
  }
}

function bossAI(room,b,dt){
  const t=nearestPlayer(room,b);if(!t)return; const a=Math.atan2(t.y-b.y,t.x-b.x); if(b.hp<b.maxHp*.4)b.rage=true;
  if(b.type==='stick'&&b.rolling){b.rollTime-=dt;moveCircle(room,b,b.rollDx*320*dt,b.rollDy*320*dt);if(b.rollTime<=0)b.rolling=false;return;}
  moveCircle(room,b,Math.cos(a)*(b.rage?b.speed*1.3:b.speed)*dt,Math.sin(a)*(b.rage?b.speed*1.3:b.speed)*dt);
  b.t1-=dt;b.t2-=dt;b.t3-=dt;
  if(b.type==='dictator'&&b.t1<=0){b.t1=2.8;spawnEnemy(room,'fast',b.x+60,b.y);spawnEnemy(room,'normal',b.x-60,b.y);}
  if(b.type==='jake'&&dist(b,t)<100)damagePlayer(t,18*dt,room);
  if(b.type==='final'){if(b.t1<=0){b.t1=1.8;room.bullets.push({id:room.nextEntity++,x:b.x,y:b.y,vx:Math.cos(a)*380,vy:Math.sin(a)*380,dmg:22,r:7,owner:'boss',life:2.5});emit(room,'laser',{x:b.x,y:b.y,angle:a});}destroyNear(room,b,40,dt);}
  if(b.type==='stick'&&b.t1<=0&&dist(b,t)>180){b.t1=3.5;b.rolling=true;b.rollTime=.8;b.rollDx=Math.cos(a);b.rollDy=Math.sin(a);}
  if(b.type==='alekunder'&&b.t1<=0){b.t1=2.4;for(const p of room.players.values())if(dist(b,p)<180)damagePlayer(p,35,room);emit(room,'slam',{x:b.x,y:b.y});}
  if(b.type==='faze'&&b.t1<=0){b.t1=2.0;emit(room,'laser',{x:b.x,y:b.y,angle:a});for(const p of room.players.values())if(p.alive)room.bullets.push({id:room.nextEntity++,x:b.x,y:b.y,vx:Math.cos(Math.atan2(p.y-b.y,p.x-b.x))*350,vy:Math.sin(Math.atan2(p.y-b.y,p.x-b.x))*350,dmg:20,r:6,owner:'boss',life:2.5});}
  if(b.type==='bailey'&&b.t1<=0){b.t1=1.2;room.bullets.push({id:room.nextEntity++,x:b.x,y:b.y,vx:Math.cos(a)*420,vy:Math.sin(a)*420,dmg:28,r:6,owner:'boss',life:2});}
  if(b.type==='vittala'&&b.t1<=0){b.t1=2.2;for(const p of room.players.values())if(dist(b,p)<160)damagePlayer(p,32,room);}
  if(b.type==='eviljek'){if(b.t1<=0){b.t1=1.5;emit(room,'laser',{x:b.x,y:b.y,angle:a});}if(b.t2<=0){b.t2=4;spawnEnemy(room,'tank',b.x,b.y);spawnEnemy(room,'fast',b.x,b.y);}}
  if(b.type==='hawking'&&b.t1<=0){b.t1=1.6;for(const p of room.players.values())if(dist(b,p)<220)damagePlayer(p,26,room);emit(room,'pulse',{x:b.x,y:b.y,r:220});}
  if(b.type==='epstein'&&b.t1<=0){b.t1=3.5;const pos=findOpen(room,b.r,Math.random()*WORLDS[room.world].w,Math.random()*WORLDS[room.world].h);b.x=pos.x;b.y=pos.y;emit(room,'teleport',{x:b.x,y:b.y});}
  if(b.type==='omega'){if(b.t1<=0){b.t1=1.4;emit(room,'laser',{x:b.x,y:b.y,angle:a});for(const p of room.players.values())if(p.alive)room.bullets.push({id:room.nextEntity++,x:b.x,y:b.y,vx:Math.cos(Math.atan2(p.y-b.y,p.x-b.x))*410,vy:Math.sin(Math.atan2(p.y-b.y,p.x-b.x))*410,dmg:34,r:7,owner:'boss',life:2.5});}if(b.t2<=0){b.t2=5;spawnEnemy(room,'ranger',b.x,b.y);spawnEnemy(room,'tank',b.x,b.y);}}
}
function updateBosses(room,dt){for(let i=room.bosses.length-1;i>=0;i--){const b=room.bosses[i];if(b.hp<=0){room.bosses.splice(i,1);bossDefeated(room,b);continue;}bossAI(room,b,dt);}}

function bossDefeated(room,b){
  emit(room,'bossDeath',{x:b.x,y:b.y,name:b.name});
  const pg=room.progression;
  if(room.world==='main'){if(b.type==='dictator'&&!pg.dictatorDefeated){pg.dictatorDefeated=true;for(const p of room.players.values())p.coins+=90;setTimeout(()=>{if(rooms.has(room.code)&&room.world==='main')spawnBoss(room,'jake');},700);}else if(b.type==='jake'&&!pg.jakeDefeated){pg.jakeDefeated=true;for(const p of room.players.values())p.coins+=120;}}
  else if(room.world==='universe'){if(b.type==='stick'&&!pg.stickDefeated){pg.stickDefeated=true;setTimeout(()=>rooms.has(room.code)&&room.world==='universe'&&spawnBoss(room,'alekunder'),700);}else if(b.type==='alekunder'&&!pg.alekunderDefeated){pg.alekunderDefeated=true;setTimeout(()=>rooms.has(room.code)&&room.world==='universe'&&spawnBoss(room,'faze'),700);}else if(b.type==='faze'&&!pg.fazeDefeated){pg.fazeDefeated=true;pg.universeWon=true;room.portal={x:room.players.values().next().value?.x+80||200,y:WORLDS[room.world].h/2,r:28,dest:'jake'};}}
  else if(room.world==='jake'){if(b.type==='bailey'&&!pg.baileyDefeated){pg.baileyDefeated=true;setTimeout(()=>rooms.has(room.code)&&room.world==='jake'&&spawnBoss(room,'vittala'),700);}else if(b.type==='vittala'&&!pg.vittalaDefeated){pg.vittalaDefeated=true;setTimeout(()=>rooms.has(room.code)&&room.world==='jake'&&spawnBoss(room,'eviljek'),700);}else if(b.type==='eviljek'&&!pg.eviljekDefeated){pg.eviljekDefeated=true;pg.jakeUniverseWon=true;room.portal={x:200,y:WORLDS[room.world].h/2,r:28,dest:'hyper'};}}
  else if(room.world==='hyper'){if(b.type==='hawking'&&!pg.hawkDefeated){pg.hawkDefeated=true;setTimeout(()=>rooms.has(room.code)&&room.world==='hyper'&&spawnBoss(room,'epstein'),700);}else if(b.type==='epstein'&&!pg.epsteinDefeated){pg.epsteinDefeated=true;setTimeout(()=>rooms.has(room.code)&&room.world==='hyper'&&spawnBoss(room,'omega'),700);}else if(b.type==='omega'&&!pg.omegaDefeated){pg.omegaDefeated=true;pg.hyperWon=true;}}
}
function progression(room){
  const p=room.progression;
  if(room.world==='main'){if(room.kills>=12&&!p.dictatorDefeated&&!room.bosses.some(b=>b.type==='dictator'))spawnBoss(room,'dictator');if(p.jakeDefeated&&p.challengeKeyBought&&!p.finalSpawned&&!p.won){p.finalSpawned=true;p.challengeKeyBought=false;spawnBoss(room,'final');}if(p.finalSpawned&&!p.won){if(!room.bosses.some(b=>b.type==='final')){p.won=true;for(const q of room.players.values())q.coins+=250;room.portal={x:200,y:WORLDS.main.h/2,r:28,dest:'universe'};}}}
  if(room.world==='universe'&&room.kills>=8&&!p.stickDefeated&&!room.bosses.length)spawnBoss(room,'stick');
  if(room.world==='jake'&&room.kills>=8&&!p.baileyDefeated&&!room.bosses.length)spawnBoss(room,'bailey');
  if(room.world==='hyper'&&room.kills>=8&&!p.hawkDefeated&&!room.bosses.length)spawnBoss(room,'hawking');
}

function updateMinions(room,dt){for(let i=room.minions.length-1;i>=0;i--){const m=room.minions[i];m.life-=dt;if(m.life<=0||m.hp<=0){room.minions.splice(i,1);continue;}let target=null,d=Infinity;for(const e of room.enemies){const dd=dist(m,e);if(dd<d){d=dd;target=e;}}for(const b of room.bosses){const dd=dist(m,b);if(dd<d){d=dd;target=b;}}if(!target)continue;const a=Math.atan2(target.y-m.y,target.x-m.x);moveCircle(room,m,Math.cos(a)*m.speed*dt,Math.sin(a)*m.speed*dt);if(d<target.r+m.r+8){if(room.bosses.includes(target))damageBoss(room,target,m.dmg*dt,m.ownerId);else damageEnemy(room,target,m.dmg*dt,m.ownerId);}}
}
function updateBullets(room,dt){for(let i=room.bullets.length-1;i>=0;i--){const b=room.bullets[i];b.life-=dt;if(b.life<=0){room.bullets.splice(i,1);continue;}b.x+=b.vx*dt;b.y+=b.vy*dt; if(b.x<0||b.y<0||b.x>WORLDS[room.world].w||b.y>WORLDS[room.world].h||room.obstacles.some(o=>o.solid&&b.x>=o.x&&b.x<=o.x+o.w&&b.y>=o.y&&b.y<=o.y+o.h)){room.bullets.splice(i,1);continue;}if(b.owner==='enemy'||b.owner==='boss'){for(const p of room.players.values())if(p.alive&&dist(b,p)<p.r+b.r){damagePlayer(p,b.dmg,room);room.bullets.splice(i,1);break;}}}}

function updateWorld(room,dt){
  room.spawnTimer-=dt;if(room.spawnTimer<=0){const maxM=room.world==='hyper'?24:room.world==='jake'?22:room.world==='universe'?20:16;if(room.enemies.length<Math.min(maxM,5+Math.floor(room.kills/3)))spawnRandomEnemy(room);const base=room.world==='hyper'?1.15:room.world==='jake'?1.3:room.world==='universe'?1.45:2.3;room.spawnTimer=Math.max(.45,base-room.kills*.028);}
  updatePlayers(room,dt);updateEnemies(room,dt);updateBosses(room,dt);updateMinions(room,dt);updateBullets(room,dt);progression(room);
  for(const fx of room.events)fx.ttl-=dt;room.events=room.events.filter(e=>e.ttl>0);
  if(room.orbs.length<20)spawnOrb(room);
}

function buy(room,p,type){
  const price=p.prices[type]; if(price==null||p.coins<price)return false;
  if(type==='key'){if(room.world!=='main'||!room.progression.jakeDefeated||room.progression.finalSpawned)return false;p.coins-=price;room.progression.challengeKeyBought=true;p.prices.key=Math.ceil(price*1.32);return true;}
  p.coins-=price;
  if(type==='speed')p.speed+=24;if(type==='power')p.stats.roarPower+=18;if(type==='cd')p.stats.roarCdMax=Math.max(.65,p.stats.roarCdMax-.32);if(type==='shield')p.shield+=32;
  if(type==='maxhp'){p.maxHp+=25;p.hp+=25;}if(type==='range')p.stats.roarRange+=28;if(type==='magnet')p.stats.magnet=p.stats.magnet? p.stats.magnet+40:110;if(type==='armor')p.stats.dmgReduce=Math.min(.35,p.stats.dmgReduce+.08);
  if(type==='slashDmg'){p.stats.slashPower+=.35;p.stats.slashUnlocked=true;}if(type==='slashCdUp'){p.stats.slashCdMax=Math.max(1.8,p.stats.slashCdMax-.45);p.stats.slashUnlocked=true;}if(type==='slashRange'){p.stats.slashRange+=22;p.stats.slashUnlocked=true;}
  if(type==='minionCount'){p.stats.minionCount+=1;p.stats.minionUnlocked=true;}if(type==='minionDmg'){p.stats.minionDmg+=15;p.stats.minionUnlocked=true;}if(type==='minionCdUp'){p.stats.minionCdMax=Math.max(2.5,p.stats.minionCdMax-.9);p.stats.minionUnlocked=true;}
  if(type==='hyperDmg'){p.stats.hyperPower+=.4;p.stats.hyperUnlocked=true;}if(type==='hyperCdUp'){p.stats.hyperCdMax=Math.max(2,p.stats.hyperCdMax-.6);p.stats.hyperUnlocked=true;}
  p.prices[type]=Math.ceil(price*1.32); return true;
}

function snapshot(room) {
  return {
    t:Date.now(),code:room.code,started:room.started,world:room.world,worldSize:WORLDS[room.world],kills:room.kills,
    progression:room.progression,portal:room.portal,
    players:[...room.players.values()].map(p=>({id:p.id,slot:p.slot,name:p.name,color:p.color,x:p.x,y:p.y,r:p.r,hp:p.hp,maxHp:p.maxHp,shield:p.shield,alive:p.alive,coins:p.coins,kills:p.kills,ack:p.ackSeq,speed:p.speed,stats:p.stats,cds:p.cds,prices:p.prices})),
    enemies:room.enemies.map(e=>({id:e.id,x:e.x,y:e.y,r:e.r,hp:e.hp,maxHp:e.maxHp,type:e.type})),
    bosses:room.bosses.map(b=>({id:b.id,type:b.type,name:b.name,x:b.x,y:b.y,r:b.r,hp:b.hp,maxHp:b.maxHp,rage:b.rage,rolling:b.rolling})),
    orbs:room.orbs.map(o=>({id:o.id,x:o.x,y:o.y,r:o.r,value:o.value})),
    obstacles:room.obstacles.map(o=>({x:o.x,y:o.y,w:o.w,h:o.h,hp:o.hp,solid:o.solid,breakable:o.breakable})),
    minions:room.minions.map(m=>({id:m.id,ownerId:m.ownerId,x:m.x,y:m.y,r:m.r,hp:m.hp,maxHp:m.maxHp})),
    bullets:room.bullets.map(b=>({x:b.x,y:b.y,r:b.r})), effects:room.events
  };
}

function send(ws,obj){if(ws.readyState===1)ws.send(JSON.stringify(obj));}
function broadcast(room,obj){for(const p of room.players.values())send(p.ws,obj);}

function setupMessage(room,p,raw){
  let msg;try{msg=JSON.parse(raw)}catch{return;}
  if(msg.t==='profile'){p.name=safeName(msg.name);p.color=safeColor(msg.color);return;}
  if(msg.t==='start'&&p.slot===0){room.started=true;room.solo=false;broadcast(room,{t:'started'});return;}
  if(msg.t==='input'){p.input={up:!!msg.up,down:!!msg.down,left:!!msg.left,right:!!msg.right};p.aimX=Number(msg.aimX)||p.aimX;p.aimY=Number(msg.aimY)||p.aimY;p.seq=Number(msg.seq)||p.seq;p.lastInputAt=Date.now();return;}
  if(msg.t==='action'){p.aimX=Number(msg.aimX)||p.aimX;p.aimY=Number(msg.aimY)||p.aimY;hitAbility(room,p,msg.action);return;}
  if(msg.t==='buy'){buy(room,p,String(msg.item));return;}
  if(msg.t==='mod'){
    const a=String(msg.action||'');
    if(a==='coins')p.coins+=500;
    else if(a==='heal')p.hp=p.maxHp;
    else if(a==='shield')p.shield+=500;
    else if(a==='speed')p.speed=500;
    else if(a==='roar'){p.stats.roarPower=250;p.stats.roarCdMax=.3;}
    else if(a==='slash'){p.stats.slashUnlocked=true;p.stats.slashPower=3;p.stats.slashCdMax=1.5;p.stats.slashRange+=50;}
    else if(a==='minions'){p.stats.minionUnlocked=true;p.stats.minionCount=12;p.stats.minionDmg=120;p.stats.minionCdMax=2;}
    else if(a==='beam'){p.stats.hyperUnlocked=true;p.stats.hyperPower=5;p.stats.hyperCdMax=1;}
    else if(a==='necro'){p.stats.necroUnlocked=true;p.stats.necroActive=true;p.stats.necroChance=1;}
    else if(a==='cool'){for(const k of Object.keys(p.cds))p.cds[k]=0;}
    return;
  }
}

function joinRoom(room,p,ws){p.ws=ws;room.players.set(p.id,p);if(room.players.size===1)room.host=p.id;send(ws,{t:'joined',id:p.id,slot:p.slot,code:room.code,host:room.host===p.id,started:room.started,max:MAX_PLAYERS});broadcast(room,{t:'lobby',count:room.players.size,max:MAX_PLAYERS,started:room.started,code:room.code});}

const server=http.createServer((req,res)=>{
  let file=req.url==='/'?'/game.html':req.url;
  if(file!=='/game.html')return res.writeHead(404).end('Not found');
  const fp=path.join(__dirname,'game.html');
  fs.readFile(fp,(err,data)=>{if(err){res.writeHead(500).end('Game file missing');return;}res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(data);});
});
const wss=new WebSocketServer({server});
wss.on('connection',(ws)=>{
  let attached=null, player=null;
  ws.on('message',(data)=>{
    let msg;try{msg=JSON.parse(data)}catch{return;}
    if(msg.t==='create'){
      if(attached)return;const code=roomCode();const room=createRoom(code,!!msg.solo);player=newPlayer(0,msg.name,msg.color);joinRoom(room,player,ws);attached=room;room.started=!!msg.solo;seedOrbs(room,28);send(ws,{t:'room',role:'host',code,max:MAX_PLAYERS,started:room.started});return;
    }
    if(msg.t==='join'){
      if(attached)return;const room=rooms.get(String(msg.code||'').toUpperCase());if(!room||room.players.size>=MAX_PLAYERS){send(ws,{t:'error',message:'Room unavailable'});return;}const slot=[0,1,2,3].find(s=>![...room.players.values()].some(p=>p.slot===s));player=newPlayer(slot,msg.name,msg.color);joinRoom(room,player,ws);attached=room;send(ws,{t:'room',role:'client',code:room.code,max:MAX_PLAYERS,started:room.started});return;
    }
    if(attached&&player)setupMessage(attached,player,data.toString());
  });
  ws.on('close',()=>{if(!attached||!player)return;attached.players.delete(player.id);if(attached.players.size===0){rooms.delete(attached.code);return;}if(attached.host===player.id){const next=[...attached.players.values()].sort((a,b)=>a.slot-b.slot)[0];attached.host=next.id;send(next.ws,{t:'host',code:attached.code});}});
});

let accumulator=0,last=Date.now();
setInterval(()=>{const now=Date.now(),dt=Math.min(.05,(now-last)/1000);last=now;accumulator+=dt;while(accumulator>=1/60){for(const room of rooms.values())if(room.started)updateWorld(room,1/60);accumulator-=1/60;}for(const room of rooms.values()){if(now-room.lastBroadcast<SNAPSHOT_MS)continue;room.lastBroadcast=now;broadcast(room,{t:'state',state:snapshot(room)});}},10);

server.listen(PORT,HOST,()=>console.log(`Milo Monster rebuilt running on http://${HOST}:${PORT}`));
