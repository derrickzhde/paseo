/**
 * Whether the device is set to a 24-hour clock, or null when no such setting is readable.
 * Browsers and Electron only expose the locale's cycle, which Intl already resolves.
 */
export function getDeviceUses24HourClock(): boolean | null {
  return null;
}
