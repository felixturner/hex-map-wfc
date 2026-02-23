# TSL Compute Shaders

Compute shaders run on the GPU for parallel processing of data. TSL makes them accessible through JavaScript.

## Basic Setup

```javascript
import * as THREE from 'three/webgpu';
import { Fn, instancedArray, instanceIndex, vec3 } from 'three/tsl';

// Create storage buffer
const count = 100000;
const positions = instancedArray(count, 'vec3');

// Create compute shader
const computeShader = Fn(() => {
  const position = positions.element(instanceIndex);
  position.x.addAssign(0.01);
})().compute(count);

// Execute
renderer.compute(computeShader);
```

## Storage Buffers

### Instanced Arrays

```javascript
import { instancedArray } from 'three/tsl';

// Create typed storage buffers
const positions = instancedArray(count, 'vec3');
const velocities = instancedArray(count, 'vec3');
const colors = instancedArray(count, 'vec4');
const indices = instancedArray(count, 'uint');
const values = instancedArray(count, 'float');
```

### Accessing Elements

```javascript
const computeShader = Fn(() => {
  // Get element at current index
  const position = positions.element(instanceIndex);
  const velocity = velocities.element(instanceIndex);

  // Read values
  const x = position.x;
  const speed = velocity.length();

  // Write values
  position.assign(vec3(0, 0, 0));
  position.x.assign(1.0);
  position.addAssign(velocity);
})().compute(count);
```

### Accessing Other Elements

```javascript
const computeShader = Fn(() => {
  const myIndex = instanceIndex;
  const neighborIndex = myIndex.add(1).mod(count);

  const myPos = positions.element(myIndex);
  const neighborPos = positions.element(neighborIndex);

  // Calculate distance to neighbor
  const dist = myPos.distance(neighborPos);
})().compute(count);
```

## Compute Shader Patterns

### Initialize Particles

```javascript
const computeInit = Fn(() => {
  const position = positions.element(instanceIndex);
  const velocity = velocities.element(instanceIndex);

  // Random positions using hash
  position.x.assign(hash(instanceIndex).mul(10).sub(5));
  position.y.assign(hash(instanceIndex.add(1)).mul(10).sub(5));
  position.z.assign(hash(instanceIndex.add(2)).mul(10).sub(5));

  // Zero velocity
  velocity.assign(vec3(0));
})().compute(count);

// Run once at startup
await renderer.computeAsync(computeInit);
```

### Physics Update

```javascript
const gravity = uniform(-9.8);
const deltaTimeUniform = uniform(0);
const groundY = uniform(0);

const computeUpdate = Fn(() => {
  const position = positions.element(instanceIndex);
  const velocity = velocities.element(instanceIndex);
  const dt = deltaTimeUniform;

  // Apply gravity
  velocity.y.addAssign(gravity.mul(dt));

  // Update position
  position.addAssign(velocity.mul(dt));

  // Ground collision
  If(position.y.lessThan(groundY), () => {
    position.y.assign(groundY);
    velocity.y.assign(velocity.y.negate().mul(0.8)); // Bounce
    velocity.xz.mulAssign(0.95); // Friction
  });
})().compute(count);

// In animation loop
function animate() {
  deltaTimeUniform.value = clock.getDelta();
  renderer.compute(computeUpdate);
  renderer.render(scene, camera);
}
```

### Attraction to Point

```javascript
const attractorPos = uniform(new THREE.Vector3(0, 0, 0));
const attractorStrength = uniform(1.0);

const computeAttract = Fn(() => {
  const position = positions.element(instanceIndex);
  const velocity = velocities.element(instanceIndex);

  // Direction to attractor
  const toAttractor = attractorPos.sub(position);
  const distance = toAttractor.length();
  const direction = toAttractor.normalize();

  // Apply force (inverse square falloff)
  const force = direction.mul(attractorStrength).div(distance.mul(distance).add(0.1));
  velocity.addAssign(force.mul(deltaTimeUniform));
})().compute(count);
```

### Neighbor Interaction (Boids-like)

```javascript
const computeBoids = Fn(() => {
  const myPos = positions.element(instanceIndex);
  const myVel = velocities.element(instanceIndex);

  const separation = vec3(0).toVar();
  const alignment = vec3(0).toVar();
  const cohesion = vec3(0).toVar();
  const neighborCount = int(0).toVar();

  // Check nearby particles
  Loop(count, ({ i }) => {
    If(i.notEqual(instanceIndex), () => {
      const otherPos = positions.element(i);
      const otherVel = velocities.element(i);
      const dist = myPos.distance(otherPos);

      If(dist.lessThan(2.0), () => {
        // Separation
        const diff = myPos.sub(otherPos).normalize().div(dist);
        separation.addAssign(diff);

        // Alignment
        alignment.addAssign(otherVel);

        // Cohesion
        cohesion.addAssign(otherPos);

        neighborCount.addAssign(1);
      });
    });
  });

  If(neighborCount.greaterThan(0), () => {
    const n = neighborCount.toFloat();
    alignment.divAssign(n);
    cohesion.divAssign(n);
    cohesion.assign(cohesion.sub(myPos));

    myVel.addAssign(separation.mul(0.05));
    myVel.addAssign(alignment.sub(myVel).mul(0.05));
    myVel.addAssign(cohesion.mul(0.05));
  });

  // Limit speed
  const speed = myVel.length();
  If(speed.greaterThan(2.0), () => {
    myVel.assign(myVel.normalize().mul(2.0));
  });

  myPos.addAssign(myVel.mul(deltaTimeUniform));
})().compute(count);
```

## Workgroups and Synchronization

### Workgroup Size

```javascript
// Default workgroup size is typically 64 or 256
const computeShader = Fn(() => {
  // shader code
})().compute(count, { workgroupSize: 64 });
```

### Barriers

```javascript
import { workgroupBarrier, storageBarrier, textureBarrier } from 'three/tsl';

const computeShader = Fn(() => {
  // Write data
  sharedData.element(localIndex).assign(value);

  // Ensure all workgroup threads reach this point
  workgroupBarrier();

  // Now safe to read data written by other threads
  const neighborValue = sharedData.element(localIndex.add(1));
})().compute(count);
```

## Atomic Operations

For thread-safe read-modify-write operations:

```javascript
import { atomicAdd, atomicSub, atomicMax, atomicMin, atomicAnd, atomicOr, atomicXor } from 'three/tsl';

const counter = instancedArray(1, 'uint');

const computeShader = Fn(() => {
  // Atomically increment counter
  atomicAdd(counter.element(0), 1);

  // Atomic max
  atomicMax(maxValue.element(0), localValue);
})().compute(count);
```

## Using Compute Results in Materials

### Instanced Mesh with Computed Positions

```javascript
// Create instanced mesh
const geometry = new THREE.SphereGeometry(0.1, 16, 16);
const material = new THREE.MeshStandardNodeMaterial();

// Use computed positions
material.positionNode = positions.element(instanceIndex);

// Optionally use computed colors
material.colorNode = colors.element(instanceIndex);

const mesh = new THREE.InstancedMesh(geometry, material, count);
scene.add(mesh);
```

### Points with Computed Positions

```javascript
const geometry = new THREE.BufferGeometry();
geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3));

const material = new THREE.PointsNodeMaterial();
material.positionNode = positions.element(instanceIndex);
material.colorNode = colors.element(instanceIndex);
material.sizeNode = float(5.0);

const points = new THREE.Points(geometry, material);
scene.add(points);
```

## Execution Methods

```javascript
// Synchronous compute (blocks until complete)
renderer.compute(computeShader);

// Asynchronous compute (returns promise)
await renderer.computeAsync(computeShader);

// Multiple computes
renderer.compute(computeInit);
renderer.compute(computePhysics);
renderer.compute(computeCollisions);
```

## Reading Back Data (GPU to CPU)

```javascript
// Create buffer for readback
const readBuffer = new Float32Array(count * 3);

// Read data back from GPU
await renderer.readRenderTargetPixelsAsync(
  computeTexture,
  0, 0, width, height,
  readBuffer
);
```

## Complete Example: Particle System

```javascript
import * as THREE from 'three/webgpu';
import {
  Fn, If, instancedArray, instanceIndex, uniform,
  vec3, float, hash, time
} from 'three/tsl';

// Setup
const count = 50000;
const positions = instancedArray(count, 'vec3');
const velocities = instancedArray(count, 'vec3');
const lifetimes = instancedArray(count, 'float');

// Uniforms
const emitterPos = uniform(new THREE.Vector3(0, 0, 0));
const gravity = uniform(-2.0);
const dt = uniform(0);

// Initialize
const computeInit = Fn(() => {
  const pos = positions.element(instanceIndex);
  const vel = velocities.element(instanceIndex);
  const life = lifetimes.element(instanceIndex);

  pos.assign(emitterPos);

  // Random velocity in cone
  const angle = hash(instanceIndex).mul(Math.PI * 2);
  const speed = hash(instanceIndex.add(1)).mul(2).add(1);
  vel.x.assign(angle.cos().mul(speed).mul(0.3));
  vel.y.assign(speed);
  vel.z.assign(angle.sin().mul(speed).mul(0.3));

  // Random lifetime
  life.assign(hash(instanceIndex.add(2)).mul(2).add(1));
})().compute(count);

// Update
const computeUpdate = Fn(() => {
  const pos = positions.element(instanceIndex);
  const vel = velocities.element(instanceIndex);
  const life = lifetimes.element(instanceIndex);

  // Apply gravity
  vel.y.addAssign(gravity.mul(dt));

  // Update position
  pos.addAssign(vel.mul(dt));

  // Decrease lifetime
  life.subAssign(dt);

  // Respawn dead particles
  If(life.lessThan(0), () => {
    pos.assign(emitterPos);
    const angle = hash(instanceIndex.add(time.mul(1000))).mul(Math.PI * 2);
    const speed = hash(instanceIndex.add(time.mul(1000)).add(1)).mul(2).add(1);
    vel.x.assign(angle.cos().mul(speed).mul(0.3));
    vel.y.assign(speed);
    vel.z.assign(angle.sin().mul(speed).mul(0.3));
    life.assign(hash(instanceIndex.add(time.mul(1000)).add(2)).mul(2).add(1));
  });
})().compute(count);

// Material
const material = new THREE.PointsNodeMaterial();
material.positionNode = positions.element(instanceIndex);
material.sizeNode = float(3.0);
material.colorNode = vec3(1, 0.5, 0.2);

// Geometry (dummy positions)
const geometry = new THREE.BufferGeometry();
geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3));

const points = new THREE.Points(geometry, material);
scene.add(points);

// Init
await renderer.computeAsync(computeInit);

// Animation loop
function animate() {
  dt.value = Math.min(clock.getDelta(), 0.1);
  renderer.compute(computeUpdate);
  renderer.render(scene, camera);
}
```
