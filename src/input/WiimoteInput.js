import { EventEmitter } from 'events';
import { scanRemotes } from '@dpd-30/wiinode';

/**
 * Wiimote input handler for the K9 robot.
 * Wraps wiinode and exposes a clean input state interface.
 */
export class WiimoteInput extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = {
      // Auto-reconnect on disconnect
      autoReconnect: options.autoReconnect ?? true,
      // Reconnect interval in ms
      reconnectIntervalMs: options.reconnectIntervalMs ?? 3000,
      // Wiimote MAC address (null = auto-discover first)
      macAddress: options.macAddress ?? null,
      // Enable Nunchuk extension
      enableNunchuk: options.enableNunchuk ?? true,
    };

    this.remote = null;
    this.connected = false;
    this.reconnectTimer = null;

    // Input state
    this.state = {
      // Wiimote buttons
      a: false,
      b: false,
      '1': false,
      '2': false,
      home: false,
      plus: false,
      minus: false,
      left: false,
      right: false,
      up: false,
      down: false,

      // Nunchuk buttons
      c: false,
      z: false,

      // Nunchuk stick (normalized -1.0 to 1.0)
      stickX: 0,
      stickY: 0,

      // Wiimote accelerometer (normalized)
      accelX: 0,
      accelY: 0,
      accelZ: 0,

      // Nunchuk accelerometer (normalized)
      nunchukAccelX: 0,
      nunchukAccelY: 0,
      nunchukAccelZ: 0,
    };

    // Player LED indicator (1-4)
    this.player = null;
  }

  /**
   * Connect to Wiimote and start listening for input.
   * @returns {Promise<boolean>} - True if connected successfully
   */
  async connect() {
    if (this.remote) {
      return true;
    }

    try {
      this.emit('connecting');

      const result = await scanRemotes(true, this.options.enableNunchuk);

      if (result.all.length === 0) {
        this.emit('error', new Error('No Wiimotes found'));
        return false;
      }

      this.remote = result.all[0];
      this.player = this.remote.player;
      this.connected = true;

      this._setupEventListeners();
      this._setupStateSync();

      this.emit('connected', { player: this.player, nunchuk: this.remote.nunchukConnected });

      return true;
    } catch (err) {
      this.emit('error', err);
      return false;
    }
  }

  /**
   * Disconnect from Wiimote.
   */
  async disconnect() {
    this._clearReconnectTimer();

    if (this.remote) {
      await this.remote.disconnect();
      this.remote = null;
      this.connected = false;
      this.emit('disconnected');
    }
  }

  /**
   * Check if a button is currently pressed.
   * @param {string} button - Button name
   * @returns {boolean}
   */
  isPressed(button) {
    return this.state[button] === true;
  }

  /**
   * Get normalized stick position.
   * @returns {{ x: number, y: number }} - Values from -1.0 to 1.0
   */
  getStickPosition() {
    return {
      x: this.state.stickX,
      y: this.state.stickY,
    };
  }

  /**
   * Start scanning for Wiimote and auto-connect.
   * @returns {Promise<void>}
   */
  async startScanning() {
    this.emit('scanning');

    while (!this.connected) {
      const connected = await this.connect();

      if (!connected) {
        if (!this.options.autoReconnect) {
          break;
        }

        this.emit('waiting', { message: 'Press sync button on Wiimote' });
        await this._sleep(this.options.reconnectIntervalMs);
      }
    }
  }

  /**
   * Set up event listeners for wiinode Remote events.
   * @private
   */
  _setupEventListeners() {
    if (!this.remote) {return;}

    // Wiimote buttons
    const wiimoteButtons = ['a', 'b', '1', '2', 'home', 'plus', 'minus', 'left', 'right', 'up', 'down'];
    wiimoteButtons.forEach(btn => {
      this.remote.on(btn, (pressed) => {
        this.state[btn] = pressed;
        this.emit('button', { button: btn, pressed });
        this.emit(btn, { pressed });
      });
    });

    // Nunchuk buttons
    if (this.options.enableNunchuk) {
      this.remote.on('nunchuk-c', (pressed) => {
        this.state.c = pressed;
        this.emit('button', { button: 'c', pressed, source: 'nunchuk' });
        this.emit('nunchuk-c', { pressed });
      });

      this.remote.on('nunchuk-z', (pressed) => {
        this.state.z = pressed;
        this.emit('button', { button: 'z', pressed, source: 'nunchuk' });
        this.emit('nunchuk-z', { pressed });
      });
    }

    // Handle disconnect
    this.remote.on('disconnect', () => {
      this.connected = false;
      this.emit('disconnected', { reason: 'remote_lost' });
      this._handleDisconnect();
    });
  }

  /**
   * Sync state from wiinode Remote properties.
   * @private
   */
  _setupStateSync() {
    if (!this.remote) {return;}

    // Poll for analog values (stick, accelerometer)
    const syncInterval = setInterval(() => {
      if (!this.remote || !this.connected) {
        clearInterval(syncInterval);
        return;
      }

      // Nunchuk stick (0-255 -> -1.0 to 1.0)
      if (this.remote.nunchukConnected) {
        this.state.stickX = this._normalizeStick(this.remote.nunchukStickX);
        this.state.stickY = this._normalizeStick(this.remote.nunchukStickY);

        this.state.nunchukAccelX = this._normalizeAccel(this.remote.nunchukAccelX);
        this.state.nunchukAccelY = this._normalizeAccel(this.remote.nunchukAccelY);
        this.state.nunchukAccelZ = this._normalizeAccel(this.remote.nunchukAccelZ);
      }

      // Wiimote accelerometer
      this.state.accelX = this._normalizeAccel(this.remote.accelerateX);
      this.state.accelY = this._normalizeAccel(this.remote.accelerateY);
      this.state.accelZ = this._normalizeAccel(this.remote.accelerateZ);

    }, 50); // 20Hz polling
  }

  /**
   * Normalize stick value (0-255) to -1.0 to 1.0 range.
   * @private
   */
  _normalizeStick(value) {
    const center = 128;
    const max = 127;
    return Math.max(-1, Math.min(1, (value - center) / max));
  }

  /**
   * Normalize accelerometer value to -1.0 to 1.0 range.
   * @private
   */
  _normalizeAccel(value) {
    // Wiimote accel values are typically 0-255 with ~128 at rest
    const center = 128;
    const max = 127;
    return Math.max(-1, Math.min(1, (value - center) / max));
  }

  /**
   * Handle unexpected disconnect and attempt reconnect.
   * @private
   */
  _handleDisconnect() {
    this.remote = null;

    if (this.options.autoReconnect) {
      this._startReconnectTimer();
    }
  }

  /**
   * Start timer to attempt reconnection.
   * @private
   */
  _startReconnectTimer() {
    this._clearReconnectTimer();

    this.reconnectTimer = setInterval(async () => {
      this.emit('reconnecting');
      const connected = await this.connect();

      if (connected) {
        this._clearReconnectTimer();
      }
    }, this.options.reconnectIntervalMs);
  }

  /**
   * Clear reconnect timer.
   * @private
   */
  _clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearInterval(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * Sleep helper.
   * @private
   */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get current input state as a plain object.
   * @returns {object}
   */
  getState() {
    return { ...this.state };
  }
}

// Singleton instance for convenience
let wiimoteInstance = null;

export async function getWiimote(options) {
  if (!wiimoteInstance) {
    wiimoteInstance = new WiimoteInput(options);
  }
  return wiimoteInstance;
}

export default WiimoteInput;
