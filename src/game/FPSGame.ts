/**
 * FPSGame.ts
 * ----------
 * Main game engine class. Handles the Three.js scene, camera,
 * player movement, collision, shooting, enemy AI, and HUD state.
 *
 * Architecture overview:
 *  - Scene: Three.js WebGLRenderer + Scene + PerspectiveCamera
 *  - Player: camera IS the player view; position tracked separately
 *  - Map: axis-aligned boxes (AABB) for walls, cover blocks, floor
 *  - Shooting: raycasting from camera centre toward the crosshair
 *  - Enemy: a single coloured box; hit detection via bounding-box ray test
 *  - HUD: state values published via a callback so React can render them
 */

import * as THREE from "three";

const NORMAL_FOV = 75;
const ADS_FOV = 55;
const ADS_TRANSITION_SPEED = 10;

const NORMAL_WEAPON_X = 0.55;
const NORMAL_WEAPON_Y = -0.45;
const NORMAL_WEAPON_Z = -0.85;

const ADS_WEAPON_X = 0;
const ADS_WEAPON_Y = -0.28;
const ADS_WEAPON_Z = -0.65;

const RECOIL_RECOVERY_SPEED = 8;

// ---------------------------------------------------------------------------
// Types & Enums
// ---------------------------------------------------------------------------

type StanceType = "standing" | "crouching" | "prone";

export interface HUDState {
  health: number;
  // Ammo
  magAmmo: number;        // bullets left in the loaded magazine
  reserveAmmo: number;    // bullets held in reserve
  magSize: number;        // max magazine capacity
  isReloading: boolean;
  reloadProgress: number; // 0 = just started, 1 = complete
  // Game state
  gameOver: boolean;
  won: boolean;
  enemyHealth: number;
  maxEnemyHealth: number;
  showHitMarker: boolean;
  // Damage feedback
  lastDamageAmount: number;  // amount of damage taken (0 if not damaged this frame)
  damageFlashActive: boolean; // red screen flash is visible
  deathTintActive: boolean;   // red tint while dead / respawning
  // Match state
  matchTime: number; // seconds remaining
  playerKills: number;
  enemyKills: number;
  scoreboard: Array<{ id: string; name: string; kills: number; isYou: boolean }>;
  resultLabel: string;
  matchActive: boolean;
}

export type HUDCallback = (state: HUDState) => void;

// ---------------------------------------------------------------------------
// ★ MOVEMENT SETTINGS — change any value here to tune how movement feels ★
// ---------------------------------------------------------------------------

// -- Speeds (units per second) --
const WALK_SPEED   = 6;       // normal walking pace
const SPRINT_SPEED = 11;      // Shift held — full sprint
const CROUCH_SPEED = 3.6;     // 60% of walk speed — crouched movement
const PRONE_SPEED  = 1.8;     // 30% of walk speed — prone movement

// -- Stance system (C key): tap to toggle crouch, hold for ~0.75s to toggle prone --
const PRONE_HOLD_TIME = 0.75; // seconds to hold C to toggle prone (instead of crouch)

// -- Jump & gravity --
const JUMP_STRENGTH = 7;   // upward velocity applied the instant Space is pressed
const GRAVITY       = 22;  // downward pull each second² (higher = snappier landing)

// -- Acceleration & friction --
const ACCELERATION  = 28;  // how quickly the player reaches target speed (units/s²)
const DECELERATION  = 20;  // how quickly the player stops after releasing keys (units/s²)

// -- Camera & weapon bob --
const BOB_STRENGTH_WALK   = 0.015; // vertical amplitude while walking
const BOB_STRENGTH_SPRINT = 0.028; // vertical amplitude while sprinting
const BOB_STRENGTH_CROUCH = 0.008; // vertical amplitude while crouching
const BOB_STRENGTH_PRONE  = 0.004; // vertical amplitude while prone (slower, less pronounced)
const BOB_SPEED_WALK      = 9;     // oscillation cycles/sec while walking
const BOB_SPEED_SPRINT    = 14;    // oscillation cycles/sec while sprinting
const BOB_SPEED_CROUCH    = 5;     // oscillation cycles/sec while crouching
const BOB_SPEED_PRONE     = 3;     // oscillation cycles/sec while prone (slower)

// -- Player body --
const STAND_HEIGHT  = 1.7;  // eye height above floor when standing
const CROUCH_HEIGHT = 1.0;  // eye height above floor when crouching
const PRONE_HEIGHT  = 0.35; // eye height above floor when prone (very low)
const PLAYER_RADIUS = 0.4;  // horizontal collision radius

// Match / respawn settings
const MATCH_LENGTH_SECONDS = 120; // match duration in seconds
const RESPAWN_DELAY = 2.0;       // seconds to wait before respawning (enemy/player)
const DEATH_ANIM_TIME = 1.0;     // seconds for player death animation

// Health regeneration
const HEALTH_REGEN_DELAY = 3.0;  // seconds after last damage before regen starts
const PLAYER_REGEN_RATE = 4.0;   // health per second
const ENEMY_REGEN_RATE = 3.0;    // health per second

// ---------------------------------------------------------------------------
// ★ WEAPON SETTINGS — change any value here to tune the shooting feel ★
// ---------------------------------------------------------------------------

const PLAYER_BODY_DAMAGE      = 10;   // base damage for body shots from the player
const ENEMY_BULLET_DAMAGE      = 10;   // damage per enemy bullet hit
const HEADSHOT_MULTIPLIER      = 2.0;  // headshots multiply base damage
const WEAPON_FIRE_RATE        = 0.12; // minimum seconds between shots (≈ 8 shots/sec)
const WEAPON_RANGE            = 80;   // max raycast distance in world units
const MUZZLE_FLASH_DURATION   = 0.06; // seconds the muzzle flash glows after a shot
const HIT_MARKER_DURATION     = 0.18; // seconds the hit-marker (×) is visible on screen
const IMPACT_DURATION         = 0.8;  // seconds a bullet-impact dot stays on a wall
const WEAPON_SWAY_STRENGTH    = 0.04; // max lateral weapon drift when moving (units)
const WEAPON_SWAY_SPEED       = 5.0;  // how quickly the weapon snaps back to centre
const ADS_SPEED_MULT          = 0.65; // movement speed multiplier while aiming
const ADS_SENSITIVITY_MULT    = 0.55; // mouse sensitivity multiplier while aiming
const RECOIL_AIMING_MULT      = 0.75; // reduce recoil strength while aiming
const RECOIL_PITCH            = 0.08; // vertical recoil amount per shot
const RECOIL_YAW              = 0.04; // horizontal recoil amount per shot

// ---------------------------------------------------------------------------
// ★ PLAYER HEALTH SYSTEM — easy to customize ★
// ---------------------------------------------------------------------------
const MAX_HEALTH                    = 100;   // starting player health
const DAMAGE_FLASH_DURATION         = 0.15;  // red screen flash when hit (seconds)
const DAMAGE_FLASH_OPACITY          = 0.35;  // how intense the red flash is
const DAMAGE_FLASH_EDGE_VIGNETTE    = 0.4;   // edge darkening intensity when hit

// ---------------------------------------------------------------------------
// ★ ENEMY HEALTH & DAMAGE SYSTEM — easy to customize ★
// ---------------------------------------------------------------------------
const ENEMY_HEALTH                  = 100;   // enemy starting health
const ENEMY_SHOOT_INTERVAL          = 2.0;   // seconds between enemy shots
const ENEMY_ATTACK_RANGE            = 18;    // max distance enemy can shoot
const ENEMY_HIT_FLASH_DURATION      = 0.18;  // enemy white flash when hit
const ENEMY_COUNT                   = 5;     // number of enemy bots in the match
const ENEMY_MOVE_SPEED              = 2.0;   // wandering/movement speed
const ENEMY_FIRE_RATE               = 1.2;   // seconds per shot from enemies (lower = faster)
const ENEMY_ACCURACY                = 0.72;  // 0..1 where 1 is perfect accuracy
const ENEMY_TRACER_DURATION         = 0.14;  // seconds enemy tracer remains visible
const ENEMY_SPAWN_POINTS: Array<[number, number, number]> = [
  [-12, 0.9, -12],
  [12, 0.9, -12],
  [-12, 0.9, 12],
  [12, 0.9, 12],
  [0, 0.9, 0],
];

const PLAYER_SPAWN_POINTS: Array<[number, number, number]> = [
  [0, STAND_HEIGHT, 12],
  [6, STAND_HEIGHT, 10],
  [-6, STAND_HEIGHT, 10],
  [8, STAND_HEIGHT, 8],
  [-8, STAND_HEIGHT, 8],
];

// ---------------------------------------------------------------------------
// Other game constants
// ---------------------------------------------------------------------------
const MOUSE_SENSITIVITY  = 0.002;
// ── Ammo & reload (easy to tune) ─────────────────────────────────────────
const MAG_SIZE           = 30;   // bullets per magazine
const RELOAD_MAGAZINES   = 3;    // number of spare magazines carried
const RESERVE_AMMO       = MAG_SIZE * RELOAD_MAGAZINES; // starting reserve supply
const RELOAD_TIME        = 1.5;  // seconds to complete a reload
// Reload animation tuning
const RELOAD_GUN_ROTATION   = 1.2;  // radians; gun tilts sideways this much (≈69°)
const RELOAD_MAG_DROP_DISTANCE = 0.35;  // how far magazine drops down (units)
const RELOAD_HAND_MOVE_DIST = 0.17;   // how far the placeholder hand travels (units) — tuned for left-side insertion
const RELOAD_MIDPOINT_RATIO = 0.5;   // at 50% progress, swap from old to new magazine
// ─────────────────────────────────────────────────────────────────────────

// Enemy HUD positioning (easy to tweak)
const ENEMY_HEALTHBAR_Y = 1.55;   // world-local Y position for enemy health bar (lower = closer to head)
const ENEMY_NAME_OFFSET = 0.18;   // vertical offset above the health bar for the name label
const ENEMY_NAME_FONT_SIZE = 56;  // font size for enemy name labels
const ENEMY_NAME_LABEL_WIDTH = 0.9; // world units for the name label plane width
const ENEMY_NAME_LABEL_HEIGHT = 0.24; // world units for the name label plane height

// ---------------------------------------------------------------------------
// Helper — Axis-Aligned Bounding Box (AABB) for collision
// ---------------------------------------------------------------------------
interface AABB {
  minX: number; maxX: number;
  minY: number; maxY: number;
  minZ: number; maxZ: number;
}

interface EnemyState {
  id: number;
  mesh: THREE.Group;
  bodyBox: AABB;
  headBox: AABB;
  health: number;
  alive: boolean;
  dying: boolean;
  deathTimer: number;
  shootTimer: number;
  moveDir: THREE.Vector3;
  moveTimer: number;
  muzzleFlash: THREE.Mesh;
  muzzleFlashTimer: number;
  healthBar: THREE.Group;
  healthBarFore: THREE.Mesh;
  respawnTimer: number;
  lastDamageTimer: number;
  regenAccum: number;
  targetType: "player" | "enemy" | null;
  targetId: number | null;
  kills: number;
  hitTimer: number;
  hitColor: THREE.Color;
  normalColor: THREE.Color;
}

function makeAABB(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number): AABB {
  return {
    minX: cx - sx / 2, maxX: cx + sx / 2,
    minY: cy - sy / 2, maxY: cy + sy / 2,
    minZ: cz - sz / 2, maxZ: cz + sz / 2,
  };
}

// ---------------------------------------------------------------------------
// FPSGame class
// ---------------------------------------------------------------------------
export class FPSGame {
  // Three.js core
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;

  // Weapon mesh visible in the bottom-right of the screen
  // It lives in a separate "weapon scene" rendered on top
  private weaponScene: THREE.Scene;
  private weaponCamera: THREE.PerspectiveCamera;
  private weaponMesh!: THREE.Group;
  private magazineMesh!: THREE.Mesh;  // magazine object for reload animation
  private handMesh!: THREE.Mesh;      // placeholder hand for inserting magazine
  private weaponBobTime = 0;
  private isAiming = false;
  private aimBlend = 0;
  private recoilX = 0;
  private recoilY = 0;

  // Player state
  // Start at Z=12 — clear of all crates (the center crate runs from Z=4.5 to Z=7.5)
  private playerPos = new THREE.Vector3(0, STAND_HEIGHT, 12);
  private yaw = 0;   // horizontal rotation (radians)
  private pitch = 0; // vertical look (radians)

  // Horizontal velocity (world-space X and Z, in units/s)
  // These accelerate/decelerate smoothly rather than being set instantly
  private velX = 0;
  private velZ = 0;

  // Vertical velocity for gravity and jumping
  private velocityY = 0;

  // Movement state flags — set each frame from input keys
  private isGrounded = true;
  private isSprinting = false;
  private stance: StanceType = "standing"; // "standing", "crouching", or "prone"

  // Stance toggle tracking (C key press timing)
  private cKeyPressTime = 0;      // how long C has been held (seconds)
  private cKeyWasPressedLastFrame = false; // to prevent repeated toggles during one press
  private toggleHappened = false; // whether we've already toggled during this C press

  // Current eye height — smoothly interpolated toward target for current stance
  private eyeHeight = STAND_HEIGHT;

  // Input tracking
  private keys: Record<string, boolean> = {};
  private pointerLocked = false;

  // Collision obstacles (all static geometry except the floor)
  private obstacles: AABB[] = [];

  // Enemy
  private enemies: EnemyState[] = [];
  // Match & scoring
  private playerKills = 0;
  private enemyKills = 0;
  private matchTime = MATCH_LENGTH_SECONDS; // seconds remaining
  private matchActive = false;
  // Regeneration timers (countdown after last damage)
  private lastPlayerDamageTimer = 0;
  private lastEnemyDamageTimer = 0;
  private playerRegenAccum = 0;
  private enemyRegenAccum = 0;
  // Player death animation state
  private playerDying = false;
  private playerDeathTimer = 0;
  // Player respawn state
  private playerDead = false;
  private playerRespawnTimer = 0;

  // Bullet flash indicators (muzzle flash sphere)
  private muzzleFlash!: THREE.Mesh;
  private muzzleFlashTimer = 0;

  // Engine-managed timers (replace setTimeout usage)
  private nextTimerId = 1;
  private respawnTimers: Map<number, { time: number; cb: () => void }> = new Map();

  // Player damage flash overlay
  private damageFlash!: THREE.Mesh;
  private damageVignette!: THREE.Mesh;
  private damageFlashTimer = 0;

  // Shoot hit flash on enemy
  private enemyFlashTimer = 0;

  // Weapon timing & effects
  private fireTimer      = 0;   // counts down; next shot only when ≤ 0
  private hitMarkerTimer = 0;   // counts down; hit-marker (×) shown while > 0
  private impacts: { mesh: THREE.Mesh; timer: number }[] = []; // wall impact dots
  private damageNumbers: { mesh: THREE.Mesh; timer: number; vel: THREE.Vector3 }[] = [];
  private swayX = 0;            // current weapon sway offsets (smoothed)
  private swayY = 0;
  private enemyNormalColor = new THREE.Color(0xe74c3c);
  private enemyHitColor = new THREE.Color(0xffffff);

  // Player stats
  private health      = MAX_HEALTH;
  private lastDamageAmount = 0; // track damage for HUD feedback
  private magAmmo     = MAG_SIZE;    // bullets in the loaded magazine
  private reserveAmmo = RESERVE_AMMO; // bullets remaining in reserve
  private isReloading = false;
  private reloadTimer = 0;
  private reloadAmmoRefilled = false;  // track if ammo was refilled at midpoint
  private gameOver = false;
  private won = false;

  // HUD callback — React uses this to re-render the overlay
  private hudCallback: HUDCallback;

  // Animation loop handle
  private animFrameId = 0;
  private lastTime = 0;

  // Event listener references (kept for cleanup)
  private onMouseMove: (e: MouseEvent) => void;
  private onMouseDown: (e: MouseEvent) => void;
  private onMouseUp: (e: MouseEvent) => void;
  private onKeyDown: (e: KeyboardEvent) => void;
  private onKeyUp: (e: KeyboardEvent) => void;
  private onPointerLockChange: () => void;
  private onContextMenu: (e: MouseEvent) => void;

  // Container DOM element
  private container: HTMLDivElement;

  constructor(container: HTMLDivElement, hudCallback: HUDCallback) {
    this.container = container;
    this.hudCallback = hudCallback;

    // ------------------------------------------------------------------
    // Renderer setup
    // Try WebGL2 first (better performance), fall back to WebGL1
    // ------------------------------------------------------------------
    const canvas = document.createElement("canvas");
    container.appendChild(canvas);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: "high-performance",
      // Explicitly request a context so Three.js doesn't fail silently
      context: (() => {
        return (
          canvas.getContext("webgl2") ??
          canvas.getContext("webgl") ??
          canvas.getContext("experimental-webgl") ??
          undefined
        );
      })() as WebGLRenderingContext | undefined,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.autoClear = false; // we clear manually to layer weapon on top

    // ------------------------------------------------------------------
    // Main scene: environment camera
    // ------------------------------------------------------------------
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a2e); // dark blue sky
    this.scene.fog = new THREE.Fog(0x1a1a2e, 20, 60);

    const aspect = container.clientWidth / container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(80, aspect, 0.05, 100);
    this.camera.position.copy(this.playerPos);

    // ------------------------------------------------------------------
    // Weapon scene: separate scene rendered on top; no fog
    // ------------------------------------------------------------------
    this.weaponScene = new THREE.Scene();
    this.weaponCamera = new THREE.PerspectiveCamera(60, aspect, 0.01, 10);
    this.weaponCamera.position.set(0, 0, 0);
    this.buildWeaponMesh();

    // ------------------------------------------------------------------
    // Lighting
    // ------------------------------------------------------------------
    const ambient = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xffeedd, 1.2);
    sun.position.set(10, 20, 10);
    this.scene.add(sun);

    // Weapon scene needs its own light so the gun is always visible
    this.weaponScene.add(new THREE.AmbientLight(0xffffff, 1));

    // ------------------------------------------------------------------
    // Build the map
    // ------------------------------------------------------------------
    this.buildMap();

    // ------------------------------------------------------------------
    // Build the enemies
    // ------------------------------------------------------------------
    this.buildEnemies();

    // Note: muzzleFlash is already created and positioned inside
    // buildWeaponMesh() — no second flash needed here.

    // ------------------------------------------------------------------
    // Input event listeners
    // ------------------------------------------------------------------
    this.onKeyDown = (e) => { this.keys[e.code] = true; this.handleKeyPress(e); };
    this.onKeyUp = (e) => { this.keys[e.code] = false; };
    this.onMouseMove = (e) => this.handleMouseMove(e);
    this.onMouseDown = (e) => this.handleMouseDown(e);
    this.onMouseUp = (e) => this.handleMouseUp(e);
    this.onPointerLockChange = () => {
      this.pointerLocked = document.pointerLockElement === this.renderer.domElement;
      if (!this.pointerLocked) {
        this.isAiming = false;
      } else {
        // Start the match when the player locks the pointer (begins gameplay)
        if (!this.matchActive && this.matchTime > 0) {
          this.matchActive = true;
        }
      }
    };

    document.addEventListener("keydown", this.onKeyDown);
    document.addEventListener("keyup", this.onKeyUp);
    document.addEventListener("mousemove", this.onMouseMove);
    document.addEventListener("mousedown", this.onMouseDown);
    document.addEventListener("mouseup", this.onMouseUp);
    document.addEventListener("pointerlockchange", this.onPointerLockChange);

    // Disable the browser right-click menu while the player is in the game
    this.onContextMenu = (e) => {
      if (this.pointerLocked) {
        e.preventDefault();
      }
    };
    document.addEventListener("contextmenu", this.onContextMenu);

    // Click canvas to request pointer lock
    this.renderer.domElement.addEventListener("click", () => {
      if (!this.pointerLocked) {
        this.renderer.domElement.requestPointerLock();
      }
    });

    // Handle resize
    window.addEventListener("resize", () => this.onResize());

    // ------------------------------------------------------------------
    // Start game loop
    // ------------------------------------------------------------------
    this.lastTime = performance.now();
    this.loop(this.lastTime);
    this.publishHUD();
  }

  // -----------------------------------------------------------------------
  // Engine timer helpers — schedule, cancel, and process timers inside loop
  // -----------------------------------------------------------------------
  private scheduleTimer(delaySeconds: number, cb: () => void): number {
    const id = this.nextTimerId++;
    this.respawnTimers.set(id, { time: delaySeconds, cb });
    return id;
  }

  private cancelTimer(id: number) {
    this.respawnTimers.delete(id);
  }

  private cancelAllTimers() {
    this.respawnTimers.clear();
  }

  private updateTimers(dt: number) {
    if (this.respawnTimers.size === 0) return;
    const toFire: number[] = [];
    for (const [id, t] of this.respawnTimers.entries()) {
      t.time -= dt;
      if (t.time <= 0) toFire.push(id);
      else this.respawnTimers.set(id, t);
    }
    for (const id of toFire) {
      const t = this.respawnTimers.get(id);
      if (!t) continue;
      this.respawnTimers.delete(id);
      try {
        t.cb();
      } catch (err) {
        // swallow exceptions to avoid breaking the loop
        console.error("Timer callback error:", err);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Weapon model: a simple rectangular box resembling a pistol grip + barrel
  // -----------------------------------------------------------------------
  private buildWeaponMesh() {
    const group = new THREE.Group();

    // Magazine — small box hanging below grip (insert point)
    const magGeo = new THREE.BoxGeometry(0.06, 0.12, 0.08);
    const magMat = new THREE.MeshLambertMaterial({ color: 0x3d3d3d });
    const mag = new THREE.Mesh(magGeo, magMat);
    mag.position.set(-0.08, -0.14, 0.06);
    group.add(mag);
    this.magazineMesh = mag;

    // Barrel — long thin box
    const barrelGeo = new THREE.BoxGeometry(0.05, 0.05, 0.35);
    const barrelMat = new THREE.MeshLambertMaterial({ color: 0x444444 });
    const barrel = new THREE.Mesh(barrelGeo, barrelMat);
    barrel.position.set(0, 0, -0.1);
    group.add(barrel);

    // Grip — wider taller box behind the barrel
    const gripGeo = new THREE.BoxGeometry(0.08, 0.14, 0.16);
    const gripMat = new THREE.MeshLambertMaterial({ color: 0x222222 });
    const grip = new THREE.Mesh(gripGeo, gripMat);
    grip.position.set(0, -0.06, 0.08);
    group.add(grip);

    // Slide — slightly wider than barrel, on top
    const slideGeo = new THREE.BoxGeometry(0.07, 0.07, 0.28);
    const slideMat = new THREE.MeshLambertMaterial({ color: 0x555555 });
    const slide = new THREE.Mesh(slideGeo, slideMat);
    slide.position.set(0, 0.02, -0.05);
    group.add(slide);

    // Position the weapon in the weapon scene (bottom-right of view)
    group.position.set(0.22, -0.18, -0.4);
    this.weaponScene.add(group);
    this.weaponMesh = group;

    // Muzzle flash position at barrel tip, attached to the weapon group
    this.muzzleFlash = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffcc00 })
    );
    this.muzzleFlash.position.set(0, 0, -0.28);
    this.muzzleFlash.visible = false;
    this.weaponMesh.add(this.muzzleFlash);

    // Placeholder hand for reload animation — simple box to push magazine in
    const handGeo = new THREE.BoxGeometry(0.08, 0.12, 0.06);
    const handMat = new THREE.MeshLambertMaterial({ color: 0xffb88c }); // skin tone
    this.handMesh = new THREE.Mesh(handGeo, handMat);
    this.handMesh.position.set(-0.25, -0.22, -0.4);  // start position off to the side
    this.handMesh.visible = false;
    this.weaponScene.add(this.handMesh);

    // Red full-screen damage flash overlay
    this.damageFlash = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.MeshBasicMaterial({
        color: 0xff0000,
        transparent: true,
        opacity: DAMAGE_FLASH_OPACITY,
        depthWrite: false,
      })
    );
    this.damageFlash.position.set(0, 0, -0.5);
    this.damageFlash.visible = false;
    this.weaponScene.add(this.damageFlash);

    // Optional: vignette effect for damage (darkened edges)
    // This adds a "punch" feeling when hit
    const vignetteGeo = new THREE.PlaneGeometry(2, 2);
    const vignetteMat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      // Radial gradient: bright center, dark edges
      const gradient = ctx.createRadialGradient(64, 64, 20, 64, 64, 100);
      gradient.addColorStop(0, "rgba(0,0,0,0)");
      gradient.addColorStop(1, "rgba(0,0,0,1)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 128, 128);
    }
    const vignetteTexture = new THREE.CanvasTexture(canvas);
    vignetteMat.map = vignetteTexture;
    this.damageVignette = new THREE.Mesh(vignetteGeo, vignetteMat);
    this.damageVignette.position.set(0, 0, -0.49);
    this.damageVignette.visible = false;
    this.weaponScene.add(this.damageVignette);
  }

  // -----------------------------------------------------------------------
  // Build the test map
  // Every solid geometry also gets an AABB pushed to this.obstacles
  // -----------------------------------------------------------------------
  private buildMap() {
    const addBox = (
      cx: number, cy: number, cz: number,
      sx: number, sy: number, sz: number,
      color: number,
      isSolid = true
    ) => {
      const geo = new THREE.BoxGeometry(sx, sy, sz);
      const mat = new THREE.MeshLambertMaterial({ color });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(cx, cy, cz);
      this.scene.add(mesh);
      if (isSolid) {
        this.obstacles.push(makeAABB(cx, cy, cz, sx, sy, sz));
      }
    };

    // --- Floor (no collision — player stays at fixed Y) ---
    addBox(0, 0, 0, 40, 0.2, 40, 0x2d5a27, false);

    // --- Ceiling ---
    addBox(0, 4.5, 0, 40, 0.2, 40, 0x1a1a2e, false);

    // --- Outer walls (N, S, E, W) ---
    // North (+Z side)
    addBox(0, 2.25, -20, 40, 4.5, 0.5, 0x3d3d3d);
    // South
    addBox(0, 2.25,  20, 40, 4.5, 0.5, 0x3d3d3d);
    // East (+X side)
    addBox( 20, 2.25, 0, 0.5, 4.5, 40, 0x3d3d3d);
    // West
    addBox(-20, 2.25, 0, 0.5, 4.5, 40, 0x3d3d3d);

    // --- Interior wall dividing the map into two halves ---
    // Left segment
    addBox(-8, 2.25, 0, 12, 4.5, 0.5, 0x555555);
    // Right segment (gap in the middle for passage)
    addBox( 9, 2.25, 0, 10, 4.5, 0.5, 0x555555);

    // --- Cover blocks in player spawn area ---
    addBox(-4, 0.75, 8,  2, 1.5, 1, 0x8b4513); // left crate
    addBox( 4, 0.75, 8,  2, 1.5, 1, 0x8b4513); // right crate
    addBox( 0, 0.75, 6,  1, 1.5, 3, 0x8b4513); // centre crate

    // --- Cover blocks in enemy area ---
    addBox(-5, 0.75, -8, 2, 1.5, 1, 0x6b6b6b);
    addBox( 5, 0.75, -8, 2, 1.5, 1, 0x6b6b6b);
    addBox( 0, 0.75,-10, 3, 1.5, 1, 0x6b6b6b);

    // --- Low barriers along the central corridor ---
    addBox(-14, 0.5, -5, 4, 1, 0.5, 0x888888);
    addBox(-14, 0.5,  5, 4, 1, 0.5, 0x888888);
    addBox( 14, 0.5, -5, 4, 1, 0.5, 0x888888);
    addBox( 14, 0.5,  5, 4, 1, 0.5, 0x888888);

    // --- Decorative pillars at the four quadrant corners ---
    addBox(-10, 2.25, -10, 1, 4.5, 1, 0x4a4a4a);
    addBox( 10, 2.25, -10, 1, 4.5, 1, 0x4a4a4a);
    addBox(-10, 2.25,  10, 1, 4.5, 1, 0x4a4a4a);
    addBox( 10, 2.25,  10, 1, 4.5, 1, 0x4a4a4a);

    // --- Floor grid lines for orientation (not solid) ---
    // Grid lines help the player judge distances
    for (let i = -18; i <= 18; i += 4) {
      addBox(i, 0.12, 0, 0.1, 0.05, 36, 0x3a3a3a, false);
      addBox(0, 0.12, i, 36, 0.05, 0.1, 0x3a3a3a, false);
    }
  }

  // -----------------------------------------------------------------------
  // Build the enemy bots
  // -----------------------------------------------------------------------
  private buildEnemies() {
    for (let i = 0; i < ENEMY_COUNT; i += 1) {
      const spawn = ENEMY_SPAWN_POINTS[i % ENEMY_SPAWN_POINTS.length];
      const enemy = this.createEnemy(i, new THREE.Vector3(spawn[0], spawn[1], spawn[2]));
      this.enemies.push(enemy);
      this.scene.add(enemy.mesh);
    }
  }

  private createEnemy(id: number, position: THREE.Vector3): EnemyState {
    const group = new THREE.Group();

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 1.8, 0.5),
      new THREE.MeshLambertMaterial({ color: 0xe74c3c })
    );
    group.add(body);

    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.5, 0.5),
      new THREE.MeshLambertMaterial({ color: 0xffcc88 })
    );
    head.position.set(0, 1.15, 0);
    body.add(head);

    const muzzleFlash = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 6, 4),
      new THREE.MeshBasicMaterial({ color: 0xffee88 })
    );
    muzzleFlash.position.set(0.4, 0.8, -0.25);
    muzzleFlash.visible = false;
    group.add(muzzleFlash);

    const hbGroup = new THREE.Group();
    hbGroup.position.set(0, ENEMY_HEALTHBAR_Y, 0);

    const hbBg = new THREE.Mesh(
      new THREE.PlaneGeometry(1.0, 0.12),
      new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.9 })
    );
    hbBg.position.set(0, 0, 0);
    hbGroup.add(hbBg);

    const hbFore = new THREE.Mesh(
      new THREE.PlaneGeometry(0.96, 0.08),
      new THREE.MeshBasicMaterial({ color: 0xe74c3c })
    );
    hbFore.position.set(0, 0, 0.001);
    hbGroup.add(hbFore);
    group.add(hbGroup);

    // Name label: small canvas texture placed above the health bar
    const nameCanvas = document.createElement("canvas");
    nameCanvas.width = 256; nameCanvas.height = 96;
    const nctx = nameCanvas.getContext("2d")!;
    nctx.clearRect(0, 0, nameCanvas.width, nameCanvas.height);
    nctx.font = `bold ${ENEMY_NAME_FONT_SIZE}px sans-serif`;
    nctx.textAlign = "center";
    nctx.textBaseline = "middle";
    nctx.fillStyle = "#ffffff";
    const displayName = `Player ${id + 1}`;
    nctx.fillText(displayName, nameCanvas.width / 2, nameCanvas.height / 2);
    const nameTex = new THREE.CanvasTexture(nameCanvas);
    const nameMat = new THREE.MeshBasicMaterial({ map: nameTex, transparent: true });
    const nameGeo = new THREE.PlaneGeometry(ENEMY_NAME_LABEL_WIDTH, ENEMY_NAME_LABEL_HEIGHT);
    const nameMesh = new THREE.Mesh(nameGeo, nameMat);
    nameMesh.position.set(0, ENEMY_NAME_OFFSET, 0.002);
    hbGroup.add(nameMesh);

    group.position.copy(position);
    group.rotation.set(0, 0, 0);

    const enemy: EnemyState = {
      id,
      mesh: group,
      bodyBox: makeAABB(position.x, position.y, position.z, 0.8, 1.8, 0.5),
      headBox: makeAABB(position.x, position.y + 1.15, position.z, 0.5, 0.5, 0.5),
      health: ENEMY_HEALTH,
      alive: true,
      dying: false,
      deathTimer: 0,
      shootTimer: ENEMY_FIRE_RATE * 0.5 + Math.random() * ENEMY_FIRE_RATE,
      moveDir: new THREE.Vector3(Math.random() * 2 - 1, 0, Math.random() * 2 - 1).normalize(),
      moveTimer: 1 + Math.random() * 2,
      muzzleFlash,
      muzzleFlashTimer: 0,
      healthBar: hbGroup,
      healthBarFore: hbFore,
      respawnTimer: 0,
      lastDamageTimer: 0,
      regenAccum: 0,
      targetType: null,
      targetId: null,
      kills: 0,
      hitTimer: 0,
      hitColor: new THREE.Color(0xffffff),
      normalColor: new THREE.Color(0xe74c3c),
    };

    return enemy;
  }

  private updateEnemyAABB(enemy: EnemyState) {
    const p = enemy.mesh.position;
    enemy.bodyBox = makeAABB(p.x, p.y, p.z, 0.8, 1.8, 0.5);
    enemy.headBox = makeAABB(p.x, p.y + 1.15, p.z, 0.5, 0.5, 0.5);
  }

  // -----------------------------------------------------------------------
  // Main game loop
  // -----------------------------------------------------------------------
  private loop(time: number) {
    this.animFrameId = requestAnimationFrame((t) => this.loop(t));

    const dt = Math.min((time - this.lastTime) / 1000, 0.05); // seconds, clamped
    this.lastTime = time;

    if (!this.gameOver) {
      // advance engine-managed timers first
      this.updateTimers(dt);

      // Update match timer
      if (this.matchActive) {
        this.matchTime = Math.max(0, this.matchTime - dt);
        // publish so HUD updates every frame
        this.publishHUD();
        if (this.matchTime <= 0) {
          // End match
          this.matchActive = false;
          this.gameOver = true;
          this.won = this.playerKills > this.enemyKills;
          // Cancel pending timers and stop gameplay actions
          this.cancelAllTimers();
          this.publishHUD();
        }
      }

      // Regeneration (player & enemy)
      this.updateRegeneration(dt);

      this.updateReload(dt);
      this.updateMovement(dt);
      this.updateEnemies(dt);
      this.updateMuzzleFlash(dt);
      this.updateWeapon(dt);
    }

    this.render();
  }

  // -----------------------------------------------------------------------
  // Movement — WASD + sprint/crouch/jump, smooth acceleration, gravity
  // -----------------------------------------------------------------------
  private updateMovement(dt: number) {
    if (this.playerDead || this.playerDying) {
      this.velX = 0;
      this.velZ = 0;
      this.velocityY = 0;
      this.isGrounded = true;
      this.isSprinting = false;
      return;
    }

    // ── 1. Handle C key for stance toggle (tap to crouch, hold for prone) ──
    const cKeyPressed = !!this.keys["KeyC"];

    if (cKeyPressed && !this.cKeyWasPressedLastFrame) {
      // C key just pressed — start tracking the hold time
      this.cKeyPressTime = 0;
      this.toggleHappened = false;
    } else if (cKeyPressed) {
      // C key is held — accumulate hold time
      this.cKeyPressTime += dt;

      // Check if hold time reached the prone threshold and we haven't toggled yet
      if (this.cKeyPressTime >= PRONE_HOLD_TIME && !this.toggleHappened) {
        // Long press: toggle prone (between standing ↔ prone, or crouch ↔ prone)
        if (this.stance === "prone") {
          this.stance = "standing";
        } else {
          this.stance = "prone";
        }
        this.toggleHappened = true;
      }
    } else if (this.cKeyWasPressedLastFrame && this.cKeyPressTime < PRONE_HOLD_TIME && !this.toggleHappened) {
      // C key just released after a short press (and we haven't toggled yet)
      // Toggle crouch (standing ↔ crouch, or prone ↔ crouch if coming from prone)
      if (this.stance === "crouching") {
        this.stance = "standing";
      } else if (this.stance === "standing") {
        this.stance = "crouching";
      } else if (this.stance === "prone") {
        // From prone with short press: go to crouch instead of standing
        this.stance = "crouching";
      }
      this.toggleHappened = true;
    }

    this.cKeyWasPressedLastFrame = cKeyPressed;

    // ── 2. Prevent sprint while crouched or prone ───────────────────────
    const isLowStance = this.stance === "crouching" || this.stance === "prone";
    this.isSprinting  = !isLowStance &&
                        !!(this.keys["ShiftLeft"] || this.keys["ShiftRight"]);

    // ── 3. Pick the target speed based on stance ──────────────────────────
    const baseSpeed = this.isSprinting  ? SPRINT_SPEED
                     : this.stance === "prone"     ? PRONE_SPEED
                     : this.stance === "crouching" ? CROUCH_SPEED
                     : WALK_SPEED;
    const targetSpeed = baseSpeed * (this.isAiming ? ADS_SPEED_MULT : 1);

    // ── 4. Build input direction in camera-local space ──────────────
    let inputX = 0, inputZ = 0;
    if (this.keys["KeyW"] || this.keys["ArrowUp"])    inputZ += 1;
    if (this.keys["KeyS"] || this.keys["ArrowDown"])  inputZ -= 1;
    if (this.keys["KeyA"] || this.keys["ArrowLeft"])  inputX -= 1;
    if (this.keys["KeyD"] || this.keys["ArrowRight"]) inputX += 1;

    const hasInput = inputX !== 0 || inputZ !== 0;

    if (hasInput) {
      const len = Math.sqrt(inputX * inputX + inputZ * inputZ);
      inputX /= len;
      inputZ /= len;
    }

    // Use the horizontal yaw to build explicit forward/right basis.
    // This avoids sign flips near 90° and keeps W/S aligned with camera.
    const yaw = this.yaw;
    const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)).normalize();
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)).normalize();

    const moveDir = new THREE.Vector3()
      .copy(forward)
      .multiplyScalar(inputZ)
      .addScaledVector(right, inputX);

    if (moveDir.lengthSq() > 1e-6) {
      moveDir.normalize();
    }

    const targetVelX = moveDir.x * targetSpeed;
    const targetVelZ = moveDir.z * targetSpeed;

    // ── 5. Smooth acceleration / deceleration ───────────────────────────
    // Use exponential approach: moves a fixed fraction of the remaining gap
    // each frame, giving a nice ease-in when accelerating and ease-out when
    // releasing keys, regardless of frame rate.
    const rate = hasInput ? ACCELERATION : DECELERATION;
    const blend = 1 - Math.exp(-rate * dt);   // fraction to close per frame
    this.velX += (targetVelX - this.velX) * blend;
    this.velZ += (targetVelZ - this.velZ) * blend;

    // ── 6. Jump ─────────────────────────────────────────────────────────
    // Only allowed when feet are on the floor and not crouched/prone
    if (this.keys["Space"] && this.isGrounded && this.stance === "standing") {
      this.velocityY = JUMP_STRENGTH;
      this.isGrounded = false;
    }

    // ── 7. Gravity ──────────────────────────────────────────────────────
    if (!this.isGrounded) {
      this.velocityY -= GRAVITY * dt;
    }

    // ── 8. Smooth eye height (stance transition) ───────────────────────
    const targetEyeH = this.stance === "prone"     ? PRONE_HEIGHT
                     : this.stance === "crouching" ? CROUCH_HEIGHT
                     : STAND_HEIGHT;
    // Lerp at 10 units/sec so stance changes feel snappy but not instant
    this.eyeHeight += (targetEyeH - this.eyeHeight) * Math.min(10 * dt, 1);

    // ── 9. Apply movement with per-axis AABB collision ──────────────────
    // We try each axis independently so the player slides along walls
    // instead of stopping dead.

    // Horizontal X
    const nextX = this.playerPos.clone();
    nextX.x += this.velX * dt;
    if (!this.collidesWithObstacles(nextX, this.eyeHeight)) {
      this.playerPos.x = nextX.x;
    } else {
      this.velX = 0; // cancel velocity into the wall
    }

    // Horizontal Z
    const nextZ = this.playerPos.clone();
    nextZ.z += this.velZ * dt;
    if (!this.collidesWithObstacles(nextZ, this.eyeHeight)) {
      this.playerPos.z = nextZ.z;
    } else {
      this.velZ = 0;
    }

    // Vertical Y (gravity + jump)
    const nextY = this.playerPos.clone();
    nextY.y += this.velocityY * dt;

    // Floor: the minimum eye position is eyeHeight above the ground (y=0)
    const floorEyeY = this.eyeHeight;

    if (nextY.y <= floorEyeY) {
      // Landed — snap to floor, stop falling, mark as grounded
      this.playerPos.y = floorEyeY;
      this.velocityY   = 0;
      this.isGrounded  = true;
    } else {
      this.playerPos.y = nextY.y;
      this.isGrounded  = false;
    }

    // ── 8. Update camera ─────────────────────────────────────────────────
    this.camera.position.copy(this.playerPos);
    this.camera.rotation.order = "YXZ"; // yaw first, then pitch — standard FPS
    this.camera.rotation.y = this.yaw + this.recoilX;
    this.camera.rotation.x = Math.max(
      -Math.PI * 0.46,
      Math.min(Math.PI * 0.46, this.pitch + this.recoilY)
    );

    const targetAim = this.isAiming ? 1 : 0;
    this.aimBlend += (targetAim - this.aimBlend) * Math.min(ADS_TRANSITION_SPEED * dt, 1);
    const currentFov = NORMAL_FOV + (ADS_FOV - NORMAL_FOV) * this.aimBlend;
    if (Math.abs(this.camera.fov - currentFov) > 1e-3) {
      this.camera.fov = currentFov;
      this.camera.updateProjectionMatrix();
    }

    // ── 9. Weapon & camera bob ──────────────────────────────────────────
    // Bob speed and strength depend on whether the player is walking, sprinting,
    // crouching, or prone. The bob only advances when the player is actually moving.
    const horizSpeed = Math.sqrt(this.velX * this.velX + this.velZ * this.velZ);
    const isMoving   = horizSpeed > 0.5 && this.isGrounded;

    const bobStrength = this.isSprinting  ? BOB_STRENGTH_SPRINT
                      : this.stance === "prone"     ? BOB_STRENGTH_PRONE
                      : this.stance === "crouching" ? BOB_STRENGTH_CROUCH
                      : BOB_STRENGTH_WALK;
    const bobSpeed    = this.isSprinting  ? BOB_SPEED_SPRINT
                      : this.stance === "prone"     ? BOB_SPEED_PRONE
                      : this.stance === "crouching" ? BOB_SPEED_CROUCH
                      : BOB_SPEED_WALK;

    if (isMoving) {
      this.weaponBobTime += dt * bobSpeed;
    }

    // Scale the bob amplitude by how fast the player is relative to walk speed
    const bobScale = Math.min(horizSpeed / WALK_SPEED, 1.5);
    const bobY = Math.sin(this.weaponBobTime)       * bobStrength * bobScale;
    const bobX = Math.cos(this.weaponBobTime * 0.5) * bobStrength * 0.5 * bobScale;

    const weaponX = 0.22 + (ADS_WEAPON_X - 0.22) * this.aimBlend;
    const weaponY = -0.18 + (ADS_WEAPON_Y + 0.18) * this.aimBlend;
    const weaponZ = -0.4  + (ADS_WEAPON_Z + 0.4)  * this.aimBlend;

    const reloadAnim = this.isReloading
      ? Math.max(0, 1 - this.reloadTimer / RELOAD_TIME)
      : 0;

    // ──────────────────────────────────────────────────────────────
    // RELOAD ANIMATION: Four phases
    // ──────────────────────────────────────────────────────────────
    // Phase 1 (0.0-0.25): Gun rotates sideways
    // Phase 2 (0.25-0.5): Old magazine drops out while gun is tilted
    // Phase 3 (0.5-0.75): Hand inserts new magazine
    // Phase 4 (0.75-1.0): Gun rotates back to normal

    const phase1End = 0.25;
    const phase2End = 0.5;
    const phase3End = 0.75;

    let gunRotationZ = 0;
    let reloadDip = 0;

    if (reloadAnim < phase1End) {
      // Phase 1: rotate gun sideways (0 → max) toward the left
      const progress = reloadAnim / phase1End;
      gunRotationZ = progress * -RELOAD_GUN_ROTATION;
    } else if (reloadAnim < phase2End) {
      // Phase 2: gun stays tilted (left), magazine drops out
      gunRotationZ = -RELOAD_GUN_ROTATION;
    } else if (reloadAnim < phase3End) {
      // Phase 3: gun stays tilted (left), hand inserts magazine
      gunRotationZ = -RELOAD_GUN_ROTATION;
    } else {
      // Phase 4: rotate gun back to normal (max → 0)
      const progress = (reloadAnim - phase3End) / (1 - phase3End);
      gunRotationZ = -RELOAD_GUN_ROTATION * (1 - progress);
    }

    // Magazine animation: drop out (phase 2), then hide and return (phase 3)
    if (this.magazineMesh) {
      if (reloadAnim < phase2End) {
        // Phases 1-2: old magazine drops
        const dropProgress = reloadAnim / phase2End;
        this.magazineMesh.position.y = -0.14 - dropProgress * RELOAD_MAG_DROP_DISTANCE;
        this.magazineMesh.visible = true;
      } else if (reloadAnim < phase3End) {
        // Phase 3: old magazine is hidden, new one slides back in
        const insertProgress = (reloadAnim - phase2End) / (phase3End - phase2End);
        this.magazineMesh.position.y = -0.14 - (1 - insertProgress) * RELOAD_MAG_DROP_DISTANCE;
        this.magazineMesh.visible = true;
      } else {
        // Phase 4: magazine returns to rest position
        this.magazineMesh.position.y = -0.14;
        this.magazineMesh.visible = true;
      }
    }

    // Hand animation: appears during phase 3 to push magazine in
    if (this.handMesh) {
      if (reloadAnim > phase2End && reloadAnim < phase3End) {
        // Phase 3: hand moves in to insert magazine
        const handProgress = (reloadAnim - phase2End) / (phase3End - phase2End);
        // Hand moves from left side (negative X) toward the magazine
        this.handMesh.position.x = -0.25 + handProgress * RELOAD_HAND_MOVE_DIST;
        this.handMesh.visible = true;
      } else {
        // Hide hand during other phases
        this.handMesh.visible = false;
      }
    }

    // Weapon dips slightly during the rotation phases
    if (reloadAnim < phase2End) {
      reloadDip = Math.sin(reloadAnim / phase2End * Math.PI) * 0.06;
    } else if (reloadAnim < phase3End) {
      reloadDip = 0.06; // stay dipped while hand is working
    } else {
      reloadDip = Math.sin((reloadAnim - phase3End) / (1 - phase3End) * Math.PI) * 0.06;
    }

    if (this.weaponMesh) {
      this.weaponMesh.position.set(
        weaponX + bobX + this.swayX,
        weaponY + bobY + this.swayY - reloadDip,
        weaponZ
      );
      // Rotate sideways (Z-axis) during reload to show magazine
      this.weaponMesh.rotation.z = gunRotationZ;
      this.weaponMesh.rotation.x = 0; // keep pitch neutral during reload
    }
  }

  // -----------------------------------------------------------------------
  // Collision check — does a cylinder at `pos` overlap any obstacle AABB?
  // eyeH is the current eye height so crouching shrinks the collision box.
  // -----------------------------------------------------------------------
  private collidesWithObstacles(pos: THREE.Vector3, eyeH: number): boolean {
    const r = PLAYER_RADIUS;
    const bottom = pos.y - eyeH; // feet level
    const top    = pos.y + 0.1;  // small clearance above the eyes

    for (const obs of this.obstacles) {
      // Skip if there is no vertical overlap
      if (top < obs.minY || bottom > obs.maxY) continue;

      // Horizontal overlap (approximate cylinder as a square for simplicity)
      if (
        pos.x + r > obs.minX && pos.x - r < obs.maxX &&
        pos.z + r > obs.minZ && pos.z - r < obs.maxZ
      ) {
        return true;
      }
    }
    return false;
  }

  // -----------------------------------------------------------------------
  // Mouse look — horizontal yaw, vertical pitch (clamped)
  // -----------------------------------------------------------------------
  private handleMouseMove(e: MouseEvent) {
    if (!this.pointerLocked || this.gameOver || this.playerDead || this.playerDying) return;

    const sensitivity = MOUSE_SENSITIVITY * (this.isAiming ? ADS_SENSITIVITY_MULT : 1);
    this.yaw   -= e.movementX * sensitivity;
    this.pitch -= e.movementY * sensitivity;

    // Clamp pitch so the player can't look more than ~85° up or down
    this.pitch = Math.max(-Math.PI * 0.46, Math.min(Math.PI * 0.46, this.pitch));
  }

  // -----------------------------------------------------------------------
  // Shooting — left click fires a ray from camera centre
  // -----------------------------------------------------------------------
  private handleMouseDown(e: MouseEvent) {
    if (!this.pointerLocked) return;
    if (e.button === 2) {
      e.preventDefault();
      if (!this.playerDead && !this.playerDying) this.isAiming = true;
      return;
    }
    if (e.button !== 0) return;      // left click only
    if (this.gameOver || this.playerDead || this.playerDying) return;
    if (this.isReloading) return;
    if (this.magAmmo <= 0) { this.startReload(); return; }
    if (this.fireTimer > 0) return;  // fire-rate limiter

    this.shoot();
  }

  private handleMouseUp(e: MouseEvent) {
    if (e.button === 2) {
      e.preventDefault();
      if (!this.playerDead && !this.playerDying) this.isAiming = false;
    }
  }

  // -----------------------------------------------------------------------
  // Ray vs AABB intersection — simple slab method
  // -----------------------------------------------------------------------
  private rayIntersectsAABB(ray: THREE.Ray, box: AABB): boolean {
    const { origin: o, direction: d } = ray;

    let tmin = -Infinity, tmax = Infinity;

    // X slab
    if (Math.abs(d.x) > 1e-8) {
      const t1 = (box.minX - o.x) / d.x;
      const t2 = (box.maxX - o.x) / d.x;
      tmin = Math.max(tmin, Math.min(t1, t2));
      tmax = Math.min(tmax, Math.max(t1, t2));
    } else if (o.x < box.minX || o.x > box.maxX) return false;

    // Y slab
    if (Math.abs(d.y) > 1e-8) {
      const t1 = (box.minY - o.y) / d.y;
      const t2 = (box.maxY - o.y) / d.y;
      tmin = Math.max(tmin, Math.min(t1, t2));
      tmax = Math.min(tmax, Math.max(t1, t2));
    } else if (o.y < box.minY || o.y > box.maxY) return false;

    // Z slab
    if (Math.abs(d.z) > 1e-8) {
      const t1 = (box.minZ - o.z) / d.z;
      const t2 = (box.maxZ - o.z) / d.z;
      tmin = Math.max(tmin, Math.min(t1, t2));
      tmax = Math.min(tmax, Math.max(t1, t2));
    } else if (o.z < box.minZ || o.z > box.maxZ) return false;

    return tmax >= Math.max(tmin, 0);
  }

  // -----------------------------------------------------------------------
  // Hit an enemy — apply damage, check kill, and update visual feedback
  // -----------------------------------------------------------------------
  private hitEnemy(enemy: EnemyState, headshot = false, killerEnemyId: number | null = null) {
    const damage = headshot ? PLAYER_BODY_DAMAGE * HEADSHOT_MULTIPLIER : PLAYER_BODY_DAMAGE;
    enemy.health = Math.max(0, enemy.health - damage);
    enemy.hitTimer = 0.12;
    this.hitMarkerTimer = HIT_MARKER_DURATION;

    const numPos = enemy.mesh.position.clone().add(new THREE.Vector3(0, 1.6, 0));
    this.spawnDamageNumber(numPos, Math.round(damage));

    const pct = Math.max(0, enemy.health / ENEMY_HEALTH);
    enemy.healthBarFore.scale.x = pct;
    (enemy.healthBarFore.position as THREE.Vector3).x = -0.48 * (1 - pct);

    enemy.lastDamageTimer = HEALTH_REGEN_DELAY;
    enemy.regenAccum = 0;

    if (enemy.health <= 0) {
      enemy.health = 0;
      enemy.alive = false;
      enemy.dying = true;
      enemy.deathTimer = 1.2;
      enemy.shootTimer = Infinity;
      if (killerEnemyId === null) {
        this.playerKills += 1;
      } else {
        const killer = this.enemies.find((e) => e.id === killerEnemyId);
        if (killer) {
          killer.kills += 1;
          this.enemyKills = this.enemies.reduce((sum, e) => sum + e.kills, 0);
        }
      }
    }
    this.publishHUD();
  }

  // -----------------------------------------------------------------------
  // Reload mechanic
  // -----------------------------------------------------------------------
  private handleKeyPress(e: KeyboardEvent) {
    if (this.playerDead || this.playerDying) return;
    if (
      e.code === "KeyR" &&
      !this.isReloading &&
      !this.gameOver &&
      this.magAmmo < MAG_SIZE &&
      this.reserveAmmo > 0
    ) {
      this.startReload();
    }
  }

  private startReload() {
    if (this.isReloading)           return; // already reloading
    if (this.reserveAmmo <= 0)      return; // nothing to reload from
    if (this.magAmmo >= MAG_SIZE)   return; // magazine already full
    this.isReloading = true;
    this.reloadTimer = RELOAD_TIME;
    this.publishHUD();
  }

  private updateReload(dt: number) {
    if (!this.isReloading) {
      this.reloadAmmoRefilled = false; // reset flag when not reloading
      return;
    }

    this.reloadTimer -= dt;
    this.publishHUD(); // update progress bar every frame

    // At midpoint of reload (50% progress), refill ammo and swap magazines
    const reloadProgress = Math.max(0, 1 - this.reloadTimer / RELOAD_TIME);
    if (!this.reloadAmmoRefilled && reloadProgress >= RELOAD_MIDPOINT_RATIO) {
      // Pull only as many bullets as needed (partial mag) and as many as
      // reserve has — never invent bullets from thin air.
      const needed = MAG_SIZE - this.magAmmo;
      const pulled  = Math.min(needed, this.reserveAmmo);
      this.magAmmo     += pulled;
      this.reserveAmmo -= pulled;
      this.reloadAmmoRefilled = true;
      this.publishHUD();
    }

    if (this.reloadTimer <= 0) {
      this.isReloading  = false;
      this.reloadTimer  = 0;
      this.publishHUD();
    }
  }

  // -----------------------------------------------------------------------
  // Enemy behaviour — simple timer-based shooting toward the player
  // -----------------------------------------------------------------------
  private updateEnemies(dt: number) {
    for (const enemy of this.enemies) {
      if (enemy.dying) {
        enemy.deathTimer -= dt;
        enemy.mesh.rotation.x = Math.min(Math.PI / 2, enemy.mesh.rotation.x + dt * 2.0);
        enemy.mesh.position.y = enemy.mesh.position.y - dt * 0.6;
        if (enemy.deathTimer <= 0) {
          enemy.dying = false;
          enemy.alive = false;
          enemy.respawnTimer = RESPAWN_DELAY;
          enemy.mesh.visible = false;
          enemy.muzzleFlash.visible = false;
        }
        continue;
      }

      if (!enemy.alive) {
        enemy.respawnTimer -= dt;
        if (enemy.respawnTimer <= 0 && this.matchActive) {
          this.respawnEnemy(enemy);
        }
        continue;
      }

      if (!this.matchActive) continue;

      this.updateEnemyAI(enemy, dt);
      this.updateEnemyFlash(enemy, dt);
      this.updateEnemyMuzzleFlash(enemy, dt);
      this.updateEnemyAABB(enemy);
    }
  }

  private updateEnemyAI(enemy: EnemyState, dt: number) {
    const position = enemy.mesh.position;
    const aliveTargets: Array<{ type: "player" | "enemy"; id: number | null; position: THREE.Vector3 }> = [];
    if (!this.playerDead && !this.playerDying && this.matchActive) {
      aliveTargets.push({ type: "player", id: null, position: this.playerPos.clone() });
    }
    for (const other of this.enemies) {
      if (other.id === enemy.id) continue;
      if (!other.alive || other.dying) continue;
      aliveTargets.push({ type: "enemy", id: other.id, position: other.mesh.position.clone() });
    }

    let chosenTarget: { type: "player" | "enemy"; id: number | null; position: THREE.Vector3; distance: number } | null = null;
    for (const candidate of aliveTargets) {
      if (!this.canSeeTarget(enemy, candidate)) continue;
      const distance = candidate.position.distanceTo(position);
      if (!chosenTarget || distance < chosenTarget.distance) {
        chosenTarget = { ...candidate, distance };
      }
    }

    enemy.targetType = chosenTarget?.type ?? null;
    enemy.targetId = chosenTarget?.id ?? null;

    const desiredDir = new THREE.Vector3();
    if (chosenTarget) {
      desiredDir.copy(chosenTarget.position).sub(position);
      desiredDir.y = 0;
      if (desiredDir.lengthSq() > 1e-4) {
        desiredDir.normalize();
      }
    } else {
      enemy.moveTimer -= dt;
      if (enemy.moveTimer <= 0) {
        enemy.moveDir.set(Math.random() * 2 - 1, 0, Math.random() * 2 - 1).normalize();
        enemy.moveTimer = 1.5 + Math.random() * 2.0;
      }
      desiredDir.copy(enemy.moveDir);
    }

    // Avoid stacking by steering away from nearby enemies
    const separation = new THREE.Vector3();
    for (const other of this.enemies) {
      if (other.id === enemy.id || !other.alive || other.dying) continue;
      const delta = position.clone().sub(other.mesh.position);
      const dist = delta.length();
      if (dist > 0 && dist < 1.5) {
        separation.addScaledVector(delta.normalize(), (1.5 - dist) * 0.5);
      }
    }
    desiredDir.add(separation).normalize();

    const nextPos = position.clone().addScaledVector(desiredDir, ENEMY_MOVE_SPEED * dt);
    if (!this.enemyCollides(nextPos)) {
      enemy.mesh.position.copy(nextPos);
    } else {
      enemy.moveDir.set(Math.random() * 2 - 1, 0, Math.random() * 2 - 1).normalize();
    }

    enemy.mesh.lookAt(position.x + desiredDir.x, position.y, position.z + desiredDir.z);

    enemy.shootTimer -= dt;
    if (chosenTarget && enemy.shootTimer <= 0) {
      enemy.shootTimer = ENEMY_FIRE_RATE + Math.random() * 0.8;
      this.fireEnemyWeapon(enemy, chosenTarget);
    }
  }

  private canSeeTarget(enemy: EnemyState, target: { type: "player" | "enemy"; id: number | null; position: THREE.Vector3 }): boolean {
    const direction = target.position.clone().sub(enemy.mesh.position).normalize();
    const dist = enemy.mesh.position.distanceTo(target.position);
    const sightRay = new THREE.Raycaster(enemy.mesh.position.clone(), direction, 0, dist);
    const obstacles = this.scene.children.filter(
      (obj) => obj !== enemy.mesh && obj.parent !== enemy.mesh
    );
    const hits = sightRay.intersectObjects(obstacles, true);

    if (target.type === "player") {
      return hits.length === 0;
    }

    const targetEnemy = this.enemies.find((e) => e.id === target.id);
    if (!targetEnemy) return false;

    if (hits.length === 0) return false;
    return this.isObjectPartOfGroup(hits[0].object, targetEnemy.mesh);
  }

  private findEnemyHit(raycaster: THREE.Raycaster): { enemy: EnemyState; headshot: boolean } | null {
    let best: { enemy: EnemyState; headshot: boolean; distance: number } | null = null;
    for (const enemy of this.enemies) {
      if (!enemy.alive || enemy.dying) continue;
      const distance = enemy.mesh.position.distanceTo(raycaster.ray.origin);
      if (this.rayIntersectsAABB(raycaster.ray, enemy.headBox)) {
        if (!best || !best.headshot || distance < best.distance) {
          best = { enemy, headshot: true, distance };
        }
      } else if (this.rayIntersectsAABB(raycaster.ray, enemy.bodyBox)) {
        if (!best || distance < best.distance) {
          best = { enemy, headshot: false, distance };
        }
      }
    }
    return best ? { enemy: best.enemy, headshot: best.headshot } : null;
  }

  private fireEnemyWeapon(enemy: EnemyState, target: { type: "player" | "enemy"; id: number | null; position: THREE.Vector3 }) {
    enemy.muzzleFlash.visible = true;
    enemy.muzzleFlashTimer = ENEMY_TRACER_DURATION;

    const start = enemy.mesh.localToWorld(new THREE.Vector3(0.4, 0.8, -0.25));
    const direction = target.position.clone().sub(start).normalize();
    const dist = start.distanceTo(target.position);
    const ray = new THREE.Raycaster(start, direction, 0, dist);
    const obstacles = this.scene.children.filter(
      (obj) => obj !== enemy.mesh && obj.parent !== enemy.mesh
    );
    const hits = ray.intersectObjects(obstacles, true);

    if (target.type === "player") {
      const firstHit = hits[0];
      const blockedByObstacle = firstHit && firstHit.distance < dist - 0.15;
      if (!blockedByObstacle) {
        this.applyPlayerDamage(ENEMY_BULLET_DAMAGE, enemy.id);
      }
    } else if (target.type === "enemy" && target.id !== null) {
      const targetEnemy = this.enemies.find((e) => e.id === target.id);
      if (targetEnemy && targetEnemy.alive && !targetEnemy.dying) {
        const firstHit = hits[0];
        if (firstHit && this.isObjectPartOfGroup(firstHit.object, targetEnemy.mesh)) {
          this.hitEnemy(targetEnemy, false, enemy.id);
        }
      }
    }
  }

  private applyPlayerDamage(amount: number, killerEnemyId: number | null = null) {
    if (this.playerDead || this.playerDying || !this.matchActive) return;

    this.health = Math.max(0, this.health - amount);
    this.lastDamageAmount = amount;
    this.damageFlash.visible = true;
    this.damageFlashTimer = DAMAGE_FLASH_DURATION;
    this.lastPlayerDamageTimer = HEALTH_REGEN_DELAY;
    this.playerRegenAccum = 0;

    if (this.health <= 0) {
      this.health = 0;
      if (killerEnemyId !== null) {
        const killer = this.enemies.find((e) => e.id === killerEnemyId);
        if (killer) {
          killer.kills += 1;
          this.enemyKills = this.enemies.reduce((sum, e) => sum + e.kills, 0);
        }
      }
      this.playerDead = true;
      this.playerDying = true;
      this.playerDeathTimer = DEATH_ANIM_TIME;
      this.playerRespawnTimer = 0;
      this.isAiming = false;
      this.isReloading = false;
    }
    this.publishHUD();
  }

  private isObjectPartOfGroup(object: THREE.Object3D, group: THREE.Object3D): boolean {
    let current: THREE.Object3D | null = object;
    while (current) {
      if (current === group) return true;
      current = current.parent;
    }
    return false;
  }

  private updateEnemyMuzzleFlash(enemy: EnemyState, dt: number) {
    if (!enemy.muzzleFlash.visible) return;
    enemy.muzzleFlashTimer -= dt;
    if (enemy.muzzleFlashTimer <= 0) {
      enemy.muzzleFlash.visible = false;
    }
  }

  private enemyCollides(position: THREE.Vector3): boolean {
    const box = makeAABB(position.x, position.y, position.z, 0.8, 1.8, 0.5);
    for (const obs of this.obstacles) {
      if (!(box.minX > obs.maxX || box.maxX < obs.minX || box.minY > obs.maxY || box.maxY < obs.minY || box.minZ > obs.maxZ || box.maxZ < obs.minZ)) {
        return true;
      }
    }
    return false;
  }

  private respawnEnemy(enemy: EnemyState) {
    const spawn = ENEMY_SPAWN_POINTS[Math.floor(Math.random() * ENEMY_SPAWN_POINTS.length)];
    enemy.health = ENEMY_HEALTH;
    enemy.alive = true;
    enemy.dying = false;
    enemy.deathTimer = 0;
    enemy.respawnTimer = 0;
    enemy.mesh.visible = true;
    enemy.mesh.position.set(spawn[0], spawn[1], spawn[2]);
    enemy.mesh.rotation.set(0, 0, 0);
    enemy.normalColor.set(0xe74c3c);
    (enemy.mesh.children[0] as THREE.Mesh).material = new THREE.MeshLambertMaterial({ color: 0xe74c3c });
    enemy.shootTimer = ENEMY_FIRE_RATE;
    enemy.moveTimer = 1 + Math.random() * 2;
    enemy.moveDir.set(Math.random() * 2 - 1, 0, Math.random() * 2 - 1).normalize();
    enemy.lastDamageTimer = 0;
    enemy.regenAccum = 0;
    enemy.targetType = null;
    enemy.targetId = null;
    enemy.healthBarFore.scale.x = 1;
    (enemy.healthBarFore.position as THREE.Vector3).x = 0;
    this.updateEnemyAABB(enemy);
  }

  // -----------------------------------------------------------------------
  // Muzzle flash — show for a short duration
  // -----------------------------------------------------------------------
  private showMuzzleFlash() {
    this.muzzleFlash.visible = true;
    this.muzzleFlashTimer = MUZZLE_FLASH_DURATION;
  }

  private updateMuzzleFlash(dt: number) {
    if (!this.muzzleFlash.visible) return;
    this.muzzleFlashTimer -= dt;
    if (this.muzzleFlashTimer <= 0) {
      this.muzzleFlash.visible = false;
    }
  }

  // -----------------------------------------------------------------------
  // Enemy hit flash — briefly change enemy colour to white
  // -----------------------------------------------------------------------
  private updateEnemyFlash(enemy: EnemyState, dt: number) {
    if (enemy.hitTimer > 0) {
      enemy.hitTimer -= dt;
      const body = enemy.mesh.children[0] as THREE.Mesh;
      const material = body.material as THREE.MeshLambertMaterial;
      material.color.copy(enemy.hitTimer > 0 ? enemy.hitColor : enemy.normalColor);
    }
  }

  // -----------------------------------------------------------------------
  // Health regeneration for player and enemies
  // -----------------------------------------------------------------------
  private updateRegeneration(dt: number) {
    if (this.lastPlayerDamageTimer > 0) {
      this.lastPlayerDamageTimer = Math.max(0, this.lastPlayerDamageTimer - dt);
    }

    if (!this.playerDead && !this.playerDying && this.lastPlayerDamageTimer === 0 && this.health < MAX_HEALTH) {
      this.playerRegenAccum += PLAYER_REGEN_RATE * dt;
      const heal = Math.floor(this.playerRegenAccum);
      if (heal > 0) {
        this.playerRegenAccum -= heal;
        this.health = Math.min(MAX_HEALTH, this.health + heal);
        this.publishHUD();
      }
    } else if (this.lastPlayerDamageTimer > 0 || this.playerDead || this.playerDying) {
      this.playerRegenAccum = 0;
    }

    for (const enemy of this.enemies) {
      if (enemy.lastDamageTimer > 0) {
        enemy.lastDamageTimer = Math.max(0, enemy.lastDamageTimer - dt);
      }
      if (enemy.alive && !enemy.dying && enemy.lastDamageTimer === 0 && enemy.health < ENEMY_HEALTH) {
        enemy.regenAccum += ENEMY_REGEN_RATE * dt;
        const heal = Math.floor(enemy.regenAccum);
        if (heal > 0) {
          enemy.regenAccum -= heal;
          enemy.health = Math.min(ENEMY_HEALTH, enemy.health + heal);
          const pct = Math.max(0, enemy.health / ENEMY_HEALTH);
          enemy.healthBarFore.scale.x = pct;
          (enemy.healthBarFore.position as THREE.Vector3).x = -0.48 * (1 - pct);
          this.publishHUD();
        }
      } else if (enemy.lastDamageTimer > 0 || !enemy.alive || enemy.dying) {
        enemy.regenAccum = 0;
      }
    }
  }

  // -----------------------------------------------------------------------
  // Shoot — fire one bullet from the camera centre
  // -----------------------------------------------------------------------
  private shoot() {
    this.magAmmo--;
    this.fireTimer = WEAPON_FIRE_RATE;
    this.showMuzzleFlash();

    const recoilStrength = this.isAiming ? RECOIL_AIMING_MULT : 1;
    this.recoilY += RECOIL_PITCH * recoilStrength;
    this.recoilX += (Math.random() * 2 - 1) * RECOIL_YAW * recoilStrength;

    const raycaster = new THREE.Raycaster();
    raycaster.far = WEAPON_RANGE;
    raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);

    const hitResult = this.findEnemyHit(raycaster);
    let enemyHit = false;
    if (hitResult) {
      enemyHit = true;
      this.hitEnemy(hitResult.enemy, hitResult.headshot);
    }

    if (!enemyHit) {
      const hits = raycaster.intersectObjects(this.scene.children, true);
      if (hits.length > 0) {
        const hit = hits[0];
        const hitMesh = hit.object.parent ?? hit.object;
        if (!this.enemies.some((enemy) => enemy.mesh === hitMesh || enemy.mesh.children.includes(hit.object))) {
          this.spawnImpact(hit.point);
        }
      }
    }

    this.publishHUD();
  }

  // -----------------------------------------------------------------------
  // Spawn a small bullet-impact dot at a world position
  // -----------------------------------------------------------------------
  private spawnImpact(point: THREE.Vector3) {
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 6, 4),
      new THREE.MeshBasicMaterial({ color: 0xffdd99 })
    );
    dot.position.copy(point);
    this.scene.add(dot);
    this.impacts.push({ mesh: dot, timer: IMPACT_DURATION });
  }

  // Spawn a floating damage number at world position
  private spawnDamageNumber(point: THREE.Vector3, amount: number) {
    const canvas = document.createElement("canvas");
    canvas.width = 128; canvas.height = 48;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0,0,canvas.width, canvas.height);
    ctx.font = "bold 28px monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffdddd";
    ctx.strokeStyle = "#660000";
    ctx.lineWidth = 4;
    const text = `-${amount}`;
    ctx.strokeText(text, canvas.width/2, 34);
    ctx.fillText(text, canvas.width/2, 34);

    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
    const geo = new THREE.PlaneGeometry(0.7, 0.25);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(point);
    mesh.position.y += 0.1;
    mesh.renderOrder = 999;
    this.scene.add(mesh);
    this.damageNumbers.push({ mesh, timer: 0.9, vel: new THREE.Vector3(0, 0.6, 0) });
  }

  private updateDamageNumbers(dt: number) {
    for (let i = this.damageNumbers.length - 1; i >= 0; i--) {
      const d = this.damageNumbers[i];
      d.timer -= dt;
      d.mesh.position.addScaledVector(d.vel, dt);
      const mat = d.mesh.material as THREE.MeshBasicMaterial;
      if (d.timer <= 0) {
        this.scene.remove(d.mesh);
        this.damageNumbers.splice(i, 1);
      } else {
        mat.opacity = Math.max(0, d.timer / 0.9);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Per-frame weapon updates: fire timer, hit marker, impact cleanup, sway
  // -----------------------------------------------------------------------
  private updateWeapon(dt: number) {
    // Fire-rate cooldown
    if (this.fireTimer > 0) this.fireTimer = Math.max(0, this.fireTimer - dt);

    // Hit-marker timer — publish once when it expires so React hides the ×
    if (this.hitMarkerTimer > 0) {
      this.hitMarkerTimer -= dt;
      if (this.hitMarkerTimer <= 0) {
        this.hitMarkerTimer = 0;
        this.publishHUD();
      }
    }

    // Expire old bullet-impact dots
    for (let i = this.impacts.length - 1; i >= 0; i--) {
      this.impacts[i].timer -= dt;
      if (this.impacts[i].timer <= 0) {
        this.scene.remove(this.impacts[i].mesh);
        this.impacts.splice(i, 1);
      }
    }

    // Floating damage numbers
    this.updateDamageNumbers(dt);

    // Recoil recovery — camera settles back toward the player's base aim.
    const recoilBlend = 1 - Math.exp(-RECOIL_RECOVERY_SPEED * dt);
    this.recoilX += (0 - this.recoilX) * recoilBlend;
    this.recoilY += (0 - this.recoilY) * recoilBlend;

    if (this.damageFlashTimer > 0) {
      this.damageFlashTimer -= dt;
      const progress = Math.max(0, this.damageFlashTimer / DAMAGE_FLASH_DURATION);
      
      // Main red flash
      this.damageFlash.visible = true;
      (this.damageFlash.material as THREE.MeshBasicMaterial).opacity = DAMAGE_FLASH_OPACITY * progress;
      
      // Vignette edge darkening effect
      this.damageVignette.visible = true;
      (this.damageVignette.material as THREE.MeshBasicMaterial).opacity = DAMAGE_FLASH_EDGE_VIGNETTE * progress;
      
      if (this.damageFlashTimer <= 0) {
        this.damageFlash.visible = false;
        this.damageVignette.visible = false;
      }
    }

    // Weapon sway — project horizontal velocity into camera space so the
    // weapon drifts opposite to the direction of movement (rubber-band lag)
    const sinYaw = Math.sin(this.yaw);
    const cosYaw = Math.cos(this.yaw);
    // Camera right  = ( cosYaw, 0,  sinYaw )
    // Camera forward = ( sinYaw, 0, -cosYaw )
    const lateralVel = this.velX * cosYaw + this.velZ * sinYaw;

    // Clamp sway to ±WEAPON_SWAY_STRENGTH, proportional to speed
    const targetSwayX = -Math.sign(lateralVel)
      * Math.min(Math.abs(lateralVel) / WALK_SPEED, 1)
      * WEAPON_SWAY_STRENGTH;
    const targetSwayY = 0; // vertical sway handled by the bob already

    const blend = Math.min(WEAPON_SWAY_SPEED * dt, 1);
    this.swayX += (targetSwayX - this.swayX) * blend;
    this.swayY += (targetSwayY - this.swayY) * blend;

    // Player death & respawn handling
    if (this.playerDying) {
      this.playerDeathTimer -= dt;
      // Animate camera falling in the render pass (camera updated elsewhere)
      if (this.playerDeathTimer <= 0) {
        // Enter respawn wait phase
        this.playerDying = false;
        this.playerRespawnTimer = RESPAWN_DELAY;
        // keep playerDead = true to block input until respawn
        this.publishHUD();
      }
    } else if (this.playerDead) {
      this.playerRespawnTimer -= dt;
      if (this.playerRespawnTimer <= 0) {
        // Respawn player
        this.playerDead = false;
        this.playerDying = false;
        this.health = MAX_HEALTH;
        this.magAmmo = MAG_SIZE;
        this.reserveAmmo = RESERVE_AMMO;
        this.isReloading = false;
        this.reloadTimer = 0;
        this.reloadAmmoRefilled = false;
        this.playerPos.set(0, STAND_HEIGHT, 12);
        this.velX = 0; this.velZ = 0; this.velocityY = 0;
        this.isGrounded = true;
        this.stance = "standing";
        this.eyeHeight = STAND_HEIGHT;
        this.isAiming = false;
        this.playerRegenAccum = 0;
        this.lastPlayerDamageTimer = HEALTH_REGEN_DELAY;
        this.publishHUD();
      }
    }

    // Camera death animation override: tilt forward + sink camera while dying or dead
    if (this.playerDying || this.playerDead) {
      const progress = this.playerDying
        ? Math.min(1, Math.max(0, 1 - this.playerDeathTimer / DEATH_ANIM_TIME))
        : 1;
      const fallDist = Math.max(0.01, this.eyeHeight - 0.2);
      this.camera.position.y = this.playerPos.y - progress * fallDist;
      const basePitch = Math.max(-Math.PI * 0.46, Math.min(Math.PI * 0.46, this.pitch + this.recoilY));
      this.camera.rotation.x = basePitch + progress * (Math.PI * 0.6);
    }
  }

  // -----------------------------------------------------------------------
  // Render — clear, draw world, then draw weapon on top
  // -----------------------------------------------------------------------
  private render() {
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);

    // Weapon is rendered without clearing the depth buffer
    // so it always appears in front of the world
    this.renderer.clearDepth();
    this.renderer.render(this.weaponScene, this.weaponCamera);
  }

  // -----------------------------------------------------------------------
  // Publish HUD state to React
  // -----------------------------------------------------------------------
  private publishHUD() {
    // Build player list including You + all enemies
    const allScores = [
      { id: "you", name: "You", kills: this.playerKills, isYou: true },
      ...this.enemies.map((enemy) => ({ id: `enemy-${enemy.id}`, name: `Player ${enemy.id + 1}`, kills: enemy.kills, isYou: false })),
    ];

    // Sort scoreboard by kills descending; stable tie-breaker: You first, then by id
    const scoreboardSorted = [...allScores].sort((a, b) => {
      if (b.kills !== a.kills) return b.kills - a.kills; // higher kills first
      if (a.isYou && !b.isYou) return -1;
      if (!a.isYou && b.isYou) return 1;
      return a.id.localeCompare(b.id);
    });

    const state: HUDState = {
      health: Math.round(this.health),
      magAmmo: this.magAmmo,
      reserveAmmo: this.reserveAmmo,
      magSize: MAG_SIZE,
      isReloading: this.isReloading,
      reloadProgress: this.isReloading
        ? Math.max(0, 1 - this.reloadTimer / RELOAD_TIME)
        : 0,
      gameOver: this.gameOver,
      won: this.won,
      enemyHealth: Math.round(this.enemies.find((enemy) => enemy.alive && !enemy.dying)?.health ?? 0),
      maxEnemyHealth: ENEMY_HEALTH,
      showHitMarker: this.hitMarkerTimer > 0,
      lastDamageAmount: this.lastDamageAmount,
      damageFlashActive: this.damageFlashTimer > 0,
      deathTintActive: this.playerDying || this.playerDead,
      matchTime: this.matchTime,
      playerKills: this.playerKills,
      enemyKills: this.enemyKills,
      scoreboard: scoreboardSorted,
      resultLabel: (() => {
        const topKills = Math.max(...allScores.map((entry) => entry.kills));
        const leaders = allScores.filter((entry) => entry.kills === topKills);
        return leaders.length === 1 ? leaders[0].name : "DRAW";
      })(),
      matchActive: this.matchActive,
    };
    this.hudCallback(state);
    this.lastDamageAmount = 0; // reset for next frame
  }

  // -----------------------------------------------------------------------
  // Resize handler
  // -----------------------------------------------------------------------
  private onResize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.weaponCamera.aspect = w / h;
    this.weaponCamera.updateProjectionMatrix();
  }

  // -----------------------------------------------------------------------
  // Restart — reset all state (called from React)
  // -----------------------------------------------------------------------
  public restart() {
    // Exit pointer lock first so the start-screen cursor is visible
    document.exitPointerLock();

    // Reset player to safe spawn — Z=12 is clear of all crates
    this.playerPos.set(0, STAND_HEIGHT, 12);
    this.yaw = 0;
    this.pitch = 0;

    // Reset movement physics
    this.velX       = 0;
    this.velZ       = 0;
    this.velocityY  = 0;
    this.isGrounded = true;
    this.isSprinting  = false;
    this.stance  = "standing";
    this.cKeyPressTime = 0;
    this.cKeyWasPressedLastFrame = false;
    this.toggleHappened = false;
    this.eyeHeight  = STAND_HEIGHT;

    this.health      = MAX_HEALTH;
    this.lastDamageAmount = 0;
    this.magAmmo     = MAG_SIZE;
    this.reserveAmmo = RESERVE_AMMO;
    this.isReloading = false;
    this.reloadTimer = 0;
    this.reloadAmmoRefilled = false;
    this.gameOver = false;
    this.won = false;
    this.playerKills = 0;
    this.enemyKills = 0;
    this.weaponBobTime = 0;
    for (const enemy of this.enemies) {
      enemy.health = ENEMY_HEALTH;
      enemy.alive = true;
      enemy.dying = false;
      enemy.deathTimer = 0;
      enemy.kills = 0;
      enemy.mesh.visible = true;
      enemy.mesh.rotation.set(0, 0, 0);
      enemy.hitTimer = 0;
      enemy.lastDamageTimer = 0;
      enemy.regenAccum = 0;
      enemy.shootTimer = ENEMY_FIRE_RATE;
      enemy.moveTimer = 1 + Math.random() * 2;
      enemy.moveDir.set(Math.random() * 2 - 1, 0, Math.random() * 2 - 1).normalize();
      enemy.healthBarFore.scale.x = 1;
      (enemy.healthBarFore.position as THREE.Vector3).x = 0;
      this.updateEnemyAABB(enemy);
    }
    this.fireTimer = 0;
    this.hitMarkerTimer = 0;
    this.swayX = 0;
    this.swayY = 0;
    // Remove any leftover bullet-impact dots from the previous round
    for (const imp of this.impacts) this.scene.remove(imp.mesh);
    this.impacts = [];
    // Cancel any engine-managed timers from previous match (respawns, etc.)
    this.cancelAllTimers();
    // Reset match timer
    this.matchTime = MATCH_LENGTH_SECONDS;
    this.matchActive = false;
    this.playerRegenAccum = 0;
    this.enemyRegenAccum = 0;
    this.lastPlayerDamageTimer = 0;
    this.lastEnemyDamageTimer = 0;
    this.playerDead = false;
    this.playerDying = false;
    this.playerDeathTimer = 0;
    this.playerRespawnTimer = 0;
    this.publishHUD();
  }

  // -----------------------------------------------------------------------
  // Destroy — remove renderer and listeners (cleanup on React unmount)
  // -----------------------------------------------------------------------
  public destroy() {
    cancelAnimationFrame(this.animFrameId);
    document.removeEventListener("keydown", this.onKeyDown);
    document.removeEventListener("keyup", this.onKeyUp);
    document.removeEventListener("mousemove", this.onMouseMove);
    document.removeEventListener("mousedown", this.onMouseDown);
    document.removeEventListener("mouseup", this.onMouseUp);
    document.removeEventListener("pointerlockchange", this.onPointerLockChange);
    // Ensure no engine timers remain running after destroy
    this.cancelAllTimers();
    document.removeEventListener("contextmenu", this.onContextMenu);
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
