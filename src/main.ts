import Phaser from 'phaser';
import { initPhysics } from './physics/physics';
import { GameScene } from './scenes/GameScene';

async function boot(): Promise<void> {
  await initPhysics();

  const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    parent: 'game',
    backgroundColor: '#1b1d24',
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: 540,
      height: 960,
    },
    scene: [GameScene],
  };

  new Phaser.Game(config);
}

void boot();
