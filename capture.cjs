const puppeteer = require('puppeteer-core');
const fs = require('fs');

const GAME_URL = "http://localhost:8090";

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

let errors = [];
function pushError(msg) {
  if (errors.length < 50 && msg) {
    const s = String(msg).trim();
    if (s && !errors.includes(s)) errors.push(s);
  }
}

// ---- page-side probe functions --------------------------------------------
// Folded in VERBATIM from the deleted persistent QA daemon
// (app/tools/sandbox_tools/qa_browser/daemon.cjs, 2026-09-17, project
// 6a3c60a9). The daemon held a live Phaser/WebGL page open across the whole QA
// loop and was OOM-killed on the 512MB template; the one-shot capture launches
// → probes → screenshots → EXITS, releasing memory. Do NOT reimplement or
// simplify these — the probe verdict consumes their exact output shape.
const FN_DETECT = () => {
  const out = { found: false, framework: 'unknown', activeScenes: null, canvas: null };
  let canvas = null;
  try { canvas = document.querySelector('canvas'); } catch (e) {}
  if (canvas) { try { out.canvas = { w: canvas.width, h: canvas.height }; } catch (e) {} }

  let phaserGame = null;
  try {
    const P = window.Phaser;
    let g = window.__PHASER_GAME__ || window.game || window.__GAME__;
    if (g && (g.scene || (g.loop && typeof g.loop.frame === 'number'))) phaserGame = g;
    if (!phaserGame && P && P.GAMES && P.GAMES.length) phaserGame = P.GAMES[0];
  } catch (e) {}

  if (phaserGame) {
    out.found = true;
    out.framework = 'phaser';
    try {
      if (phaserGame.scene && typeof phaserGame.scene.getScenes === 'function') {
        out.activeScenes = phaserGame.scene.getScenes(true).map((s) => (s && s.scene && s.scene.key) || null);
      }
    } catch (e) {}
    return out;
  }

  let three = false;
  try { three = !!window.__THREE_DEVTOOLS__; } catch (e) {}
  if (!three && canvas) {
    try {
      three = !!(canvas.getContext('webgl') || canvas.getContext('webgl2') || canvas.getContext('experimental-webgl'));
    } catch (e) {}
  }
  if (three) { out.found = true; out.framework = 'three'; }
  else if (canvas) { out.found = true; out.framework = 'unknown'; }
  return out;
};

const FN_FRAME = () => {
  try {
    const P = window.Phaser;
    let g = window.__PHASER_GAME__ || window.game || window.__GAME__;
    if (!g && P && P.GAMES && P.GAMES.length) g = P.GAMES[0];
    if (g && g.loop && typeof g.loop.frame === 'number') return g.loop.frame;
    if (g && g.scene && g.scene.game && g.scene.game.loop && typeof g.scene.game.loop.frame === 'number') {
      return g.scene.game.loop.frame;
    }
  } catch (e) {}
  // Fallback: injected rAF counter (also detects a frozen main thread).
  if (typeof window.__QA_RAF_COUNT__ !== 'number') {
    window.__QA_RAF_COUNT__ = 0;
    const tick = () => { window.__QA_RAF_COUNT__ += 1; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }
  return window.__QA_RAF_COUNT__;
};

const FN_PAINTED = () => {
  const canvas = document.querySelector('canvas');
  if (!canvas || !canvas.width || !canvas.height) return null;
  const w = canvas.width, h = canvas.height;
  const cx = Math.max(0, Math.floor(w / 2));
  const cy = Math.max(0, Math.floor(h / 2));
  let gl = null;
  try { gl = canvas.getContext('webgl') || canvas.getContext('webgl2') || canvas.getContext('experimental-webgl'); } catch (e) {}
  if (gl) {
    // ponytail: WebGL readPixels MUST run inside requestAnimationFrame. With the
    // default preserveDrawingBuffer:false (three.js AND Phaser WebGL) the drawing
    // buffer is cleared/undefined after compositing, so a synchronous read at
    // arbitrary timing can return all-zeros on a perfectly rendering game. This
    // callback is registered now, after the game's own render callback for the
    // next frame, so it samples post-render / pre-composite. Do NOT "simplify"
    // this back to a synchronous read.
    return new Promise((resolve) => {
      requestAnimationFrame(() => {
        try {
          const live = canvas.getContext('webgl') || canvas.getContext('webgl2') || canvas.getContext('experimental-webgl');
          if (!live) return resolve(null); // context lost between schedule and callback
          const px = new Uint8Array(8 * 8 * 4);
          live.readPixels(Math.max(0, cx - 4), Math.max(0, cy - 4), 8, 8, live.RGBA, live.UNSIGNED_BYTE, px);
          for (let i = 0; i < px.length; i++) if (px[i] !== 0) return resolve(true);
          resolve(false);
        } catch (e) { resolve(null); }
      });
    });
  }
  const ctx = canvas.getContext('2d');
  if (ctx) {
    try {
      const d = ctx.getImageData(Math.max(0, cx - 8), Math.max(0, cy - 8), 16, 16).data;
      let lo = 255, hi = 0;
      for (let i = 0; i < d.length; i += 4) {
        const g = (d[i] + d[i + 1] + d[i + 2]) / 3;
        if (g < lo) lo = g;
        if (g > hi) hi = g;
      }
      return hi - lo > 8;
    } catch (e) { return null; }
  }
  return null;
};

const FN_STATE = () => {
  const snap = { frame: null, scenes: null, reg: null, hud: null };
  let game = null;
  try {
    const P = window.Phaser;
    let g = window.__PHASER_GAME__ || window.game || window.__GAME__;
    if (g && g.scene) game = g;
    else if (P && P.GAMES && P.GAMES.length) game = P.GAMES[0];
  } catch (e) {}
  try { if (game && game.loop && typeof game.loop.frame === 'number') snap.frame = game.loop.frame; } catch (e) {}
  try {
    if (game && game.scene && typeof game.scene.getScenes === 'function') {
      snap.scenes = game.scene.getScenes(true).map((s) => (s && s.scene && s.scene.key) || null);
    }
  } catch (e) {}
  try {
    if (game && game.registry && typeof game.registry.get === 'function') {
      const keys = ['score', 'health', 'lives', 'level', 'state', 'phase', 'gameState', 'gameOver', 'paused'];
      const o = {};
      for (const k of keys) {
        try { const v = game.registry.get(k); if (v !== undefined) o[k] = v; } catch (e) {}
      }
      snap.reg = o;
    }
  } catch (e) {}
  try {
    const hud = document.querySelector('#hud');
    snap.hud = hud ? String(hud.innerText || '').trim().slice(0, 200) : null;
  } catch (e) {}
  return snap;
};

function compareState(before, after) {
  if (!before || !after) return null;
  try {
    const sig = (s) => JSON.stringify({ scenes: s.scenes, reg: s.reg, hud: s.hud });
    if (sig(before) !== sig(after)) return true;
    if (typeof before.frame === 'number' && typeof after.frame === 'number') return after.frame > before.frame;
    if (before.scenes === null && before.reg === null && before.hud === null) return null;
    return false;
  } catch (e) {
    return null;
  }
}

async function main() {
  const t0 = Date.now();
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/chromium",
    args: ['--no-sandbox', '--disable-gpu', '--window-size=1280,720', '--autoplay-policy=no-user-gesture-required'],
    headless: 'new',
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  page.on('pageerror', (err) => pushError(err.message || err));
  page.on('console', (msg) => {
    const type = msg.type();
    const text = msg.text();
    if (type === 'error' || /texture|loader|Phaser|WebGL|decodeAudioData|unhandledrejection|unknown content type|failed to load|404|TypeError|ReferenceError|Cannot read|undefined|QA_VIOLATION|UI_WARNING/i.test(text)) {
      pushError(text);
    }
  });
  // Network failures / 4xx responses (assets, chunks, favicons) — evidence
  page.on('requestfailed', (req) => {
    try {
      const errText = (req.failure() && req.failure().errorText) || 'failed';
      pushError('[ASSET_FAIL] ' + req.url() + ' :: ' + errText);
    } catch (e) { /* best effort */ }
  });
  page.on('response', (res) => {
    try {
      if (res.status() >= 400) {
        pushError('[ASSET_404] ' + res.url() + ' status=' + res.status());
      }
    } catch (e) { /* best effort */ }
  });

  // Catch all uncaught exceptions in page context
  await page.evaluateOnNewDocument(() => {
    window.addEventListener('error', (e) => {
      console.error('UncaughtPageError: ' + (e.message || (e.error && e.error.message) || e));
    });
    window.addEventListener('unhandledrejection', (e) => {
      console.error('UnhandledRejection: ' + (e.reason && (e.reason.message || e.reason)));
    });
  });

  const shot = async (moment) => {
    try {
      const buf = await page.screenshot({ type: 'png' });
      fs.writeFileSync('/home/user/shot-' + moment + '.png', buf);
    } catch (e) {
      pushError('screenshot ' + moment + ': ' + (e && e.message || e));
    }
  };

  // Best-effort Game-ready poll: active Phaser scene or Three.js canvas/engine exists.
  const waitGameActive = () =>
    page
      .waitForFunction(
        () => {
          const g = window.__PHASER_GAME__;
          if (g && g.scene && g.scene.scenes && g.scene.scenes.some((s) => s.sys && s.sys.settings.active)) return true;
          const tg = window.__GAME__ || window.game;
          if (tg && (tg.renderer || tg.scene || tg.engine)) return true;
          const canvas = document.querySelector('canvas');
          return !!canvas;
        },
        { timeout: 8000 }
      )
      .catch(() => {});

  // domcontentloaded, NOT networkidle0: a game page can hold a connection open
  // forever (media stream, long-poll, blocked external request) while rendering
  // fine, so networkidle0 timed out on every probe and pushed a bogus
  // 'goto: Navigation timeout' into errors -> false FAIL -> wasted fix round
  // (prod c092a0c2 2026-09-18: 3/3 probes timed out with found/painted/advancing
  // all true). Game readiness is decided by waitGameActive() + the frame checks
  // below, never by network silence.
  await page.goto(GAME_URL, { waitUntil: 'domcontentloaded', timeout: 20000 })
    .catch((e) => { pushError('goto: ' + (e && e.message || e)); });
  await waitGameActive();

  // Gate signals (found / advancing / painted) sampled on a FRESH boot, BEFORE
  // the start/restart/game-over interaction below — matching the deleted
  // daemon's /probe order (daemon.cjs:341-353). A game that stops its RAF loop
  // at the emulated game-over would otherwise read advancing=false at the end
  // and false-FAIL a healthy build into a wasted fix round (prod 52153a8b).
  const detect = await page.evaluate(FN_DETECT);
  const f1 = await page.evaluate(FN_FRAME);
  await sleep(1000);
  const f2 = await page.evaluate(FN_FRAME);
  const painted = await page.evaluate(FN_PAINTED);

  await sleep(400);
  await shot('boot');

  // Menu / Title inspection
  await sleep(400);
  await shot('menu');

  // Probe seam (daemon→one-shot fold, 2026-09-17, project 6a3c60a9): snapshot
  // the pre-interaction page state. `after` is sampled at the end of the run
  // and compareState() reports interaction.stateChanged, matching the daemon's
  // /probe interaction block.
  const before = await page.evaluate(FN_STATE);

  // Trigger game start via DOM button, Canvas click, EventBus, or Keyboard
  try {
    await page.evaluate(() => {
      // 1. Try DOM button in React overlay (#hud) or body
      const re = /start|play|begin|go|continue/i;
      const els = document.querySelectorAll('#hud button, button, a, input[type="submit"], [role="button"]');
      for (const el of els) {
        const text = ((el.innerText || el.value || '') + ' ' + (el.getAttribute('aria-label') || '')).trim();
        if (text && re.test(text)) {
          el.click();
          return true;
        }
      }

      // 2. Try EventBus if exposed on window
      if (window.__PHASER_EVENT_BUS__) {
        window.__PHASER_EVENT_BUS__.emit('start-game');
        window.__PHASER_EVENT_BUS__.emit('start');
      }
      if (window.__GAME_BUS__) {
        window.__GAME_BUS__.emit('start-game');
        window.__GAME_BUS__.emit('start');
      }

      // 3. Try clicking canvas center
      const canvas = document.querySelector('canvas');
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        const evt = new MouseEvent('pointerdown', {
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
          bubbles: true,
        });
        canvas.dispatchEvent(evt);
        canvas.dispatchEvent(new MouseEvent('click', {
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
          bubbles: true,
        }));
      }
      return false;
    });
  } catch (e) { /* best effort */ }

  // Also press Space and Enter via page keyboard
  try {
    await page.keyboard.press('Space');
    await page.keyboard.press('Enter');
  } catch (e) { /* best effort */ }

  // Dismiss story dialogues / modals / level select screens if present
  try {
    await page.evaluate(() => {
      const modalBtns = document.querySelectorAll('.modal button, [role="dialog"] button, #hud button, button');
      for (const btn of modalBtns) {
        const t = (btn.innerText || '').trim().toLowerCase();
        if (/skip|continue|next|got it|close|dismiss/i.test(t)) {
          btn.click();
          break;
        }
      }
      const levelBtns = document.querySelectorAll('button, .level-btn, [data-level]');
      for (const btn of levelBtns) {
        const t = (btn.innerText || '').trim();
        if (/^1\b|level\s*1|stage\s*1/i.test(t)) {
          btn.click();
          break;
        }
      }
    });
  } catch (e) { /* best effort */ }

  // Wait for transition / countdown into active gameplay (best-effort
  // game-ready poll; short settle sleep keeps the animation frames).
  await waitGameActive();
  await sleep(400);

  // Countdown handling: wait for countdown to transition into active PLAYING
  try {
    const hasCountdown = await page.evaluate(() => {
      const g = window.__PHASER_GAME__;
      const s = g && g.scene && g.scene.scenes && g.scene.scenes.find((x) => x.sys && x.sys.settings.active);
      const phase = s && (s.phase || s.currentPhase || s.state);
      const isVisible = (el) => !!(el && (el.offsetWidth > 0 || el.offsetHeight > 0) && window.getComputedStyle(el).display !== 'none');
      const cdEl = document.querySelector('.countdown, #countdown, [data-phase="countdown"]');
      return !!(phase === 'COUNTDOWN' || phase === 'countdown' || isVisible(cdEl));
    });

    if (hasCountdown) {
      const finished = await page.waitForFunction(() => {
        const g = window.__PHASER_GAME__;
        const s = g && g.scene && g.scene.scenes && g.scene.scenes.find((x) => x.sys && x.sys.settings.active);
        const phase = s && (s.phase || s.currentPhase || s.state);
        const isVisible = (el) => !!(el && (el.offsetWidth > 0 || el.offsetHeight > 0) && window.getComputedStyle(el).display !== 'none');
        const cdEl = document.querySelector('.countdown, #countdown, [data-phase="countdown"]');
        return !isVisible(cdEl) && (!phase || String(phase).toUpperCase() !== 'COUNTDOWN');
      }, { timeout: 4500 }).catch(() => null);

      if (!finished) {
        pushError('[QA_VIOLATION] Countdown Stalled: Game remained in COUNTDOWN phase after 4.5 seconds.');
      }
    }
  } catch (e) { /* best effort */ }

  // Check for duplicate / overlapping timers in Phaser scene
  try {
    await page.evaluate(() => {
      const g = window.__PHASER_GAME__;
      const s = g && g.scene && g.scene.scenes && g.scene.scenes.find((x) => x.sys && x.sys.settings.active);
      if (s && s.time && s.time._active) {
        const timerEvents = s.time._active;
        const countdownTimers = timerEvents.filter((t) => {
          if (!t || t.repeat <= 0 || t.delay < 500 || t.delay > 1200) return false;
          const fnStr = String((t.callback && t.callback.toString()) || t.callbackScope || '');
          return /countdown|tick|startRun|onCmd/i.test(fnStr);
        });
        if (countdownTimers.length > 1) {
          console.error('[QA_VIOLATION] Overlapping Timers: Multiple countdown timer events running simultaneously.');
        }
      }
    });
  } catch (e) { /* best effort */ }

  // Dead-HUD detection: snapshot #hud text before gameplay input.
  let hudBefore = null;
  try {
    hudBefore = await page.evaluate(() => {
      const hud = document.querySelector('#hud');
      return hud ? String(hud.innerText || '').trim() : null;
    });
  } catch (e) { /* best effort */ }

  // AFK Playability Simulation: Test 3.5s of inactivity before injecting inputs
  try {
    await sleep(3500);
    const afkResult = await page.evaluate(() => {
      const g = window.__PHASER_GAME__;
      const s = g && g.scene && g.scene.scenes && g.scene.scenes.find((x) => x.sys && x.sys.settings.active);
      const isFinished = !!(s && (s.hasWon || s.victory || s.state === 'WIN' || s.phase === 'WIN' || s.phase === 'LEVEL_COMPLETE'));
      const hudText = document.querySelector('#hud')?.innerText || '';
      const hasWonHud = /trial complete|level complete|stage clear|mission complete|sector secured|victory|you win/i.test(hudText);
      return isFinished || hasWonHud;
    });
    if (afkResult) {
      pushError('[QA_VIOLATION] AFK Auto-Win: Game completed or won after 3.5s with zero player input. Game must require active player agency.');
    }
  } catch (e) { /* best effort */ }

  // Emulate active gameplay input: movement + combat + jump + dash + on-screen actions
  try {
    for (let loop = 0; loop < 2; loop++) {
      // Move right + attack + jump
      await page.keyboard.down('ArrowRight');
      await page.keyboard.down('KeyD');
      await sleep(150);
      await page.keyboard.press('Space'); // Jump
      await page.keyboard.press('KeyW');
      await sleep(100);
      await page.keyboard.press('KeyJ'); // Light Attack / Shoot
      await page.keyboard.press('KeyZ');
      await sleep(100);
      await page.keyboard.press('KeyK'); // Heavy Attack / Dash
      await page.keyboard.press('KeyX');
      await sleep(100);
      await page.keyboard.press('KeyL'); // Shield Block / Special
      await page.keyboard.press('KeyC');
      await sleep(100);
      await page.keyboard.up('ArrowRight');
      await page.keyboard.up('KeyD');

      // Click all on-screen action / touch buttons
      await page.evaluate(() => {
        const actionBtns = document.querySelectorAll(
          '#hud button, button, .action-btn, .touch-btn, [data-action], #btn-attack, #btn-dash, #btn-jump, #btn-block'
        );
        for (const btn of actionBtns) {
          const t = ((btn.innerText || '') + ' ' + (btn.getAttribute('aria-label') || '')).toLowerCase();
          if (!/restart|menu|quit|exit|home/i.test(t)) {
            btn.click();
          }
        }
      });

      // Move left + attack
      await page.keyboard.down('ArrowLeft');
      await page.keyboard.down('KeyA');
      await sleep(150);
      await page.keyboard.press('KeyJ');
      await page.keyboard.press('Space');
      await sleep(100);
      await page.keyboard.up('ArrowLeft');
      await page.keyboard.up('KeyA');
      await sleep(150);
    }
  } catch (e) { /* best effort */ }

  // Dead-HUD detection: compare after gameplay input; present + unchanged
  // means the HUD never updated (dead score/health overlay).
  try {
    const hudAfter = await page.evaluate(() => {
      const hud = document.querySelector('#hud');
      return hud ? String(hud.innerText || '').trim() : null;
    });
    if (hudBefore !== null && hudAfter !== null && hudBefore === hudAfter) {
      pushError('[HUD_STATIC] #hud text unchanged during gameplay');
    }
  } catch (e) { /* best effort */ }

  await sleep(400);
  await shot('gameplay');

  // Runtime telemetry: frozen loop + fps (deterministic, measured).
  try {
    const frameBefore = await page.evaluate(() => {
      const g = window.__PHASER_GAME__;
      return g && g.loop ? g.loop.frame : -1;
    });
    await sleep(500);
    const frameAfter = await page.evaluate(() => {
      const g = window.__PHASER_GAME__;
      return g && g.loop ? g.loop.frame : -1;
    });
    if (frameBefore >= 0 && frameAfter >= 0 && frameAfter === frameBefore) {
      pushError('[FROZEN_LOOP] game loop frame did not advance over 500ms');
    }
    const fps = await page.evaluate(() => {
      const g = window.__PHASER_GAME__;
      return g && g.loop ? g.loop.actualFps : null;
    });
    if (typeof fps === 'number' && fps < 5) {
      pushError('[PERF_WARNING] low fps: ' + fps);
    }
  } catch (e) { /* best effort */ }

  // Kinematic & Platform Reachability inspection
  try {
    await page.evaluate(() => {
      const g = window.__PHASER_GAME__;
      if (g && g.scene) {
        const scenes = g.scene.scenes || [];
        const activeScene = scenes.find((s) => s.sys && s.sys.settings.active) || scenes[0];
        if (activeScene) {
          const player = activeScene.player || activeScene.knight || (activeScene.children && activeScene.children.list && activeScene.children.list.find((c) => c.body && !c.body.immovable));
          const platforms = activeScene.platforms || activeScene.ground;
          const gravity = (activeScene.physics && activeScene.physics.world && activeScene.physics.world.gravity && activeScene.physics.world.gravity.y) || 800;
          if (player && player.body) {
            const jumpV = Math.abs(player.jumpVelocity !== undefined ? player.jumpVelocity : -350);
            const maxJumpH = (jumpV * jumpV) / (2 * (gravity || 1));
            if (platforms && typeof platforms.getChildren === 'function') {
              const children = platforms.getChildren();
              if (children && children.length > 1) {
                const groundY = Math.max(...children.map((c) => c.y));
                for (const plat of children) {
                  const deltaY = groundY - plat.y;
                  if (deltaY > 20 && deltaY > maxJumpH * 1.25) {
                    console.error(`[PLATFORM_REACHABILITY_WARNING] Platform at y=${Math.round(plat.y)} is ${Math.round(deltaY)}px above ground, exceeding max single jump height ${Math.round(maxJumpH)}px.`);
                  }
                }
              }
            }
          }
        }
      }
    });
  } catch (e) { /* best effort */ }

  // Automated Asset, Objective, Goal, Kill-Plane & Hazard Inspections
  try {
    await page.evaluate(() => {
      const g = window.__PHASER_GAME__;
      if (!g || !g.scene) return;
      const scenes = g.scene.scenes || [];
      const activeScene = scenes.find((s) => s.sys && s.sys.settings.active) || scenes[0];
      if (!activeScene) return;

      const children = (activeScene.children && activeScene.children.list) || [];
      const player = activeScene.player || activeScene.knight || children.find((c) => c.body && !c.body.immovable);

      // 1. Asset Identity Check: Flag primitive rectangle/graphics or 1x1 dummy player
      try {
        if (player) {
          const isPrimitive = player.type === 'Graphics' || player.type === 'Rectangle';
          if (isPrimitive) {
            console.error('[QA_VIOLATION] Player is a primitive Graphics/Rectangle box instead of a real Sprite.');
          }
          if (player.frame && (player.frame.width <= 1 || player.frame.height <= 1)) {
            console.error(`[QA_VIOLATION] Invisible Player: Player "${(player.texture && player.texture.key) || ''}" has 1x1 dummy placeholder texture.`);
          }
        }
      } catch (e) {}

      // 2. Objective Counter Consistency: HUD target vs scene collectibles
      try {
        const hudEl = document.querySelector('#hud');
        const hudText = hudEl ? (hudEl.innerText || '') : '';
        // ponytail: fallback only runs on HUD lines that exclude non-collectible
        // counters (HP 3/3, Wave 2/3, Level 1/3) — primary keyword regex is fine.
        const fallbackText = hudText
          .split('\n')
          .filter((line) => !/hp|health|live|wave|level|ammo|time/i.test(line))
          .join('\n');
        const targetMatch = hudText.match(/(?:fruit|coin|star|gem|item|target|score)s?\s*[:=]?\s*(\d+)\s*\/\s*(\d+)/i)
          || fallbackText.match(/(\d+)\s*\/\s*(\d+)/);
        if (targetMatch) {
          const requiredCount = parseInt(targetMatch[2], 10);
          if (requiredCount > 0) {
            let actualCount = 0;
            const groups = [
              activeScene.fruits, activeScene.coins, activeScene.collectibles,
              activeScene.items, activeScene.stars, activeScene.gems
            ];
            for (const grp of groups) {
              if (grp && typeof grp.countActive === 'function') {
                actualCount += grp.countActive(true);
              }
            }
            if (actualCount === 0) {
              actualCount = children.filter((c) => {
                const k = (c.texture && c.texture.key) || c.name || '';
                return /fruit|apple|coin|star|gem|collectible|pickup/i.test(k) && c.active !== false;
              }).length;
            }
            if (actualCount === 0 || actualCount < requiredCount) {
              console.error(`[QA_VIOLATION] Ghost Objectives: HUD demands ${requiredCount} collectibles ("${targetMatch[0]}"), but only ${actualCount} exist in scene!`);
            }

            // Check for gravity leaks on collectibles (falling fruits bug)
            for (const grp of groups) {
              if (grp && typeof grp.getChildren === 'function') {
                for (const item of grp.getChildren()) {
                  if (item && item.body && item.body.allowGravity && !item.body.immovable) {
                    console.error(`[QA_VIOLATION] Gravity Leak on Collectible: "${(item.texture && item.texture.key) || 'item'}" has allowGravity=true. Collectibles will drop through world before or during gameplay!`);
                    break;
                  }
                }
              }
            }
          }
        }
      } catch (e) {}

      // 3. Win Condition Goal Presence
      try {
        const hudEl = document.querySelector('#hud');
        const hudText = hudEl ? (hudEl.innerText || '') : '';
        const hasGoal = !!(
          activeScene.flag || activeScene.goal || activeScene.exit || activeScene.portal || activeScene.finishLine ||
          children.some((c) => /flag|goal|exit|portal|finish|trophy/i.test((c.texture && c.texture.key) || c.name || ''))
        );
        const hasGravity = activeScene.physics && activeScene.physics.world && activeScene.physics.world.gravity && activeScene.physics.world.gravity.y > 0;
        if (hasGravity && !hasGoal && !/score|time|wave/i.test(hudText)) {
          console.error('[QA_VIOLATION] Missing Win Goal: No flag, portal, exit, or goal entity found in platformer level.');
        }
      } catch (e) {}

      // 4. Kill Plane / Pit Bounds Check
      try {
        const hasGravity = activeScene.physics && activeScene.physics.world && activeScene.physics.world.gravity && activeScene.physics.world.gravity.y > 0;
        if (hasGravity && player && player.body && activeScene.physics && activeScene.physics.world) {
          const worldBounds = activeScene.physics.world.bounds;
          const platforms = activeScene.platforms || activeScene.ground;
          let maxPlatY = worldBounds ? worldBounds.height : 600;
          if (platforms && typeof platforms.getChildren === 'function') {
            const platList = platforms.getChildren();
            if (platList.length > 0) {
              maxPlatY = Math.max(...platList.map((p) => p.y));
            }
          }
          if (player.y > maxPlatY + 180 && player.active) {
            console.error('[QA_VIOLATION] Pit Soft-lock: Player fell into pit below platforms without dying or respawning.');
          }
        }
      } catch (e) {}

      // 5. Hazard Collider Check
      try {
        const hazards = activeScene.hazards || activeScene.traps || activeScene.saws || activeScene.spikes;
        if (hazards && player && activeScene.physics && activeScene.physics.world && activeScene.physics.world.colliders) {
          const colliderQueue = activeScene.physics.world.colliders;
          const colliders = (typeof colliderQueue.getActive === 'function') ? colliderQueue.getActive() : (Array.isArray(colliderQueue) ? colliderQueue : []);
          const hasHazardOverlap = colliders.some((c) =>
            (c.object1 === player && (c.object2 === hazards || (hazards.getChildren && hazards.getChildren().includes(c.object2)))) ||
            (c.object2 === player && (c.object1 === hazards || (hazards.getChildren && hazards.getChildren().includes(c.object1))))
          );
          // Fire when hazards exist but never overlap the player — even when
          // world.colliders is empty (that IS the broken case).
          const hazardCount = (hazards.getChildren && hazards.getChildren().length) || 0;
          if (!hasHazardOverlap && hazardCount > 0) {
            console.error('[QA_VIOLATION] Dead Hazards: Hazards exist in scene but have no active collision/overlap with player.');
          }
        }
      } catch (e) {}

      // 6. Mobile Touch Controls on Desktop Check
      try {
        const touchControls = document.querySelectorAll('#mobile-dpad, #touch-arrows, .mobile-controls, .touch-controls');
        if (touchControls.length > 0 && window.innerWidth >= 960) {
          console.warn('[UI_WARNING] Mobile touch controls rendered on desktop widescreen viewport.');
        }
      } catch (e) {}

      // 7. Ground Y Boundary Check: Lowest walkable ground must be anchored near bottom
      try {
        const ground = activeScene.ground || activeScene.platforms;
        const canvasH = (g.config && g.config.height) || 540;
        if (ground && typeof ground.getChildren === 'function') {
          const tiles = ground.getChildren();
          if (tiles && tiles.length > 0) {
            const maxGroundY = Math.max(...tiles.map((t) => t.y));
            if (maxGroundY < canvasH * 0.50) {
              console.error(`[QA_VIOLATION] Ground In Sky: Ground level y=${Math.round(maxGroundY)}px is in the upper half of the ${canvasH}px canvas. Ground must be anchored near bottom (aim for y >= ${Math.round(canvasH * 0.65)}px).`);
            }
          }
        }
      } catch (e) {}

    });
  } catch (e) { /* best effort */ }

  // Control Conflict Probe (behavioral): Space must not trigger Action, J must not trigger Jump.
  // Reads GameControls.getInput() live — minification-proof, unlike source-string matching.
  try {
    const readControlInput = () => page.evaluate(() => {
      const g = window.__PHASER_GAME__;
      const s = g && g.scene && g.scene.scenes && g.scene.scenes.find((x) => x.sys && x.sys.settings.active);
      const ctrl = s && s.controls;
      if (!ctrl || typeof ctrl.getInput !== 'function') return null;
      const i = ctrl.getInput();
      return { jump: !!i.jump, action: !!i.action };
    });
    await page.keyboard.down('Space');
    const spaceInput = await readControlInput();
    await page.keyboard.up('Space');
    await page.keyboard.down('KeyJ');
    const jInput = await readControlInput();
    await page.keyboard.up('KeyJ');
    if (spaceInput && spaceInput.action) {
      pushError('[QA_VIOLATION] Control Conflict: Space triggers Action; Space must be Jump only.');
    }
    if (jInput && jInput.jump) {
      pushError('[QA_VIOLATION] Control Conflict: J triggers Jump; J must be Action only.');
    }
  } catch (e) { /* best effort */ }

  // Emulate pause & resume
  try {
    await page.keyboard.press('Escape');
    await page.keyboard.press('KeyP');
    await page.evaluate(() => {
      const pauseBtn = document.querySelector('#btn-pause, #pause-btn, [data-action="pause"], button[aria-label*="pause" i]');
      if (pauseBtn) pauseBtn.click();
      else if (window.__GAME_BUS__) window.__GAME_BUS__.emit('pause');
      else if (window.__PHASER_EVENT_BUS__) window.__PHASER_EVENT_BUS__.emit('pause');
    });
    await sleep(300);
    await shot('pause');

    // Resume
    await page.keyboard.press('Escape');
    await page.keyboard.press('KeyP');
    await page.evaluate(() => {
      const resumeBtn = document.querySelector('#btn-resume, #resume-btn, [data-action="resume"], button[aria-label*="resume" i]');
      if (resumeBtn) resumeBtn.click();
      else if (window.__GAME_BUS__) window.__GAME_BUS__.emit('resume');
      else if (window.__PHASER_EVENT_BUS__) window.__PHASER_EVENT_BUS__.emit('resume');
    });
    await sleep(200);
  } catch (e) { /* best effort */ }

  // Emulate level restart / replay
  try {
    await page.evaluate(() => {
      const restartBtn = document.querySelector('#btn-restart, #restart-btn, [data-action="restart"], button[aria-label*="restart" i]');
      if (restartBtn) {
        restartBtn.click();
      } else if (window.__GAME_BUS__) {
        window.__GAME_BUS__.emit('restart-game');
        window.__GAME_BUS__.emit('restart');
      } else if (window.__PHASER_EVENT_BUS__) {
        window.__PHASER_EVENT_BUS__.emit('restart-game');
        window.__PHASER_EVENT_BUS__.emit('restart');
      }
    });
    await sleep(400);
    await shot('restart');
  } catch (e) { /* best effort */ }

  // Emulate game over / state transition
  try {
    await page.evaluate(() => {
      if (typeof window.__QA_FINISH_RACE__ === 'function') {
        window.__QA_FINISH_RACE__();
      } else if (typeof window.__GAME_OVER__ === 'function') {
        window.__GAME_OVER__();
      } else if (window.__GAME_BUS__) {
        window.__GAME_BUS__.emit('game-over');
      } else if (window.__PHASER_EVENT_BUS__) {
        window.__PHASER_EVENT_BUS__.emit('game-over');
      }
    });
    await sleep(400);
  } catch (e) { /* best effort */ }
  await shot('gameover');

  // Deterministic probe (folded from the deleted daemon's /probe handler,
  // 2026-09-17, project 6a3c60a9). Emits the SAME dict shape probe_verdict
  // consumes: errors is the capture script's string array, which
  // _probe_error_texts handles (it accepts bare strings). detect/frames/painted
  // were sampled on the fresh boot above (pre-interaction, matching the
  // daemon's /probe order); only the interaction state delta is computed here.
  // Written BEFORE the console-errors flush so a crash still leaves a parseable
  // FAIL probe (see main().catch).
  const after = await page.evaluate(FN_STATE);
  const stateChanged = compareState(before, after);
  const probe = {
    ok: true,
    errors: errors,
    game: {
      found: detect.found,
      framework: detect.framework,
      activeScenes: detect.activeScenes,
      frames: {
        delta: (typeof f1 === 'number' && typeof f2 === 'number') ? f2 - f1 : null,
        advancing: (typeof f1 === 'number' && typeof f2 === 'number') ? f2 - f1 > 0 : null,
      },
      painted: painted,
      canvas: detect.canvas,
    },
    interaction: { performed: true, stateChanged: stateChanged },
    timing: { probeMs: Date.now() - t0 },
  };
  fs.writeFileSync('/home/user/qa-probe.json', JSON.stringify(probe));

  fs.writeFileSync('/home/user/console-errors.txt', JSON.stringify(errors));
  await browser.close();
}

main().catch((e) => {
  // ALWAYS persist the collected console errors first
  try {
    fs.writeFileSync('/home/user/console-errors.txt', JSON.stringify(errors));
  } catch (ce) { /* best-effort */ }
  // Best-effort FAIL probe so a crashed capture still yields a parseable
  // verdict instead of a missing qa-probe.json (2026-09-17, project 6a3c60a9).
  try {
    fs.writeFileSync('/home/user/qa-probe.json', JSON.stringify({
      ok: false,
      error: String((e && e.message) || e),
      errors: errors,
      game: { found: false },
      interaction: { performed: false },
      timing: {},
    }));
  } catch (pe) { /* best-effort */ }
  fs.writeFileSync('/home/user/capture-errors.txt', String((e && e.stack) || e));
  process.exit(0);
});
