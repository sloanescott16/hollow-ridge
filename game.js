// Hollow Ridge: a turn-based sniper duel played like Battleship.
(function () {
  "use strict";

  // ---------- seeded random ----------
  const params = new URLSearchParams(location.search);
  let seed = parseInt(params.get("seed") || "", 10);
  if (!Number.isFinite(seed)) seed = (Date.now() ^ (Math.random() * 1e9)) >>> 0;
  function rnd() { // mulberry32
    seed = (seed + 0x6D2B79F5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const pick = (a) => a[Math.floor(rnd() * a.length)];

  // ---------- content ----------
  const COLS = 5;
  const LEVELS = [
    { name: "Dry Creek",   enemies: 1, rows: 3, aim: 2.6, ammo: 8,  chip: 0,    move: 0 },
    { name: "Mill Row",    enemies: 2, rows: 3, aim: 2.3, ammo: 10, chip: 0.25, move: 0 },
    { name: "Signal Hill", enemies: 2, rows: 3, aim: 2.0, ammo: 10, chip: 0.4,  move: 0 },
    { name: "Salt Pan",    enemies: 3, rows: 4, aim: 1.8, ammo: 13, chip: 0.4,  move: 0.3 },
    { name: "Cinder Yard", enemies: 3, rows: 4, aim: 1.6, ammo: 13, chip: 0.5,  move: 0.4 },
    { name: "Last Light",  enemies: 4, rows: 4, aim: 1.4, ammo: 15, chip: 0.5,  move: 0.5 },
  ];
  const CHARS = [
    { id: "rook", name: "Rook", note: "Steady all-rounder.", unlock: 0 },
    { id: "juno", name: "Juno", note: "Calm breath: enemy aim takes 0.3 s longer.", unlock: 1 },
    { id: "pike", name: "Pike", note: "Tough: one extra health.", unlock: 4 },
  ];
  const RIFLES = [
    { id: "iron", name: "Field Iron", note: "Plain and reliable.", unlock: 0 },
    { id: "long", name: "Longreach", note: "Two extra rounds per valley.", unlock: 2 },
    { id: "hush", name: "Hush", note: "Suppressed: a hit does not give your cover away.", unlock: 3 },
  ];
  const UPGRADES = [
    { id: "steady", name: "Steady hands", note: "Enemy aim takes 0.2 s longer per level.", max: 3, cost: [20, 40, 60] },
    { id: "vest", name: "Padded vest", note: "One extra health.", max: 1, cost: [50] },
    { id: "glass", name: "Clean glass", note: "Spot enemy glints more often.", max: 2, cost: [25, 50] },
  ];
  // Each cover sees a band of columns.
  const VIEW = [[0, 1, 2], [1, 2, 3], [2, 3, 4]];
  const COVER_NAMES = ["Left", "Middle", "Right"];

  // ---------- save ----------
  const SAVE_KEY = "hollowridge.v1";
  const blank = () => ({ cleared: 0, marks: 0, best: {}, char: "rook", rifle: "iron", upg: {}, sound: false });
  let save = blank();
  try { const s = JSON.parse(localStorage.getItem(SAVE_KEY) || "null"); if (s) save = Object.assign(blank(), s); } catch (e) { save = blank(); }
  if (params.get("fresh") === "1") save = blank();
  function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* storage full or blocked */ } }

  // ---------- sound (off by default, made only on demand) ----------
  let actx = null;
  function beep(freq, dur, type, vol) {
    if (!save.sound) return;
    try {
      if (!actx) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; actx = new AC(); }
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type || "square"; o.frequency.value = freq;
      g.gain.value = vol || 0.05;
      g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
      o.connect(g); g.connect(actx.destination); o.start(); o.stop(actx.currentTime + dur);
    } catch (e) { /* no audio */ }
  }
  const sfx = {
    shot: () => beep(140, 0.25, "sawtooth", 0.08),
    hit: () => beep(70, 0.4, "square", 0.08),
    hurt: () => beep(220, 0.35, "triangle", 0.1),
    tick: () => beep(900, 0.05, "square", 0.03),
  };

  // ---------- dom ----------
  const $ = (id) => document.getElementById(id);
  const canvas = $("field"), ctx = canvas.getContext("2d");
  function show(id) {
    document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.id === id));
    if (id === "scr-title") $("marks-title").textContent = save.marks;
    if (id === "scr-levels") renderLevels();
    if (id === "scr-armoury") renderArmoury();
    if (id === "scr-game") resize();
  }
  document.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => show(b.dataset.go)));
  $("btn-play").onclick = () => show("scr-levels");
  $("btn-armoury").onclick = () => show("scr-armoury");
  $("btn-how").onclick = () => show("scr-how");
  function soundLabel() { $("btn-sound").textContent = "Sound: " + (save.sound ? "on" : "off"); }
  $("btn-sound").onclick = () => { save.sound = !save.sound; persist(); soundLabel(); sfx.tick(); };
  soundLabel();
  $("btn-quit").onclick = () => { G = null; show("scr-levels"); };

  function renderLevels() {
    const list = $("level-list"); list.innerHTML = "";
    LEVELS.forEach((L, i) => {
      const b = document.createElement("button");
      b.className = "lvl"; b.id = "lvl-" + (i + 1);
      const open = i <= save.cleared;
      b.disabled = !open;
      const best = save.best[i + 1];
      b.innerHTML = `<span><b>${i + 1}. ${L.name}</b><small>${L.enemies} shooter${L.enemies > 1 ? "s" : ""}, ${open ? "aim " + L.aim.toFixed(1) + " s" : "locked"}</small></span><span class="star">${best ? "Cleared" : ""}</span>`;
      b.onclick = () => startLevel(i + 1);
      list.appendChild(b);
    });
  }
  function renderArmoury() {
    $("marks-arm").textContent = save.marks;
    const mk = (arr, key, el) => {
      el.innerHTML = "";
      arr.forEach((it) => {
        const b = document.createElement("button");
        const open = save.cleared >= it.unlock;
        b.className = "item" + (save[key] === it.id ? " on" : "");
        b.id = key + "-" + it.id;
        b.disabled = !open;
        b.innerHTML = `<b>${it.name}</b><small>${open ? it.note : "Clear valley " + it.unlock + " to unlock."}</small>`;
        b.onclick = () => { save[key] = it.id; persist(); renderArmoury(); };
        el.appendChild(b);
      });
    };
    mk(CHARS, "char", $("char-list"));
    mk(RIFLES, "rifle", $("rifle-list"));
    const ul = $("upg-list"); ul.innerHTML = "";
    UPGRADES.forEach((u) => {
      const lv = save.upg[u.id] || 0;
      const row = document.createElement("div"); row.className = "upg";
      const cost = lv < u.max ? u.cost[lv] : null;
      row.innerHTML = `<span><b>${u.name} ${lv}/${u.max}</b><small>${u.note}</small></span>`;
      const b = document.createElement("button"); b.id = "upg-" + u.id;
      b.textContent = cost == null ? "Full" : cost + " marks";
      b.disabled = cost == null || save.marks < cost;
      b.onclick = () => { if (cost != null && save.marks >= cost) { save.marks -= cost; save.upg[u.id] = lv + 1; persist(); renderArmoury(); } };
      row.appendChild(b); ul.appendChild(row);
    });
  }

  // ---------- game state ----------
  let G = null;
  const key = (c, r) => c + "," + r;

  function startLevel(n) {
    const L = LEVELS[n - 1];
    const spots = [];
    for (let r = 0; r < L.rows; r++) for (let c = 0; c < COLS; c++) spots.push([c, r]);
    const enemies = [];
    while (enemies.length < L.enemies) {
      const [c, r] = pick(spots);
      if (!enemies.some((e) => e.c === c && e.r === r)) enemies.push({ c, r, alive: true, fall: 0 });
    }
    const hpMax = 3 + (save.upg.vest || 0) + (save.char === "pike" ? 1 : 0);
    G = {
      n, L, rows: L.rows, enemies, marks: {}, glints: [], fx: [],
      cover: 1, coverHp: [3, 3, 3], hp: hpMax, hpMax,
      ammo: L.ammo + (save.rifle === "long" ? 2 : 0), shots: 0, hits: 0,
      phase: "idle", aim: 0, aimTime: L.aim + 0.2 * (save.upg.steady || 0) + (save.char === "juno" ? 0.3 : 0),
      known: null, pointer: null, last: 0, over: null,
    };
    $("overlay").classList.add("hidden");
    show("scr-game");
    say(`${L.name}. ${L.enemies} shooter${L.enemies > 1 ? "s" : ""} out there. Hold on the valley to lean out.`);
    hud();
  }

  function say(t) { $("msg").textContent = t; }
  function hud() {
    if (!G) return;
    $("hud-level").textContent = `Valley ${G.n}: ${G.L.name}`;
    $("hud-hp").textContent = "♥".repeat(G.hp) + "♡".repeat(Math.max(0, G.hpMax - G.hp));
    $("hud-ammo").textContent = G.ammo + " rds";
    document.querySelectorAll(".cover").forEach((b) => {
      const i = +b.dataset.i;
      b.classList.toggle("here", i === G.cover);
      b.classList.toggle("broken", G.coverHp[i] <= 0);
      b.querySelector(".pips").textContent = G.coverHp[i] <= 0 ? "broken" : "■".repeat(G.coverHp[i]) + "□".repeat(3 - G.coverHp[i]);
      b.disabled = G.phase !== "idle";
    });
    const pct = Math.min(1, G.aim);
    $("aimfill").style.width = (pct * 100).toFixed(1) + "%";
    const bar = $("aimbar");
    bar.classList.toggle("warn", pct >= 0.5 && pct < 0.75);
    bar.classList.toggle("danger", pct >= 0.75);
    let label = "Enemy aim";
    if (G.phase === "peek") label = pct >= 0.75 ? "DUCK!" : pct >= 0.5 ? "They are lining up" : "Leaning out";
    else if (G.phase === "enemy") label = "Enemy turn";
    else if (G.known === G.cover) label = "They saw your flash here";
    $("aimlabel").textContent = label;
  }
  const inView = (c) => VIEW[G.cover].includes(c);
  function headStart() {
    let h = 0;
    if (G.known === G.cover) h += 0.35;
    if (G.coverHp[G.cover] <= 0) h += 0.25;
    return h;
  }

  // ---------- layout of spots on the canvas ----------
  let W = 0, H = 0, DPR = 1;
  function resize() {
    const r = canvas.getBoundingClientRect();
    DPR = Math.min(3, window.devicePixelRatio || 1);
    W = r.width; H = r.height;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
  }
  window.addEventListener("resize", resize);
  function spotXY(c, r) {
    // far rows at top, smaller and closer together.
    const rows = G.rows;
    const t = rows === 1 ? 1 : r / (rows - 1);   // 0 far, 1 near
    const y = H * (0.2 + 0.62 * t);
    const spread = 0.62 + 0.34 * t;
    const x = W / 2 + (c - (COLS - 1) / 2) * (W * spread / (COLS - 1)) * 0.95;
    const s = 14 + 14 * t;
    return { x, y, s };
  }
  function spotAt(px, py) {
    let best = null, bd = 1e9;
    for (let r = 0; r < G.rows; r++) for (let c = 0; c < COLS; c++) {
      const p = spotXY(c, r); const d = Math.hypot(px - p.x, py - p.y);
      if (d < p.s * 2.2 && d < bd) { bd = d; best = { c, r }; }
    }
    return best;
  }

  // ---------- input ----------
  function localXY(e) { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  canvas.addEventListener("pointerdown", (e) => {
    if (!G || G.phase !== "idle") return;
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* fine */ }
    G.phase = "peek"; G.aim = headStart(); G.pointer = localXY(e); G.peekId = e.pointerId;
    say("You are out. Drag to a spot, release to fire. Release off the spots to duck.");
    hud();
  });
  canvas.addEventListener("pointermove", (e) => { if (G && G.phase === "peek" && e.pointerId === G.peekId) G.pointer = localXY(e); });
  function release(e) {
    if (!G || G.phase !== "peek" || e.pointerId !== G.peekId) return;
    const p = localXY(e);
    const inside = p.x >= 0 && p.y >= 0 && p.x <= W && p.y <= H;
    const s = inside ? spotAt(p.x, p.y) : null;
    G.phase = "busy"; G.pointer = null;
    if (s && inView(s.c)) fire(s.c, s.r);
    else { G.carry = s ? "Out of view from this cover. You duck back." : "You duck back into cover."; say(G.carry); endPlayerTurn(); }
  }
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
  document.querySelectorAll(".cover").forEach((b) => b.addEventListener("click", () => {
    if (!G || G.phase !== "idle") return;
    const i = +b.dataset.i; if (i === G.cover) return;
    G.cover = i; G.phase = "busy";
    G.carry = `You crawl to the ${COVER_NAMES[i]} cover.`; say(G.carry);
    hud(); endPlayerTurn();
  }));

  // ---------- actions ----------
  function addFx(c, r, kind) { const p = spotXY(c, r); G.fx.push({ x: p.x, y: p.y, kind, t: 0 }); }
  function fire(c, r) {
    G.ammo--; G.shots++; sfx.shot();
    const e = G.enemies.find((q) => q.alive && q.c === c && q.r === r);
    if (e) {
      e.alive = false; e.fall = 0.001; G.marks[key(c, r)] = "down"; G.hits++;
      addFx(c, r, "boom"); sfx.hit();
      const left = G.enemies.filter((q) => q.alive).length;
      let shout = "";
      if (left) { const sv = pick(G.enemies.filter((q) => q.alive)); shout = sv.c < 2 ? " A startled shout from the left." : sv.c > 2 ? " A startled shout from the right." : " A startled shout from the middle."; }
      G.carry = left ? `Hit! One down, ${left} to go.${shout}` : "Hit! The valley goes quiet.";
      say(G.carry);
      if (save.rifle !== "hush") G.known = G.cover;
      if (!left) return finish(true);
    } else {
      const warm = G.enemies.some((q) => q.alive && Math.abs(q.c - c) <= 1 && Math.abs(q.r - r) <= 1);
      G.marks[key(c, r)] = warm ? "warm" : "cold";
      addFx(c, r, "puff");
      G.carry = warm ? "Miss. Warm: someone is right next to that spot." : "Miss. Cold: nobody there or next to it.";
      say(G.carry);
      G.known = G.cover;
    }
    if (G.ammo <= 0) return finish(false, "Out of rounds.");
    endPlayerTurn();
  }
  function shotAtPlayer() {
    // The enemy that fired is the nearest living one; its flash is seen even through fog.
    const alive = G.enemies.filter((q) => q.alive);
    const coverCol = [1, 2, 3][G.cover];
    alive.sort((a, b) => Math.abs(a.c - coverCol) - Math.abs(b.c - coverCol) || b.r - a.r);
    const e = alive[0];
    G.marks[key(e.c, e.r)] = "flash"; addFx(e.c, e.r, "flash");
    G.hp--; sfx.hurt(); flashHurt = 1;
    G.known = G.cover;
    if (G.hp <= 0) return finish(false, "You were hit one time too many.");
    G.carry = "You are hit! You stayed out too long. Their muzzle flash is marked.";
    say(G.carry);
    endPlayerTurn(true);
  }
  function endPlayerTurn(wasHit) {
    G.phase = "enemy"; G.aim = 0; hud();
    setTimeout(enemyTurn, wasHit ? 1100 : 700);
  }
  function enemyTurn() {
    if (!G || G.over) return;
    const L = G.L; const notes = [];
    G.enemies.forEach((e) => {
      if (!e.alive) return;
      // relocation when its spot is suspected
      const k = key(e.c, e.r);
      const suspected = G.marks[k] === "flash" || G.marks[k] === "glint" || neighbourMarked(e.c, e.r);
      if (L.move && suspected && rnd() < L.move) {
        const opts = [];
        for (let dc = -1; dc <= 1; dc++) for (let dr = -1; dr <= 1; dr++) {
          const c = e.c + dc, r = e.r + dr;
          if ((dc || dr) && c >= 0 && c < COLS && r >= 0 && r < G.rows && !G.enemies.some((q) => q.alive && q.c === c && q.r === r) && G.marks[key(c, r)] !== "down") opts.push([c, r]);
        }
        if (opts.length) {
          const [c, r] = pick(opts);
          if (G.marks[k] === "flash" || G.marks[k] === "glint") G.marks[k] = "stale";
          e.c = c; e.r = r; notes.push("You hear movement in the rocks.");
        }
        return;
      }
      if (L.chip && rnd() < L.chip) {
        const target = G.known != null ? G.known : Math.floor(rnd() * 3);
        G.marks[key(e.c, e.r)] = "flash"; addFx(e.c, e.r, "flash");
        if (target === G.cover) {
          if (G.coverHp[G.cover] <= 0) { G.hp--; flashHurt = 1; sfx.hurt(); notes.push("A round finds you through the broken cover."); }
          else { G.coverHp[G.cover]--; notes.push(G.coverHp[G.cover] <= 0 ? "Your cover is shot to pieces. Move!" : "A round chips your cover. Flash marked."); }
        } else notes.push(`A round hits the ${COVER_NAMES[target]} cover. Flash marked.`);
      }
    });
    if (G.hp <= 0) return finish(false, "You were hit one time too many.");
    G.phase = "idle";
    say([G.carry || "", notes.length ? [...new Set(notes)].join(" ") : "Your turn."].join(" ").trim());
    G.carry = "";
    hud();
  }
  function neighbourMarked(c, r) {
    for (let dc = -1; dc <= 1; dc++) for (let dr = -1; dr <= 1; dr++) if (G.marks[key(c + dc, r + dr)] === "warm") return true;
    return false;
  }
  function finish(won, why) {
    G.over = won ? "won" : "lost"; G.phase = "over"; G.aim = 0; hud();
    let body;
    if (won) {
      const earned = 10 + 5 * G.n + 2 * G.ammo + (G.hp === G.hpMax ? 5 : 0);
      save.marks += earned;
      const firstClear = G.n > save.cleared;
      if (firstClear) save.cleared = G.n;
      save.best[G.n] = Math.min(save.best[G.n] || 99, G.shots);
      persist();
      body = `${G.shots} shot${G.shots > 1 ? "s" : ""} fired. +${earned} marks.`;
      if (firstClear) {
        const un = [...CHARS, ...RIFLES].filter((x) => x.unlock === G.n).map((x) => x.name);
        if (un.length) body += ` Unlocked: ${un.join(", ")}. Pick it in the Armoury.`;
      }
    } else body = why || "You lost.";
    setTimeout(() => {
      $("ov-title").textContent = won ? "Valley cleared" : "You are down";
      $("ov-body").textContent = body;
      $("ov-next").style.display = won && G.n < LEVELS.length ? "" : "none";
      $("overlay").classList.remove("hidden");
    }, 900);
  }
  $("ov-next").onclick = () => startLevel(G.n + 1);
  $("ov-retry").onclick = () => startLevel(G.n);
  $("ov-menu").onclick = () => { $("overlay").classList.add("hidden"); G = null; show("scr-levels"); };

  // ---------- loop and drawing ----------
  let flashHurt = 0;
  function tick(now) {
    const dt = Math.min(0.1, (now - (tick.last || now)) / 1000); tick.last = now;
    if (G) {
      if (G.phase === "peek") {
        G.aim += dt / G.aimTime;
        // glints from enemies in view
        const rate = 0.55 * (1 + 0.25 * (save.upg.glass || 0));
        G.enemies.forEach((e) => {
          if (e.alive && inView(e.c) && rnd() < rate * dt) {
            G.glints.push({ c: e.c, r: e.r, t: 0 });
            if (G.marks[key(e.c, e.r)] !== "flash") G.marks[key(e.c, e.r)] = "glint";
          }
        });
        if (G.aim >= 1) { G.phase = "busy"; G.pointer = null; shotAtPlayer(); }
        hud();
      }
      G.glints.forEach((g) => (g.t += dt)); G.glints = G.glints.filter((g) => g.t < 0.6);
      G.fx.forEach((f) => (f.t += dt)); G.fx = G.fx.filter((f) => f.t < 1.2);
      G.enemies.forEach((e) => { if (e.fall > 0 && e.fall < 1) e.fall = Math.min(1, e.fall + dt * 2); });
      flashHurt = Math.max(0, flashHurt - dt * 1.5);
      draw();
    }
    requestAnimationFrame(tick);
  }
  function draw() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const out = G.phase === "peek";
    // sky and ridges
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#2a3550"); sky.addColorStop(0.5, "#6b5a4a"); sky.addColorStop(1, "#3c3326");
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#4a3f33";
    ctx.beginPath(); ctx.moveTo(0, H * 0.22);
    for (let i = 0; i <= 10; i++) ctx.lineTo(W * i / 10, H * (0.14 + 0.05 * Math.sin(i * 1.7 + G.n)));
    ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.fill();
    ctx.fillStyle = "#5a4c3b";
    ctx.beginPath(); ctx.moveTo(0, H * 0.5);
    for (let i = 0; i <= 8; i++) ctx.lineTo(W * i / 8, H * (0.45 + 0.04 * Math.cos(i * 2.1 + G.n)));
    ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.fill();
    // fog over columns out of view
    for (let c = 0; c < COLS; c++) {
      if (inView(c)) continue;
      const a = spotXY(c, 0), b = spotXY(c, G.rows - 1);
      const half = (W * 0.96 / (COLS - 1)) / 2;
      ctx.fillStyle = "rgba(14,17,24,0.68)";
      ctx.beginPath();
      ctx.moveTo(a.x - half * 0.66, 0); ctx.lineTo(a.x + half * 0.66, 0);
      ctx.lineTo(b.x + half, H); ctx.lineTo(b.x - half, H); ctx.fill();
    }
    // spots
    for (let r = 0; r < G.rows; r++) for (let c = 0; c < COLS; c++) {
      const p = spotXY(c, r), vis = inView(c);
      // rock or ruin shape, varied by position
      ctx.fillStyle = vis ? ((c + r) % 2 ? "#776652" : "#6d5d4c") : "#3a3630";
      ctx.beginPath();
      ctx.moveTo(p.x - p.s * 1.4, p.y + p.s * 0.6);
      ctx.lineTo(p.x - p.s * 1.0, p.y - p.s * 0.5);
      ctx.lineTo(p.x - p.s * 0.2, p.y - p.s * (0.8 + ((c * 3 + r) % 3) * 0.15));
      ctx.lineTo(p.x + p.s * 0.9, p.y - p.s * 0.45);
      ctx.lineTo(p.x + p.s * 1.4, p.y + p.s * 0.6);
      ctx.closePath(); ctx.fill();
      const m = G.marks[key(c, r)];
      if (m) drawMark(p, m);
    }
    // fallen enemies
    G.enemies.forEach((e) => { if (!e.alive) drawFallen(spotXY(e.c, e.r), e.fall); });
    // glints
    G.glints.forEach((g) => {
      const p = spotXY(g.c, g.r), k = 1 - g.t / 0.6;
      ctx.save(); ctx.translate(p.x, p.y - p.s * 0.3); ctx.globalAlpha = k;
      ctx.strokeStyle = "#fffbe0"; ctx.lineWidth = 2;
      const L = p.s * (0.8 + k);
      ctx.beginPath(); ctx.moveTo(-L, 0); ctx.lineTo(L, 0); ctx.moveTo(0, -L); ctx.lineTo(0, L); ctx.stroke();
      ctx.restore();
    });
    // effects
    G.fx.forEach((f) => {
      const k = f.t / 1.2;
      ctx.save(); ctx.globalAlpha = 1 - k;
      if (f.kind === "boom") {
        for (let i = 0; i < 7; i++) {
          const a = i * 0.9, d = 6 + 30 * k;
          ctx.fillStyle = i % 2 ? "#ffb347" : "#ff6b3d";
          ctx.beginPath(); ctx.arc(f.x + Math.cos(a) * d, f.y - 6 + Math.sin(a) * d * 0.7, 8 * (1 - k) + 3, 0, 7); ctx.fill();
        }
        ctx.fillStyle = "#fff"; ctx.font = "bold 16px sans-serif"; ctx.textAlign = "center";
        ctx.fillText("HIT", f.x, f.y - 26 - 20 * k);
      } else if (f.kind === "puff") {
        ctx.fillStyle = "#cfc6b5";
        for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(f.x + (i - 1.5) * 7 * (1 + k), f.y - 4 - 14 * k, 6 + 6 * k, 0, 7); ctx.fill(); }
      } else if (f.kind === "flash") {
        ctx.fillStyle = "#ffe066";
        ctx.beginPath(); ctx.arc(f.x, f.y - 4, 14 * (1 - k) + 4, 0, 7); ctx.fill();
      }
      ctx.restore();
    });
    // peeking: scope ring and aim marker
    if (out && G.pointer) {
      const s = spotAt(G.pointer.x, G.pointer.y);
      ctx.strokeStyle = s && inView(s.c) ? "#ff5a4a" : "rgba(255,255,255,0.6)";
      ctx.lineWidth = 2;
      const px = s ? spotXY(s.c, s.r).x : G.pointer.x, py = s ? spotXY(s.c, s.r).y : G.pointer.y;
      ctx.beginPath(); ctx.arc(px, py, 22, 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(px - 30, py); ctx.lineTo(px + 30, py); ctx.moveTo(px, py - 30); ctx.lineTo(px, py + 30); ctx.stroke();
    }
    // your cover in the foreground
    drawCover(out);
    if (flashHurt > 0) { ctx.fillStyle = `rgba(200,30,20,${0.45 * flashHurt})`; ctx.fillRect(0, 0, W, H); }
  }
  function drawMark(p, m) {
    ctx.save(); ctx.lineWidth = 2.5; ctx.font = "bold 11px sans-serif"; ctx.textAlign = "center";
    if (m === "cold") { ctx.strokeStyle = "#6fb3ff"; ctx.beginPath(); ctx.arc(p.x, p.y, p.s * 1.1, 0, 7); ctx.stroke(); ctx.fillStyle = "#6fb3ff"; ctx.fillText("cold", p.x, p.y + p.s * 1.1 + 11); }
    else if (m === "warm") { ctx.strokeStyle = "#ff9a3c"; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.arc(p.x, p.y, p.s * 1.25, 0, 7); ctx.stroke(); ctx.fillStyle = "#ff9a3c"; ctx.fillText("warm", p.x, p.y + p.s * 1.25 + 11); }
    else if (m === "flash" || m === "glint") {
      ctx.fillStyle = m === "flash" ? "#ffe066" : "#e8f6ff";
      ctx.beginPath();
      for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5, d = i % 2 ? p.s * 0.35 : p.s * 0.9; ctx.lineTo(p.x + Math.cos(a) * d, p.y - p.s * 0.3 + Math.sin(a) * d); }
      ctx.fill(); ctx.fillText(m, p.x, p.y + p.s + 11);
    } else if (m === "stale") { ctx.strokeStyle = "rgba(255,224,102,0.45)"; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.arc(p.x, p.y, p.s, 0, 7); ctx.stroke(); }
    ctx.restore();
  }
  function drawFallen(p, k) {
    ctx.save(); ctx.translate(p.x, p.y - p.s * 0.2); ctx.rotate(k * 1.4);
    ctx.fillStyle = "#2b2b2b";
    ctx.fillRect(-p.s * 0.25, -p.s * 1.3, p.s * 0.5, p.s * 1.1);
    ctx.beginPath(); ctx.arc(0, -p.s * 1.5, p.s * 0.3, 0, 7); ctx.fill();
    ctx.restore();
    ctx.save(); ctx.strokeStyle = "#ff5a4a"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(p.x - 8, p.y + 6); ctx.lineTo(p.x + 8, p.y + 20); ctx.moveTo(p.x + 8, p.y + 6); ctx.lineTo(p.x - 8, p.y + 20); ctx.stroke();
    ctx.restore();
  }
  function drawCover(out) {
    const cx = W * (0.2 + 0.3 * G.cover);
    ctx.fillStyle = G.coverHp[G.cover] <= 0 ? "#4a2a2a" : "#2e2a24";
    const top = out ? H * 0.95 : H * 0.86;
    ctx.beginPath(); ctx.moveTo(cx - 90, H); ctx.lineTo(cx - 80, top); ctx.lineTo(cx - 20, top - 14); ctx.lineTo(cx + 60, top - 4); ctx.lineTo(cx + 90, H); ctx.fill();
    if (out) {
      ctx.fillStyle = "#1a1a1a"; ctx.fillRect(cx - 4, H * 0.9, 8, H * 0.1);
    }
    ctx.fillStyle = "rgba(255,255,255,0.75)"; ctx.font = "bold 12px sans-serif"; ctx.textAlign = "center";
    ctx.fillText(out ? "OUT OF COVER" : COVER_NAMES[G.cover] + " cover", cx, H - 8);
  }
  requestAnimationFrame(tick);

  // ---------- offline ----------
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch(() => { /* offline support unavailable */ });
  }

  // ---------- test hooks (read-only views for the play-through script) ----------
  window.HR = {
    get state() { return G; },
    get save() { return save; },
    view: () => VIEW,
    spotClient(c, r) { const rc = canvas.getBoundingClientRect(); const p = spotXY(c, r); return { x: rc.left + p.x, y: rc.top + p.y }; },
    startLevel,
  };
})();
