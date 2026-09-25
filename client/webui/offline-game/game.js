// NodeByte Runner —— 自研离线小游戏（客户端提示词 5.12）
// 目标：比 Edge 冲浪可玩性更高：2D 横版躲避 + 道具系统 + 分数 + 本地最高分。
// 纯 Canvas，无外部网络依赖，断网完全可用；静态资源 → 内核升级几乎不冲突（5.12.3）。
// 替换方案：net/error_page 离线页 grd 引用本资源（hook 0230）。

(() => {
  const cv = document.getElementById('game');
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height, GROUND = H - 46;

  const HI_KEY = 'nodebyte-runner-highscore';
  let hi = Number(localStorage.getItem(HI_KEY) || 0);
  document.getElementById('hi').textContent = hi;

  const state = { running: true, over: false, t: 0, speed: 6, score: 0, hi: hi };
  const player = {
    x: 90, y: GROUND, vy: 0, w: 34, h: 44,
    jumps: 0, maxJumps: 2, duck: false, shield: 0
  };
  let obstacles = [], orbs = [], particles = [];

  const keys = {};
  addEventListener('keydown', (e) => {
    if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    if (state.over && (e.code === 'Space' || e.code === 'Enter')) return reset();
    keys[e.code] = true;
    if (e.code === 'Space' || e.code === 'ArrowUp') jump();
  });
  addEventListener('keyup', (e) => { keys[e.code] = false; });
  cv.addEventListener('dblclick', () => jump());
  cv.addEventListener('pointerdown', () => { state.over ? reset() : jump(); });

  function jump() {
    if (player.jumps > 0) {
      player.vy = -13.2;
      player.jumps -= 1;
      burst(player.x + 17, player.y, '#5b8bff', 6);
    }
  }

  function burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      particles.push({ x, y, vx: (Math.random() - .5) * 6, vy: -Math.random() * 5, life: 24, color });
    }
  }

  function spawn() {
    // 障碍：地面仙人柱（红） / 飞行无人机（红，需俯冲或跳）
    const roll = Math.random();
    if (roll < 0.55) {
      const h = 26 + Math.random() * 26;
      obstacles.push({ x: W + 20, y: GROUND - h, w: 16, h, kind: 'cactus' });
    } else if (roll < 0.8) {
      const y = GROUND - 84 - Math.random() * 40;
      obstacles.push({ x: W + 20, y, w: 38, h: 22, kind: 'drone' });
    } else if (roll < 0.95) {
      orbs.push({ x: W + 20, y: GROUND - 60 - Math.random() * 70, r: 9 });  // ⚡能量
    } else {
      orbs.push({ x: W + 20, y: GROUND - 40, r: 11, heal: true });          // 心形回复（护盾延长）
    }
    // 难度随分数提升（间隔缩短）
    setTimeout(spawn, Math.max(520, 1250 - state.score * 2.2) + Math.random() * 500);
  }

  function reset() {
    obstacles = []; orbs = []; particles = [];
    state.over = false; state.running = true; state.t = 0; state.score = 0; state.speed = 6;
    player.y = GROUND; player.vy = 0; player.jumps = player.maxJumps; player.duck = false; player.shield = 0;
    setTimeout(spawn, 700);
  }

  function endGame() {
    if (player.shield > 0) { player.shield -= 1; return; }  // 护盾抵消一次
    state.over = true;
    if (state.score > hi) {
      hi = state.score;
      localStorage.setItem(HI_KEY, String(hi));   // 本地最高分存储（5.12.2）
      document.getElementById('hi').textContent = hi;
    }
  }

  function physics() {
    state.t++;
    if (!state.over) state.score += 0.12;
    state.speed = 6 + state.score * 0.012;

    // 玩家
    player.duck = keys.ArrowDown && player.y >= GROUND;
    player.vy += 0.62;
    player.y += player.vy;
    const floor = GROUND;
    if (player.y >= floor) { player.y = floor; player.vy = 0; player.jumps = player.maxJumps; }
    if (player.shield > 0) player.shield -= 1 / 60;

    // 障碍
    obstacles = obstacles.filter((o) => {
      o.x -= state.speed;
      const px = player.x, py = player.y - player.h, pw = player.w, ph = player.h;
      const duckShrink = player.duck ? 14 : 0;
      if (px < o.x + o.w && px + pw > o.x && py + duckShrink < o.y + o.h && py + ph > o.y) {
        endGame();
      }
      return o.x > -60;
    });

    // 能量球
    orbs = orbs.filter((o) => {
      o.x -= state.speed;
      const dx = player.x + player.w / 2 - o.x, dy = player.y - player.h / 2 - o.y;
      if (Math.hypot(dx, dy) < o.r + 18) {
        player.shield = o.heal ? player.shield + 6 : Math.max(player.shield, 5);
        burst(o.x, o.y, o.heal ? '#47cd89' : '#ffd66e', 12);
        return false;
      }
      return o.x > -30;
    });

    particles = particles.filter((p) => {
      p.x += p.vx - state.speed * 0.4; p.y += p.vy; p.vy += 0.2; p.life--;
      return p.life > 0;
    });
  }

  function drawPlayer() {
    const h = player.duck ? player.h - 14 : player.h;
    const y = player.y - h;
    // 护盾
    if (player.shield > 0) {
      ctx.beginPath();
      ctx.arc(player.x + 17, y + h / 2, 32 + Math.sin(state.t * 0.2) * 2, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,214,110,.75)'; ctx.lineWidth = 3; ctx.stroke();
    }
    // 身体
    ctx.fillStyle = '#5b8bff';
    roundRect(player.x, y, player.w, h, 9); ctx.fill();
    // 眼睛
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(player.x + 24, y + 13, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#0f1115';
    ctx.beginPath(); ctx.arc(player.x + 26, y + 13, 2.4, 0, Math.PI * 2); ctx.fill();
    // 腿
    ctx.fillStyle = '#3b5fd9';
    const leg = Math.sin(state.t * 0.35) * 6;
    ctx.fillRect(player.x + 6, player.y - 4, 6, 8 + leg * 0.4);
    ctx.fillRect(player.x + 20, player.y - 4, 6, 8 - leg * 0.4);
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    // 视差背景（星星 + 远山）
    ctx.fillStyle = 'rgba(255,255,255,.35)';
    for (let i = 0; i < 40; i++) {
      const sx = (i * 137 + state.t * 0.4) % W;
      const sy = (i * 89) % (GROUND - 60);
      ctx.fillRect(W - sx, 24 + sy, 2, 2);
    }
    ctx.fillStyle = 'rgba(91,139,255,.10)';
    ctx.beginPath();
    for (let x = 0; x <= W; x += 40) {
      const hill = 60 + Math.sin((x + state.t * state.speed * 0.4) * 0.008) * 26;
      ctx.lineTo(x, GROUND - hill);
    }
    ctx.lineTo(W, GROUND); ctx.lineTo(0, GROUND); ctx.fill();

    // 地面
    ctx.strokeStyle = '#2a2f3a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, GROUND + 1); ctx.lineTo(W, GROUND + 1); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.12)';
    for (let i = 0; i < 26; i++) {
      const gx = (i * 91 - state.t * state.speed) % (W + 40);
      ctx.fillRect(W - gx, GROUND + 10, 22, 2);
    }

    // 障碍
    obstacles.forEach((o) => {
      if (o.kind === 'cactus') {
        ctx.fillStyle = '#f97066';
        roundRect(o.x, o.y, o.w, o.h, 4); ctx.fill();
        ctx.fillRect(o.x - 5, o.y + o.h * 0.3, o.w + 10, 6);
      } else {
        ctx.fillStyle = '#f97066';
        roundRect(o.x, o.y, o.w, o.h, 6); ctx.fill();
        ctx.fillStyle = '#ffb4a6';
        const rotor = Math.sin(state.t * 0.6) * 10;
        ctx.fillRect(o.x + 4, o.y - 4 + rotor * 0.2, o.w - 8, 3);
      }
    });

    // 能量球
    orbs.forEach((o) => {
      ctx.fillStyle = o.heal ? '#47cd89' : '#ffd66e';
      ctx.beginPath(); ctx.arc(o.x, o.y, o.r + Math.sin(state.t * 0.25) * 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#101520';
      ctx.font = 'bold 11px sans-serif';
      ctx.fillText(o.heal ? '♥' : '⚡', o.x - 5, o.y + 4);
    });

    // 粒子
    particles.forEach((p) => {
      ctx.globalAlpha = p.life / 24;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, 4, 4);
    });
    ctx.globalAlpha = 1;

    drawPlayer();

    // 记分
    ctx.fillStyle = 'rgba(255,255,255,.8)';
    ctx.font = 'bold 20px ui-monospace, monospace';
    ctx.fillText(String(Math.floor(state.score)).padStart(5, '0'), W - 96, 40);
    ctx.fillStyle = 'rgba(255,255,255,.35)';
    ctx.font = '12px sans-serif';
    ctx.fillText(`HI ${String(hi).padStart(5, '0')}`, W - 96, 60);

    // 结束
    if (state.over) {
      ctx.fillStyle = 'rgba(15,17,21,.66)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 30px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('游戏结束', W / 2, H / 2 - 12);
      ctx.font = '14px sans-serif';
      ctx.fillStyle = '#9aa3b2';
      ctx.fillText('按 空格 / 点击 重新开始', W / 2, H / 2 + 20);
      ctx.textAlign = 'left';
    }
  }

  (function loop() {
    physics();
    draw();
    requestAnimationFrame(loop);
  })();

  reset();
})();
