import { describe, it, expect, beforeAll } from 'vitest';
import { initPhysics, PhysicsWorld } from '../../src/physics/physics';
import { MATERIALS } from '../../src/game/materials';

beforeAll(async () => {
  await initPhysics();
});

describe('PhysicsWorld', () => {
  it('a box dropped on the ground comes to sleep within 3 simulated seconds', () => {
    const world = new PhysicsWorld();
    world.createStaticBox(0, 5, 3, 0.2);
    const { body } = world.createDynamicBox(MATERIALS.wood, 0, 0, 1.0, 0.3);

    const totalSeconds = 3;
    const dt = 1 / 60;
    let steps = 0;
    const maxSteps = Math.round(totalSeconds / dt);
    while (!body.isSleeping() && steps < maxSteps) {
      world.step(dt);
      steps++;
    }

    expect(body.isSleeping()).toBe(true);
    world.free();
  });

  it('reports contact force events on impact', () => {
    const world = new PhysicsWorld();
    world.createStaticBox(0, 5, 3, 0.2);
    const { body } = world.createDynamicBox(MATERIALS.stone, 0, -1, 1.0, 0.3);

    let sawForce = false;
    for (let i = 0; i < 180; i++) {
      world.step(1 / 60, (event) => {
        if (event.totalForceMagnitude > 0) sawForce = true;
      });
    }

    expect(sawForce).toBe(true);
    expect(body.isSleeping()).toBe(true);
    world.free();
  });
});
