import { describe, expect, it } from "vitest";

const {
  FDROID_ABI_VERSION_CODE_SUFFIXES,
  getFdroidVersionCodes,
  getNativeReleaseVersion,
} = require("./native-release-version");

describe("native release version", () => {
  it("preserves the fork's submitted 0.11.3 rebuild number", () => {
    expect(getNativeReleaseVersion("0.11.3")).toEqual({
      appVersion: "0.11.3",
      androidVersionCode: 11003,
      iosBuildNumber: "11004000",
    });
  });

  it("reserves the final iOS build slot for a stable release", () => {
    expect(getNativeReleaseVersion("0.2.6")).toEqual({
      appVersion: "0.2.6",
      androidVersionCode: 2006,
      iosBuildNumber: "2006999",
    });
  });

  it("gives the replacement 0.15.3 upload a higher iOS build without changing Android or the next release", () => {
    expect(getNativeReleaseVersion("0.15.3")).toEqual({
      appVersion: "0.15.3",
      androidVersionCode: 15003,
      iosBuildNumber: "15004000",
    });
    expect(getNativeReleaseVersion("0.15.4")).toEqual({
      appVersion: "0.15.4",
      androidVersionCode: 15004,
      iosBuildNumber: "15004999",
    });
    expect(getNativeReleaseVersion("0.15.3-beta.2")).toEqual({
      appVersion: "0.15.3",
      androidVersionCode: 15003,
      iosBuildNumber: "15003002",
    });
  });

  it("gives each beta a unique iOS build slot under the stable app version", () => {
    expect(getNativeReleaseVersion("0.2.6-beta.2")).toEqual({
      appVersion: "0.2.6",
      androidVersionCode: 2006,
      iosBuildNumber: "2006002",
    });
  });

  it("rejects beta numbers that consume the stable iOS build slot", () => {
    expect(() => getNativeReleaseVersion("0.2.6-beta.999")).toThrow(
      "iOS beta number must be between 1 and 998",
    );
  });

  it("derives one F-Droid version code per published ABI", () => {
    expect(FDROID_ABI_VERSION_CODE_SUFFIXES).toEqual({
      "armeabi-v7a": 1,
      "arm64-v8a": 2,
      x86: 3,
      x86_64: 4,
    });
    expect(getFdroidVersionCodes("0.5.0")).toEqual([
      { abi: "armeabi-v7a", versionCode: 50001 },
      { abi: "arm64-v8a", versionCode: 50002 },
      { abi: "x86", versionCode: 50003 },
      { abi: "x86_64", versionCode: 50004 },
    ]);
  });
});
