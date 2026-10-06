import { getCalendars } from "expo-localization";

/**
 * The phone's 12/24-hour switch (iOS 24-Hour Time, Android "Use 24-hour format"). Intl works
 * from the language and region alone; the switch is a separate setting.
 */
export function getDeviceUses24HourClock(): boolean | null {
  return getCalendars()[0]?.uses24hourClock ?? null;
}
