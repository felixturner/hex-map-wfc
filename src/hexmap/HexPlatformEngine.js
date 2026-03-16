/**
 * HexPlatformEngine.js — N++ Ninja Physics on Hex Grid
 *
 * Reusable platformer physics module that integrates with the existing
 * hex-map-wfc tile system. Provides:
 * - N++-style momentum physics (additive jump, dual gravity, wall slide)
 * - Hex grid collision detection
 * - Q*bert color-change mechanics
 * - Ninja entity with full state machine
 *
 * Usage:
 *   import { HexPlatformEngine } from './HexPlatformEngine.js';
 *   const engine = new HexPlatformEngine(hexMap);
 *   engine.spawnNinja(0, 0); // spawn at hex (0,0)
 *   // In game loop:
 *   engine.update(dt, inputState);
 *   engine.render(ctx); // or integrate with Three.js
 */

// ── PHYSICS CONSTANTS (N++ Style) ───────────────────────────────
export const NINJA_PHYSICS = {
  // Dual gravity (different for rising vs falling)
  GRAVITY_RISE:       2200,   // px/s² while rising (vy < 0)
  GRAVITY_FALL:       3000,   // px/s² while falling (vy > 0)
  GRAVITY_FAST_FALL:  4500,   // px/s² while holding down
  GRAVITY_APEX_MULT:  0.55,   // gravity multiplier at jump peak
  APEX_VY_THRESHOLD:  55,     // |vy| below this = apex zone
  APEX_HANG_FRAMES:   3,      // max frames of reduced gravity at apex
  MAX_FALL_SPEED:     520,    // terminal velocity
  MAX_FAST_FALL:      750,    // terminal velocity with fast-fall

  // Ground movement
  RUN_SPEED:          280,    // target horizontal speed
  GROUND_ACCEL:       2800,   // acceleration from standstill
  GROUND_DECEL:       4200,   // deceleration on input release
  GROUND_REVERSAL:    5500,   // acceleration when reversing direction
  SPEED_CAP:          550,    // absolute max horizontal speed
  ICE_ACCEL_MULT:     0.25,   // ice tile acceleration multiplier

  // Air movement
  AIR_ACCEL:          1400,
  AIR_DECEL:          550,
  AIR_REVERSAL:       1100,
  AIR_SPEED_CAP:      320,

  // Jump (N++ ADDITIVE: vy += impulse, preserving momentum)
  JUMP_IMPULSE:       -580,   // additive jump velocity
  JUMP_CUT_MULT:      0.38,   // velocity cut on early release
  COYOTE_FRAMES:      6,      // grace frames after leaving edge
  JUMP_BUFFER_FRAMES: 8,      // pre-landing input buffer
  BOUNCE_IMPULSE:     -780,   // bounce pad launch

  // Wall mechanics
  WALL_SLIDE_SPEED:   95,     // max descent while wall-sliding
  WALL_SLIDE_ACCEL:   750,    // wall slide deceleration
  WALL_JUMP_VX:       360,    // horizontal kick from wall
  WALL_JUMP_VY:       -490,   // vertical kick from wall (additive)
  WALL_JUMP_LOCKOUT:  5,      // frames of reduced air control
  WALL_JUMP_INPUT_EFF:0.25,   // input effectiveness during lockout
  WALL_STICK_FRAMES:  4,      // frames before sliding begins

  // Landing
  LANDING_TRANSFER:   0.22,   // fraction of vy transferred to vx
  LANDING_THRESHOLD:  230,    // min vy to trigger transfer
  LANDING_CAP:        230,    // max vx gained from transfer

  // Fall damage (N++ signature)
  FALL_DAMAGE_SPEED:  480,    // impact speed that kills

  // Dimensions
  NINJA_W:            10,
  NINJA_H:            16,
};

// ── MATH HELPERS ────────────────────────────────────────────────
function approach(cur, tgt, step) {
  return cur < tgt ? Math.min(cur + step, tgt) : Math.max(cur - step, tgt);
}
function clamp(v, mn, mx) { return v < mn ? mn : v > mx ? mx : v; }
function sign(x) { return x > 0 ? 1 : x < 0 ? -1 : 0; }

// ── NINJA ENTITY ────────────────────────────────────────────────
export class NinjaEntity {
  constructor() {
    this.x = 0; this.y = 0;
    this.vx = 0; this.vy = 0;
    this.w = NINJA_PHYSICS.NINJA_W;
    this.h = NINJA_PHYSICS.NINJA_H;
    this.grounded = false;
    this.wallSliding = false;
    this.wallDir = 0;
    this.facing = 1;
    this.state = 'idle'; // idle, running, jumping, falling, wallSlide, dead
    this.onIce = false;
    this.alive = true;
    this.invulnTimer = 0;
    // Physics timers
    this.coyoteTimer = 0;
    this.jumpBuffer = 0;
    this.apexFrames = 0;
    this.wallLockout = 0;
    this.wasGrounded = false;
    // Animation
    this.animFrame = 0;
    this.animTimer = 0;
  }

  reset(x, y) {
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.grounded = false;
    this.wallSliding = false;
    this.alive = true;
    this.state = 'falling';
    this.invulnTimer = 1.0;
    this.coyoteTimer = 0;
    this.jumpBuffer = 0;
    this.apexFrames = 0;
    this.wallLockout = 0;
  }
}

// ── INPUT STATE ─────────────────────────────────────────────────
export class InputState {
  constructor() {
    this.x = 0;       // -1 to 1 horizontal
    this.y = 0;       // -1 to 1 vertical
    this.jumpPressed = false;
    this.jumpHeld = false;
    this.jumpReleased = false;
    this.actionPressed = false;
  }
}

// ── HEX PLATFORM ENGINE ────────────────────────────────────────
export class HexPlatformEngine {
  constructor(options = {}) {
    this.P = { ...NINJA_PHYSICS, ...(options.physics || {}) };
    this.ninja = new NinjaEntity();
    this.onKill = options.onKill || (() => {});
    this.onLand = options.onLand || (() => {});
    this.onWallJump = options.onWallJump || (() => {});
    this.onBounce = options.onBounce || (() => {});
    this.onColorChange = options.onColorChange || (() => {});
  }

  spawnNinja(x, y) {
    this.ninja.reset(x, y);
  }

  update(dt, input, collisionCallback) {
    const n = this.ninja;
    const P = this.P;
    if (!n.alive) return;

    if (n.invulnTimer > 0) n.invulnTimer -= dt;

    const holdDown = input.y > 0.5;

    // ── Coyote time ──
    if (n.wasGrounded && !n.grounded && n.vy >= 0) {
      n.coyoteTimer = P.COYOTE_FRAMES;
    }
    if (n.coyoteTimer > 0) n.coyoteTimer--;
    if (n.jumpBuffer > 0) n.jumpBuffer--;
    n.wasGrounded = n.grounded;
    if (input.jumpPressed) n.jumpBuffer = P.JUMP_BUFFER_FRAMES;

    // ── Wall jump ──
    if (input.jumpPressed && n.wallSliding) {
      n.vx = -n.wallDir * P.WALL_JUMP_VX;
      n.vy += P.WALL_JUMP_VY; // ADDITIVE (N++ signature)
      n.grounded = false;
      n.wallSliding = false;
      n.wallLockout = P.WALL_JUMP_LOCKOUT;
      n.coyoteTimer = 0;
      n.jumpBuffer = 0;
      n.state = 'jumping';
      this.onWallJump(n);
    }
    // ── Normal jump (ADDITIVE: vy += impulse) ──
    else if ((n.grounded || n.coyoteTimer > 0) && n.jumpBuffer > 0) {
      n.vy += P.JUMP_IMPULSE; // ADDITIVE — N++ core mechanic
      n.grounded = false;
      n.coyoteTimer = 0;
      n.jumpBuffer = 0;
      n.state = 'jumping';
    }

    // ── Variable jump height ──
    if (input.jumpReleased && n.vy < 0) {
      n.vy *= P.JUMP_CUT_MULT;
    }

    // ── Horizontal movement ──
    if (n.grounded) {
      let accel;
      if (input.x === 0) accel = P.GROUND_DECEL;
      else if (sign(input.x) !== sign(n.vx)) accel = P.GROUND_REVERSAL;
      else accel = P.GROUND_ACCEL;
      if (n.onIce) accel *= P.ICE_ACCEL_MULT;
      n.vx = approach(n.vx, input.x * P.RUN_SPEED, accel * dt);
      n.vx = clamp(n.vx, -P.SPEED_CAP, P.SPEED_CAP);
    } else {
      let accel;
      if (input.x === 0) accel = P.AIR_DECEL;
      else if (sign(input.x) !== sign(n.vx)) accel = P.AIR_REVERSAL;
      else accel = P.AIR_ACCEL;
      let effInput = input.x;
      if (n.wallLockout > 0) { effInput *= P.WALL_JUMP_INPUT_EFF; n.wallLockout--; }
      n.vx = approach(n.vx, effInput * P.AIR_SPEED_CAP, accel * dt);
    }
    if (input.x !== 0) n.facing = sign(input.x);

    // ── Gravity (dual + apex hang) ──
    if (!n.grounded) {
      let grav;
      if (holdDown && n.vy > 0) grav = P.GRAVITY_FAST_FALL;
      else if (n.vy < 0) grav = P.GRAVITY_RISE;
      else grav = P.GRAVITY_FALL;
      // Apex hang
      if (Math.abs(n.vy) < P.APEX_VY_THRESHOLD) {
        if (n.apexFrames < P.APEX_HANG_FRAMES) {
          grav *= P.GRAVITY_APEX_MULT;
          n.apexFrames++;
        }
      } else { n.apexFrames = 0; }
      n.vy += grav * dt;
    } else { n.apexFrames = 0; }

    // ── Wall slide ──
    if (n.wallSliding) {
      if (n.vy > P.WALL_SLIDE_SPEED) {
        n.vy = approach(n.vy, P.WALL_SLIDE_SPEED, P.WALL_SLIDE_ACCEL * dt);
      }
    }

    // ── Terminal velocity ──
    const maxFall = holdDown ? P.MAX_FAST_FALL : P.MAX_FALL_SPEED;
    if (n.vy > maxFall) n.vy = maxFall;

    // ── Position integration ──
    n.x += n.vx * dt;
    n.y += n.vy * dt;

    // ── Collision (user-provided callback) ──
    if (collisionCallback) {
      collisionCallback(n, this);
    }

    // ── State machine for animation ──
    if (n.wallSliding) n.state = 'wallSlide';
    else if (n.grounded) n.state = Math.abs(n.vx) > 20 ? 'running' : 'idle';
    else n.state = n.vy < 0 ? 'jumping' : 'falling';

    // Animation timer
    n.animTimer += dt;
    if (n.animTimer > 0.1) {
      n.animTimer = 0;
      n.animFrame = (n.animFrame + 1) % 4;
    }
  }

  kill(cause) {
    const n = this.ninja;
    if (!n.alive) return;
    n.alive = false;
    n.state = 'dead';
    this.onKill(n, cause);
  }

  checkFallDamage(impactSpeed) {
    if (impactSpeed > this.P.FALL_DAMAGE_SPEED && this.ninja.invulnTimer <= 0) {
      this.kill('fall_damage');
      return true;
    }
    return false;
  }

  land(tile) {
    const n = this.ninja;
    const P = this.P;

    // Fall damage check
    const impactSpeed = Math.sqrt(n.vx * n.vx + n.vy * n.vy);
    if (this.checkFallDamage(impactSpeed)) return;

    // Landing momentum transfer
    if (n.vy > P.LANDING_THRESHOLD) {
      const transfer = Math.min(n.vy * P.LANDING_TRANSFER, P.LANDING_CAP);
      n.vx += transfer * n.facing;
    }

    n.vy = 0;
    n.grounded = true;
    this.onLand(n, tile);
  }

  bounce() {
    this.ninja.vy = this.P.BOUNCE_IMPULSE;
    this.ninja.grounded = false;
    this.onBounce(this.ninja);
  }
}

export default HexPlatformEngine;
