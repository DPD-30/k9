import i2c from "i2c-bus";
import { logger } from "../observability/logger.js";

/**
 * BackPanelLeds manages a 3x4 multiplexed LED grid using a PCF8574 I2C expander.
 * Because it is multiplexed, this class maintains a framebuffer and a
 * high-speed scanning loop to prevent flickering.
 */
export class BackPanelLeds {
  constructor(config = {}) {
    this.address = config.address || 0x20; // Default PCF8574 address
    this.bus = null;

    // Framebuffer: 3 rows x 4 columns (flat array of 12 bits)
    this.buffer = new Array(12).fill(0);

    // Pin Mapping (PCF8574 P0-P7)
    // P0-P2: Rows, P3-P6: Columns, P7: Unused
    this.ROWS = [0, 1, 2];
    this.COLS = [3, 4, 5, 6];

    this.scanInterval = null;
    this.currentPattern = null;
    this.lastErrorTime = 0;
  }

  /**
   * Initializes the I2C connection and starts the multiplex scanning loop.
   */
  async initialize() {
    try {
      this.bus = i2c.openSync(1);
      logger.info(`BackPanelLeds initialized at address 0x${this.address.toString(16)}`);
      this._startScanner();
    } catch (error) {
      logger.error({ error }, "Failed to initialize PCF8574 LED driver");
      throw error;
    }
  }

  /**
   * The core multiplexing loop.
   * Rapidly cycles through rows to create the illusion of a solid display.
   */
  _startScanner() {
    // Scan at ~60Hz for flicker-free display
    this.scanInterval = setInterval(() => {
      this._renderFrame();
    }, 16);
  }

  /**
   * Renders the current framebuffer to the hardware.
   */
  _renderFrame() {
    if (!this.bus) return;

    for (let r = 0; r < 3; r++) {
      // PCF8574 pins are typically active-low for LEDs
      let outputByte = 0xFF;

      // Select Row: Set the specific row pin to LOW (0)
      outputByte &= ~(1 << this.ROWS[r]);

      // Select Columns: Set columns to LOW if they should be ON
      for (let c = 0; c < 4; c++) {
        const ledIndex = (r * 4) + c;
        if (this.buffer[ledIndex] === 1) {
          outputByte &= ~(1 << this.COLS[c]);
        }
      }

      try {
        this.bus.writeByteSync(this.address, 0, outputByte);
      } catch (err) {
        this._handleI2CError(err);
      }
    }
  }

  /**
   * Handles I2C errors with a cooldown to prevent log flooding.
   */
  _handleI2CError(err) {
    const now = Date.now();
    // Only log every 5 seconds to prevent log-spamming at 60Hz
    if (!this.lastErrorTime || (now - this.lastErrorTime > 5000)) {
      this.lastErrorTime = now;
      logger.error({ err }, `I2C Write Error on LED Driver (0x${this.address.toString(16)})`);
    }
  }

  /**
   * Set a specific LED in the buffer.
   * @param {number} index - LED index (0-11)
   * @param {number} value - 1 for ON, 0 for OFF
   */
  setLed(index, value) {
    if (index < 0 || index >= 12) {
      throw new Error(`LED index ${index} out of range (0-11)`);
    }
    this.buffer[index] = value ? 1 : 0;
  }

  /**
   * Applies a pre-defined visual pattern by updating the buffer.
   * @param {string} patternId - 'PULSE', 'SNAKE', 'RANDOM', 'SOLID', 'FAULT'
   */
  setPattern(patternId) {
    this.stopPattern();
    this.currentPattern = patternId;

    switch (patternId) {
      case 'SOLID':
        this._applySolid(1);
        break;
      case 'FAULT':
        this._startFlashing();
        break;
      case 'SNAKE':
        this._startSnake();
        break;
      case 'RANDOM':
        this._startRandom();
        break;
      default:
        this._applySolid(0);
    }
    logger.info(`LED Pattern changed to: ${patternId}`);
  }

  stopPattern() {
    if (this.patternInterval) {
      clearInterval(this.patternInterval);
      this.patternInterval = null;
    }
  }

  _applySolid(value) {
    this.buffer.fill(value);
  }

  _startFlashing() {
    let state = 1;
    this.patternInterval = setInterval(() => {
      state = state === 1 ? 0 : 1;
      this._applySolid(state);
    }, 500);
  }

  _startSnake() {
    let step = 0;
    this.patternInterval = setInterval(() => {
      this.buffer.fill(0);
      this.buffer[step % 12] = 1;
      step++;
    }, 100);
  }

  _startRandom() {
    this.patternInterval = setInterval(() => {
      const randomLed = Math.floor(Math.random() * 12);
      this.buffer[randomLed] = 1;
      setTimeout(() => this.setLed(randomLed, 0), 80);
    }, 150);
  }

  allOff() {
    this.stopPattern();
    this._applySolid(0);
  }

  dispose() {
    this.stopPattern();
    if (this.scanInterval) clearInterval(this.scanInterval);
    if (this.bus) {
      this.bus.closeSync();
      this.bus = null;
    }
  }
}
