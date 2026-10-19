/**
 * Print this machine's license fingerprint (for --bind token minting).
 * Run it on the TARGET machine, then give the output to the vendor.
 */
import { machineFingerprint } from '../src/license.js';
console.log(machineFingerprint());