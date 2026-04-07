#!/usr/bin/env node
/**
 * Initialize the K9 robot configuration file.
 * Creates a config.json with default values if it doesn't exist.
 */

import logger from '../observability/logger.js';

import fs from 'fs';
import path from 'path';
import { defaults } from '../src/config/defaults.js';


const configDir = path.resolve(process.cwd(), 'data');
const configPath = path.join(configDir, 'config.json');

logger.info('K9 Robot Configuration Initializer');
logger.info('==================================\n');

if (fs.existsSync(configPath)) {
  logger.info(`Config file already exists at: ${configPath}`);
  logger.info('Delete it first if you want to regenerate with defaults.');
  process.exit(0);
}

// Create config directory if it doesn't exist
if (!fs.existsSync(configDir)) {
  fs.mkdirSync(configDir, { recursive: true });
  logger.info(`Created config directory: ${configDir}`);
}

// Write default configuration
const content = JSON.stringify(defaults, null, 2);
fs.writeFileSync(configPath, content, 'utf8');

logger.info(`Created default configuration at: ${configPath}`);
logger.info('\nDefault configuration:');
logger.info('---');
logger.info(content);
logger.info('---');
logger.info('\nYou can now edit this file to customize your K9 robot settings.');
