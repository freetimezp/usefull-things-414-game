/*
    Architecture overview (implemented):
      - Game engine loop (Game class)
      - Entities: Player, Enemy, Bullet, Coin
      - Simple collision system
      - Spawn manager for enemies
      - Upgrade/shop system (persisted in localStorage)
      - Input: keyboard + simple on-screen buttons
      - Save/load + autosave

    How to run: save this file as rpg-space-shooter.html and open in browser.
  */

// ---------- Utilities ----------
const rand = (a, b) => Math.random() * (b - a) + a;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- Game constants & state ----------
class Game {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d");
        this.w = canvas.width;
        this.h = canvas.height;
        this.last = performance.now();
        this.dt = 0;
        this.entities = [];
        this.particles = [];
        this.running = false;
        this.spawnTimer = 0;

        this.shopData = [
            { id: "dmg1", name: "+1 Damage", cost: 10, apply: (gs) => gs.player.upgradeDamage(1) },
            {
                id: "firerate1",
                name: "+0.5 FireRate",
                cost: 25,
                apply: (gs) => gs.player.upgradeFireRate(0.5),
            },
            { id: "speed1", name: "+50 Speed", cost: 20, apply: (gs) => gs.player.upgradeSpeed(50) },
            { id: "hp1", name: "+5 Max HP", cost: 30, apply: (gs) => gs.player.upgradeMaxHp(5) },
        ];

        // load or create player
        this.player = Player.default(this);
        const save = Game.load();
        if (save) this.player.loadFromSave(save.player);

        // Bind input
        this.input = new Input();

        // Hook simple UI
        this.ui = new UI(this);

        this.entities.push(this.player);

        // add simple collision layers map
        this.layers = { player: [], enemies: [], bullets: [], coins: [] };

        this.autosaveTimer = 0;
    }

    start() {
        this.running = true;
        requestAnimationFrame(this.frame.bind(this));
    }

    stop() {
        this.running = false;
    }

    frame(now) {
        this.dt = Math.min(0.05, (now - this.last) / 1000);
        this.last = now;
        this.update(this.dt);
        this.render(this.ctx);
        if (this.running) requestAnimationFrame(this.frame.bind(this));
    }

    update(dt) {
        // update entities
        for (let e of this.entities) if (e.active && e.update) e.update(dt);

        // simple spawn logic
        this.spawnTimer -= dt;
        if (this.spawnTimer <= 0) {
            this.spawnEnemy();
            this.spawnTimer = rand(0.6, 1.6);
        }

        // collision checks: bullets vs enemies
        for (let b of this.entities.filter((e) => e.type === "bullet")) {
            for (let en of this.entities.filter((e) => e.type === "enemy")) {
                if (!b.active || !en.active) continue;
                if (collideRect(b, en)) {
                    en.takeDamage(b.damage);
                    b.active = false;
                    this.particles.push(new Particle(b.x, b.y, "hit"));
                }
            }
        }

        // enemies vs player (touch)
        for (let en of this.entities.filter((e) => e.type === "enemy")) {
            if (!en.active) continue;
            if (collideRect(en, this.player)) {
                en.active = false;
                this.player.takeDamage(1);
                this.particles.push(new Particle(en.x, en.y, "explode"));
            }
        }

        // coins pickup
        for (let c of this.entities.filter((e) => e.type === "coin")) {
            if (!c.active) continue;
            if (collideRect(c, this.player)) {
                c.active = false;
                this.player.coins += c.value;
                this.ui.updateStats();
                this.ui.toast("Picked up " + c.value + " coins");
            }
        }

        // remove inactive
        this.entities = this.entities.filter((e) => e.active);

        // particles update
        for (let p of this.particles) p.update(dt);
        this.particles = this.particles.filter((p) => p.alive);

        // autosave every 5 seconds
        this.autosaveTimer += dt;
        if (this.autosaveTimer > 5) {
            this.autosaveTimer = 0;
            this.save();
        }
    }

    render(ctx) {
        ctx.clearRect(0, 0, this.w, this.h);

        // stars background
        ctx.fillStyle = "#041018";
        ctx.fillRect(0, 0, this.w, this.h);
        for (let i = 0; i < 100; i++) {
            ctx.fillStyle = "rgba(255,255,255," + Math.random() * 0.6 + ")";
            const x = (i * 37) % this.w;
            const y = (i * 17 * (1 + Math.sin(performance.now() / 1000 + i))) % this.h;
            ctx.fillRect(x, y, 1, 1);
        }

        // render entities
        for (let e of this.entities) if (e.draw) e.draw(ctx);

        // particles
        for (let p of this.particles) p.draw(ctx);

        // HUD small
        ctx.save();
        ctx.fillStyle = "#ffffff88";
        ctx.font = "12px monospace";
        ctx.fillText("Enemies: " + this.entities.filter((e) => e.type === "enemy").length, 10, 20);
        ctx.restore();
    }

    spawnEnemy() {
        const x = rand(40, this.w - 40);
        const en = new Enemy(this, x, -20, rand(20, 40));
        this.entities.push(en);
    }

    spawnCoin(x, y, val) {
        const c = new Coin(x, y, val);
        this.entities.push(c);
    }

    save() {
        const save = { player: this.player.serialize() };
        localStorage.setItem("rpg_space_save", JSON.stringify(save));
        // small UI feedback
        //console.log('saved');
    }

    static load() {
        try {
            const raw = localStorage.getItem("rpg_space_save");
            if (!raw) return null;
            return JSON.parse(raw);
        } catch (e) {
            return null;
        }
    }
}

// ---------- Basic collision AABB ----------
function collideRect(a, b) {
    return !(a.x + a.w < b.x || a.x > b.x + b.w || a.y + a.h < b.y || a.y > b.y + b.h);
}

// ---------- Entities ----------
class Entity {
    constructor(x, y, w, h) {
        this.x = x;
        this.y = y;
        this.w = w;
        this.h = h;
        this.active = true;
        this.type = "entity";
    }
    update(dt) {}
    draw(ctx) {
        ctx.fillStyle = "#fff";
        ctx.fillRect(this.x, this.y, this.w, this.h);
    }
}

class Player extends Entity {
    constructor(game, x, y) {
        super(x, y, 40, 40);
        this.game = game;
        this.type = "player";
        this.speed = 300; // px/sec
        this.maxHp = 10;
        this.hp = 10;
        this.coins = 0;

        this.damage = 1;
        this.fireRate = 2; // shots per second
        this.fireTimer = 0;
    }

    static default(game) {
        return new Player(game, game.w / 2 - 20, game.h - 100);
    }

    update(dt) {
        // input movement
        const inp = this.game.input;
        let dx = 0,
            dy = 0;
        if (inp.left) dx -= 1;
        if (inp.right) dx += 1;
        if (inp.up) dy -= 1;
        if (inp.down) dy += 1;
        // simple mouse follow if pointer active
        if (inp.pointer && inp.pointerActive) {
            const lerp = 10 * dt;
            this.x += (inp.pointer.x - (this.x + this.w / 2)) * lerp;
            this.y += (inp.pointer.y - (this.y + this.h / 2)) * lerp;
        } else {
            const len = Math.hypot(dx, dy);
            if (len > 0) {
                dx /= len;
                dy /= len;
                this.x += dx * this.speed * dt;
                this.y += dy * this.speed * dt;
            }
        }

        // clamp to screen
        this.x = clamp(this.x, 10, this.game.w - this.w - 10);
        this.y = clamp(this.y, 10, this.game.h - this.h - 10);

        // shooting (auto-shooting)
        this.fireTimer -= dt;
        if (this.fireTimer <= 0) {
            this.shoot();
            this.fireTimer = 1 / this.fireRate;
        }
    }

    draw(ctx) {
        // simple ship shape
        ctx.save();
        ctx.translate(this.x + this.w / 2, this.y + this.h / 2);
        ctx.fillStyle = "#28a0ff";
        ctx.beginPath();
        ctx.moveTo(0, -18);
        ctx.lineTo(12, 14);
        ctx.lineTo(-12, 14);
        ctx.closePath();
        ctx.fill();
        ctx.restore();

        // HP bar
        ctx.fillStyle = "rgba(255,255,255,0.1)";
        ctx.fillRect(this.x, this.y - 8, this.w, 4);
        ctx.fillStyle = "#22c55e";
        ctx.fillRect(this.x, this.y - 8, this.w * (this.hp / this.maxHp), 4);
    }

    shoot() {
        const b = new Bullet(this.x + this.w / 2 - 4, this.y - 10, 6, 14, this.damage);
        this.game.entities.push(b);
    }

    takeDamage(n) {
        this.hp -= n;
        if (this.hp <= 0) {
            this.hp = 0;
            this.die();
        }
        this.game.ui.updateStats();
    }

    die() {
        this.active = false;
        this.game.ui.toast("Ship destroyed — resetting (coins kept)");
        // respawn as simple
        setTimeout(() => {
            this.hp = this.maxHp;
            this.active = true;
            this.x = this.game.w / 2 - 20;
            this.y = this.game.h - 100;
        }, 800);
    }

    // upgrade helpers
    upgradeDamage(v) {
        this.damage += v;
        this.game.ui.updateStats();
    }
    upgradeFireRate(v) {
        this.fireRate += v;
        this.game.ui.updateStats();
    }
    upgradeSpeed(v) {
        this.speed += v;
        this.game.ui.updateStats();
    }
    upgradeMaxHp(v) {
        this.maxHp += v;
        this.hp += v;
        this.game.ui.updateStats();
    }

    serialize() {
        return {
            x: this.x,
            y: this.y,
            coins: this.coins,
            damage: this.damage,
            fireRate: this.fireRate,
            speed: this.speed,
            maxHp: this.maxHp,
            hp: this.hp,
        };
    }

    loadFromSave(obj) {
        if (!obj) return;
        this.x = obj.x ?? this.x;
        this.y = obj.y ?? this.y;
        this.coins = obj.coins ?? this.coins;
        this.damage = obj.damage ?? this.damage;
        this.fireRate = obj.fireRate ?? this.fireRate;
        this.speed = obj.speed ?? this.speed;
        this.maxHp = obj.maxHp ?? this.maxHp;
        this.hp = obj.hp ?? this.hp;
    }
}

class Enemy extends Entity {
    constructor(game, x, y, size = 30) {
        super(x, y, size, size);
        this.game = game;
        this.type = "enemy";
        this.speed = rand(40, 110);
        this.hp = Math.ceil(size / 10);
        this.maxHp = this.hp;
        this.value = Math.ceil(this.maxHp * 2);
    }

    update(dt) {
        this.y += this.speed * dt;
        // simple horizontal wiggle
        this.x += Math.sin((this.y + performance.now() / 50) / 40) * 20 * dt;
        if (this.y > this.game.h + 60) this.active = false;
    }

    draw(ctx) {
        ctx.save();
        ctx.translate(this.x + this.w / 2, this.y + this.h / 2);
        ctx.fillStyle = "#ff7b7b";
        ctx.beginPath();
        ctx.arc(0, 0, this.w / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // hp
        ctx.fillStyle = "rgba(0,0,0,0.3)";
        ctx.fillRect(this.x, this.y - 6, this.w, 4);
        ctx.fillStyle = "#f97316";
        ctx.fillRect(this.x, this.y - 6, this.w * (this.hp / this.maxHp), 4);
    }

    takeDamage(n) {
        this.hp -= n;
        if (this.hp <= 0) {
            this.active = false;
            this.game.particles.push(new Particle(this.x, this.y, "explode"));
            // drop coin
            this.game.spawnCoin(this.x + this.w / 2, this.y + this.h / 2, this.value);
        }
    }
}

class Bullet extends Entity {
    constructor(x, y, w, h, damage) {
        super(x, y, w, h);
        this.type = "bullet";
        this.speed = 500;
        this.damage = damage;
    }
    update(dt) {
        this.y -= this.speed * dt;
        if (this.y < -50) this.active = false;
    }
    draw(ctx) {
        ctx.fillStyle = "#ffd43b";
        ctx.fillRect(this.x, this.y, this.w, this.h);
    }
}

class Coin extends Entity {
    constructor(x, y, val) {
        super(x - 8, y - 8, 16, 16);
        this.type = "coin";
        this.vx = rand(-20, 20);
        this.vy = rand(-30, 10);
        this.value = val;
    }
    update(dt) {
        this.vy += 200 * dt;
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        if (this.y > 1000) this.active = false;
    }
    draw(ctx) {
        ctx.save();
        ctx.translate(this.x + 8, this.y + 8);
        ctx.fillStyle = "#ffd43b";
        ctx.beginPath();
        ctx.arc(0, 0, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

class Particle {
    constructor(x, y, type) {
        this.x = x;
        this.y = y;
        this.type = type;
        this.life = 0.5;
        this.alive = true;
        this.vx = rand(-50, 50);
        this.vy = rand(-50, 50);
    }
    update(dt) {
        this.life -= dt;
        if (this.life <= 0) this.alive = false;
        this.x += this.vx * dt;
        this.y += this.vy * dt;
    }
    draw(ctx) {
        ctx.fillStyle = "rgba(255,255,255," + this.life * 2 + ")";
        ctx.fillRect(this.x, this.y, 2, 2);
    }
}

// ---------- Input handler ----------
class Input {
    constructor() {
        this.left = false;
        this.right = false;
        this.up = false;
        this.down = false;
        this.pointer = { x: 0, y: 0 };
        this.pointerActive = false;

        window.addEventListener("keydown", (e) => {
            if (e.key === "ArrowLeft" || e.key === "a") this.left = true;
            if (e.key === "ArrowRight" || e.key === "d") this.right = true;
            if (e.key === "ArrowUp" || e.key === "w") this.up = true;
            if (e.key === "ArrowDown" || e.key === "s") this.down = true;
        });
        window.addEventListener("keyup", (e) => {
            if (e.key === "ArrowLeft" || e.key === "a") this.left = false;
            if (e.key === "ArrowRight" || e.key === "d") this.right = false;
            if (e.key === "ArrowUp" || e.key === "w") this.up = false;
            if (e.key === "ArrowDown" || e.key === "s") this.down = false;
        });

        window.addEventListener("pointerdown", (e) => {
            this.pointerActive = true;
            this.pointer.x = e.clientX;
            this.pointer.y = e.clientY;
        });
        window.addEventListener("pointerup", (e) => {
            this.pointerActive = false;
        });
        window.addEventListener("pointermove", (e) => {
            this.pointer.x = e.clientX;
            this.pointer.y = e.clientY;
        });
    }
}

// ---------- UI & Shop ----------
class UI {
    constructor(game) {
        this.game = game;
        this.coinsEl = document.getElementById("coins");
        this.levelEl = document.getElementById("level");
        this.damageEl = document.getElementById("damage");
        this.firerateEl = document.getElementById("firerate");
        this.speedEl = document.getElementById("speed");
        this.hpEl = document.getElementById("hp");
        this.shopEl = document.getElementById("shop");
        this.toastEl = document.getElementById("toast");

        document.getElementById("save-btn").addEventListener("click", () => {
            this.game.save();
            this.toast("Saved");
        });
        document.getElementById("reset-btn").addEventListener("click", () => {
            localStorage.removeItem("rpg_space_save");
            location.reload();
        });

        // simple mobile control buttons
        document.getElementById("left-btn").addEventListener("pointerdown", () => {
            this.game.input.left = true;
        });
        document.getElementById("left-btn").addEventListener("pointerup", () => {
            this.game.input.left = false;
        });
        document.getElementById("right-btn").addEventListener("pointerdown", () => {
            this.game.input.right = true;
        });
        document.getElementById("right-btn").addEventListener("pointerup", () => {
            this.game.input.right = false;
        });
        document.getElementById("up-btn").addEventListener("pointerdown", () => {
            this.game.input.up = true;
        });
        document.getElementById("up-btn").addEventListener("pointerup", () => {
            this.game.input.up = false;
        });
        document.getElementById("down-btn").addEventListener("pointerdown", () => {
            this.game.input.down = true;
        });
        document.getElementById("down-btn").addEventListener("pointerup", () => {
            this.game.input.down = false;
        });

        this.buildShop();
        this.updateStats();
    }

    buildShop() {
        this.shopEl.innerHTML = "";
        this.game.shopData.forEach((item) => {
            const el = document.createElement("div");
            el.className = "shop-item";
            el.innerHTML = `<div><div style=\"font-weight:600;color:#fff\">${item.name}</div><div class=\"small\">Cost: ${item.cost}</div></div>`;
            const buy = document.createElement("button");
            buy.className = "btn";
            buy.textContent = "Buy";
            buy.addEventListener("click", () => {
                if (this.game.player.coins >= item.cost) {
                    this.game.player.coins -= item.cost;
                    item.apply(this.game);
                    this.updateStats();
                    this.toast("Purchased " + item.name);
                } else this.toast("Not enough coins");
            });
            el.appendChild(buy);
            this.shopEl.appendChild(el);
        });
    }

    updateStats() {
        const p = this.game.player;
        this.coinsEl.textContent = p.coins;
        this.levelEl.textContent = Math.floor(1 + p.damage / 2);
        this.damageEl.textContent = p.damage.toFixed(1);
        this.firerateEl.textContent = p.fireRate.toFixed(1);
        this.speedEl.textContent = Math.round(p.speed);
        this.hpEl.textContent = p.hp + "/" + p.maxHp;
    }

    toast(msg, ms = 1400) {
        this.toastEl.textContent = msg;
        this.toastEl.classList.add("show");
        setTimeout(() => this.toastEl.classList.remove("show"), ms);
    }
}

// ---------- Boot & wiring ----------
(function () {
    const canvas = document.querySelector("canvas");
    // make canvas size match element size
    function size() {
        const rect = canvas.getBoundingClientRect();
        canvas.width = Math.floor(rect.width);
        canvas.height = Math.floor(rect.height);
    }
    size();
    window.addEventListener("resize", () => {
        size();
        if (window.game) {
            window.game.w = canvas.width;
            window.game.h = canvas.height;
        }
    });

    const G = new Game(canvas);
    window.game = G; // expose for dev
    G.start();
})();
