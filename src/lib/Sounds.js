import { Howl } from 'howler'

/**
 * Centralized sound manager
 */
class SoundsManager {
  constructor() {
    this.mutedSounds = new Set() // Sounds to mute (by name)
    this.sounds = {
      pop: new Howl({ src: ['assets/sfx/pop.mp3'] }),
      tick: new Howl({ src: ['assets/sfx/tick.mp3'] }),
      roll: new Howl({ src: ['assets/sfx/roll.mp3'] }),
      debris: new Howl({ src: ['assets/sfx/debris.mp3'] }),
      good: new Howl({ src: ['assets/sfx/good.mp3'] }),
      intro: new Howl({ src: ['assets/sfx/intro.mp3'] }),
      mystery: new Howl({ src: ['assets/sfx/mystery.mp3'] }),
      incorrect: new Howl({ src: ['assets/sfx/incorrect.mp3'] }),
    }
    // Multiple stone sounds for random selection
    this.stoneSounds = [
      new Howl({ src: ['assets/sfx/stone-01.mp3'] }),
      new Howl({ src: ['assets/sfx/stone-02.mp3'] }),
      new Howl({ src: ['assets/sfx/stone-03.mp3'] }),
      new Howl({ src: ['assets/sfx/stone-04.mp3'] }),
      new Howl({ src: ['assets/sfx/stone-05.mp3'] }),
    ]
    // Multiple clink sounds for debris collisions
    this.clinkSounds = [
      new Howl({ src: ['assets/sfx/clink01.mp3'] }),
      new Howl({ src: ['assets/sfx/clink02.mp3'] }),
      new Howl({ src: ['assets/sfx/clink03.mp3'] }),
      new Howl({ src: ['assets/sfx/clink04.mp3'] }),
      new Howl({ src: ['assets/sfx/clink05.mp3'] }),
      new Howl({ src: ['assets/sfx/clink06.mp3'] }),
      new Howl({ src: ['assets/sfx/clink07.mp3'] }),
      new Howl({ src: ['assets/sfx/clink08.mp3'] }),
    ]
  }

  /**
   * Play a sound with optional rate variation and volume
   * @param {string} name - Sound name (pop, tick, roll, stone)
   * @param {number} baseRate - Base playback rate (default 1.0)
   * @param {number} variation - Random variation amount (default 0.2)
   * @param {number} volume - Volume 0-1 (default 1.0)
   */
  play(name, baseRate = 1.0, variation = 0.2, volume = 1.0) {
    // Skip muted sounds
    if (this.mutedSounds.has(name)) return

    let sound
    if (name === 'stone') {
      // Randomly select one of the stone sounds
      sound = this.stoneSounds[Math.floor(Math.random() * this.stoneSounds.length)]
    } else if (name === 'clink') {
      // Randomly select one of the clink sounds
      sound = this.clinkSounds[Math.floor(Math.random() * this.clinkSounds.length)]
    } else {
      sound = this.sounds[name]
    }
    if (!sound) {
      console.warn(`Sound "${name}" not found`)
      return
    }
    const id = sound.play()
    sound.rate(baseRate - variation / 2 + Math.random() * variation, id)
    sound.volume(volume, id)
    return id
  }

  /**
   * Mute specific sounds by name
   * @param {string[]} names - Array of sound names to mute
   */
  mute(names) {
    names.forEach(name => this.mutedSounds.add(name))
  }

  /**
   * Unmute specific sounds by name
   * @param {string[]} names - Array of sound names to unmute
   */
  unmute(names) {
    names.forEach(name => this.mutedSounds.delete(name))
  }
}

export const Sounds = new SoundsManager()
