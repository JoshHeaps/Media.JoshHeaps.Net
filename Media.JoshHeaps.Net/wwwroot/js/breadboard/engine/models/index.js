/**
 * Registers every model shipped in milestone 1.
 *
 * Importing this module is the only thing needed to populate the registry;
 * each model file self-registers via defineModel(). Adding a counter, register,
 * EEPROM or NE555 later means adding a file and one import line here.
 */

import './logic-ic.js';
import './supply.js';
import './resistor.js';
import './switches.js';
import './led.js';

export { registry, getModel, knownTypes, defineModel, WAKE_INIT, WAKE_PIN, WAKE_TIMER } from './registry.js';
