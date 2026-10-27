import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, onTestFinished, test } from "vitest";
import {
  DaemonSelfUpdateInProgressError,
  DaemonSelfUpdater,
  type DaemonSelfUpdateRuntime,
  type DaemonSelfUpdatePhase,
} from "./daemon-self-updater.js";
import {
  DefaultNpmGlobalPaseoCli,
  type CommandResult,
  type NpmGlobalPaseoInstall,
} from "./npm-global-cli.js";
import { withLatestForkCliArchive } from "./github-cli-release.js";

interface TestLogger {
  errors: Array<{ obj: object; msg?: string }>;
  warnings: Array<{ obj: object; msg?: string }>;
  error(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
}

type Inspection = NpmGlobalPaseoInstall | Error;
type RuntimeCall = "inspect" | "download" | "installArchive";

const globalRoot = "/global/lib";
const globalNodeModules = `${globalRoot}/node_modules`;
const cliPackagePath = `${globalNodeModules}/@getpaseo/cli`;
const npmServerPackageRoot = `${cliPackagePath}/node_modules/@getpaseo/server`;
const sourceServerPackageRoot = "/repo/packages/server";

function npmGlobalPaseoInstall(
  version: string,
  options?: { linked?: boolean },
): NpmGlobalPaseoInstall {
  return {
    version,
    packagePath: cliPackagePath,
    globalRootPath: globalRoot,
    isLinked: options?.linked === true,
  };
}

function createLogger(): TestLogger {
  return {
    errors: [],
    warnings: [],
    error(obj, msg) {
      this.errors.push({ obj, msg });
    },
    warn(obj, msg) {
      this.warnings.push({ obj, msg });
    },
  };
}

function createRuntime(input: {
  inspections: Inspection[];
  currentServerPackageRoot?: string | null;
  installResult?: CommandResult;
  calls?: RuntimeCall[];
  releaseVersion?: string;
}): DaemonSelfUpdateRuntime {
  const calls = input.calls ?? [];
  return {
    async withLatestArchive(install) {
      calls.push("download");
      return install({
        path: "/downloaded/paseo-cli.tgz",
        version: input.releaseVersion ?? "0.1.96",
      });
    },
    npm: {
      async inspect() {
        calls.push("inspect");
        const inspection = input.inspections.shift();
        if (!inspection) {
          throw new Error("Unexpected npm global install inspection");
        }
        if (inspection instanceof Error) {
          throw inspection;
        }
        return inspection;
      },
      async installArchive(archive) {
        expect(archive).toBe("/downloaded/paseo-cli.tgz");
        calls.push("installArchive");
        return input.installResult ?? { exitCode: 0, stdout: "changed 42 packages", stderr: "" };
      },
    },
    installOrigin: {
      resolveCurrentServerPackageRoot() {
        return input.currentServerPackageRoot ?? npmServerPackageRoot;
      },
    },
  };
}

async function runUpdate(input: {
  runtime: DaemonSelfUpdateRuntime;
  daemonVersion?: string | null;
  desktopManaged?: boolean;
  phases?: DaemonSelfUpdatePhase[];
}) {
  const logger = createLogger();
  const updater = new DaemonSelfUpdater(input.runtime);
  const phases = input.phases ?? [];
  const result = await updater.update({
    daemonVersion: input.daemonVersion === undefined ? "0.1.15" : input.daemonVersion,
    desktopManaged: input.desktopManaged ?? false,
    onProgress: (phase) => phases.push(phase),
    logger,
  });
  return { result, logger, phases };
}

describe("DaemonSelfUpdater", () => {
  test("probes and updates the running install's prefix when npm defaults elsewhere", async () => {
    const prefix = mkdtempSync(path.join(tmpdir(), "custom npm prefix "));
    onTestFinished(() => rmSync(prefix, { recursive: true, force: true }));
    const root = process.platform === "win32" ? prefix : path.join(prefix, "lib");
    const packagePath = path.join(root, "node_modules", "@getpaseo", "cli");
    mkdirSync(packagePath, { recursive: true });
    const commands: string[][] = [];
    let version = "0.1.15";
    const npm = new DefaultNpmGlobalPaseoCli(async (_command, args) => {
      commands.push(args);
      if (args[args.indexOf("--prefix") + 1] !== prefix) {
        return { exitCode: 1, stdout: "{}", stderr: "No CLI in npm's default prefix" };
      }
      if (args.includes("install")) version = "0.1.96";
      return {
        exitCode: 0,
        stderr: "",
        stdout: JSON.stringify({
          path: root,
          dependencies: { "@getpaseo/cli": { version, path: packagePath } },
        }),
      };
    });
    const { result } = await runUpdate({
      runtime: {
        npm,
        withLatestArchive: async (install) =>
          install({ path: "/downloaded/paseo-cli.tgz", version: "0.1.96" }),
        installOrigin: {
          resolveCurrentServerPackageRoot: () =>
            path.join(packagePath, "node_modules", "@getpaseo", "server"),
        },
      },
    });
    expect(result).toEqual({ success: true, error: null, newVersion: "0.1.96" });
    expect(commands).toHaveLength(3);
    expect(commands.map((args) => args.slice(-2))).toEqual([
      ["--prefix", prefix],
      ["--prefix", prefix],
      ["--prefix", prefix],
    ]);
  });

  test("refuses a Desktop-managed daemon without touching npm", async () => {
    const calls: RuntimeCall[] = [];
    const runtime = createRuntime({ calls, inspections: [] });

    const { result, phases } = await runUpdate({ runtime, desktopManaged: true });

    expect(result).toEqual({
      success: false,
      error: "This daemon is managed by Paseo Desktop. Update Paseo Desktop on the host.",
      newVersion: null,
    });
    expect(phases).toEqual([]);
    expect(calls).toEqual([]);
  });

  test("updates a daemon that is running from the npm global cli install", async () => {
    const calls: RuntimeCall[] = [];
    const runtime = createRuntime({
      calls,
      inspections: [npmGlobalPaseoInstall("0.1.15"), npmGlobalPaseoInstall("0.1.96")],
    });

    const { result, phases } = await runUpdate({ runtime });

    expect(result).toEqual({
      success: true,
      error: null,
      newVersion: "0.1.96",
    });
    expect(phases).toEqual(["starting", "downloading", "installing", "complete"]);
    expect(calls).toEqual(["inspect", "download", "installArchive", "inspect"]);
  });

  test("does not run install when npm global cli is missing", async () => {
    const calls: RuntimeCall[] = [];
    const runtime = createRuntime({
      calls,
      inspections: [new Error("@getpaseo/cli is not installed with npm -g on this host")],
    });

    const { result, phases } = await runUpdate({ runtime });

    expect(result.success).toBe(false);
    expect(result.error).toBe("@getpaseo/cli is not installed with npm -g on this host");
    expect(phases).toEqual(["starting"]);
    expect(calls).toEqual(["inspect"]);
  });

  test("does not update a daemon whose version does not match the npm global cli", async () => {
    const calls: RuntimeCall[] = [];
    const runtime = createRuntime({
      calls,
      inspections: [npmGlobalPaseoInstall("0.1.15")],
    });

    const { result } = await runUpdate({ runtime, daemonVersion: "0.1.96" });

    expect(result).toEqual({
      success: false,
      error:
        "This daemon is not running from the npm global @getpaseo/cli install (global npm has 0.1.15, daemon is 0.1.96).",
      newVersion: null,
    });
    expect(calls).toEqual(["inspect"]);
  });

  test("does not update a daemon running outside the npm global package tree", async () => {
    const calls: RuntimeCall[] = [];
    const runtime = createRuntime({
      calls,
      currentServerPackageRoot: sourceServerPackageRoot,
      inspections: [npmGlobalPaseoInstall("0.1.15")],
    });

    const { result } = await runUpdate({ runtime });

    expect(result).toEqual({
      success: false,
      error: "This daemon is not running from the npm global @getpaseo/cli install.",
      newVersion: null,
    });
    expect(calls).toEqual(["inspect"]);
  });

  test("does not update linked global installs", async () => {
    const runtime = createRuntime({
      inspections: [npmGlobalPaseoInstall("0.1.15", { linked: true })],
    });

    const { result } = await runUpdate({ runtime });

    expect(result).toEqual({
      success: false,
      error:
        "The global @getpaseo/cli install is linked; self-update only supports normal npm global installs.",
      newVersion: null,
    });
  });

  test("does not report success if npm installed a different version from the release", async () => {
    const runtime = createRuntime({
      inspections: [npmGlobalPaseoInstall("0.1.15"), npmGlobalPaseoInstall("0.1.97")],
    });
    const { result, phases } = await runUpdate({ runtime });
    expect(result.success).toBe(false);
    expect(result.error).toContain("0.1.96");
    expect(phases).toEqual(["starting", "downloading", "installing"]);
  });

  test.each(["0.1.97", null])(
    "refuses a downgrade when the running version is %s",
    async (daemonVersion) => {
      const calls: RuntimeCall[] = [];
      const runtime = createRuntime({
        calls,
        inspections: [npmGlobalPaseoInstall("0.1.97"), npmGlobalPaseoInstall("0.1.96")],
      });
      const { result } = await runUpdate({ runtime, daemonVersion });
      expect(result.success).toBe(false);
      expect(result.error).toContain("downgrade");
      expect(calls).toEqual(["inspect", "download"]);
    },
  );

  test("does not report success when the installed version cannot be verified", async () => {
    const runtime = createRuntime({
      inspections: [npmGlobalPaseoInstall("0.1.15"), new Error("npm inspection failed")],
    });
    const { result, phases } = await runUpdate({ runtime });
    expect(result.success).toBe(false);
    expect(result.error).toBe("npm inspection failed");
    expect(phases).not.toContain("complete");
  });

  test("rejects concurrent update requests", async () => {
    const calls: RuntimeCall[] = [];
    let resolveInstall: ((result: CommandResult) => void) | null = null;
    let installStartedResolve: (() => void) | null = null;
    const installStarted = new Promise<void>((resolve) => {
      installStartedResolve = resolve;
    });
    const runtime: DaemonSelfUpdateRuntime = {
      withLatestArchive: async (install) => {
        calls.push("download");
        return install({ path: "/downloaded/paseo-cli.tgz", version: "0.1.15" });
      },
      npm: {
        async inspect() {
          calls.push("inspect");
          return npmGlobalPaseoInstall("0.1.15");
        },
        async installArchive() {
          calls.push("installArchive");
          installStartedResolve?.();
          return new Promise<CommandResult>((resolve) => {
            resolveInstall = resolve;
          });
        },
      },
      installOrigin: {
        resolveCurrentServerPackageRoot() {
          return npmServerPackageRoot;
        },
      },
    };
    const logger = createLogger();
    const updater = new DaemonSelfUpdater(runtime);

    const firstUpdate = updater.update({
      daemonVersion: "0.1.15",
      desktopManaged: false,
      onProgress: () => {},
      logger,
    });
    await installStarted;

    await expect(
      updater.update({
        daemonVersion: "0.1.15",
        desktopManaged: false,
        onProgress: () => {},
        logger,
      }),
    ).rejects.toBeInstanceOf(DaemonSelfUpdateInProgressError);

    resolveInstall?.({ exitCode: 0, stdout: "updated", stderr: "" });
    await expect(firstUpdate).resolves.toMatchObject({ success: true });
    expect(calls).toEqual(["inspect", "download", "installArchive", "inspect"]);
  });
});

const archiveContent = "verified fork CLI archive";

function releaseMetadata() {
  return {
    tag_name: "v0.13.3",
    draft: false,
    prerelease: false,
    assets: [
      {
        name: "paseo-cli-0.13.3.tgz",
        size: Buffer.byteLength(archiveContent),
        digest: `sha256:${createHash("sha256").update(archiveContent).digest("hex")}`,
      },
    ],
  };
}

describe("fork release archive", () => {
  test("uses the pinned fork asset and removes the verified download after installation", async () => {
    const requests: string[] = [];
    const fetchRelease: typeof fetch = async (url) => {
      requests.push(String(url));
      return requests.length === 1
        ? Response.json(releaseMetadata())
        : new Response(
            new ReadableStream({
              start(controller) {
                const bytes = new TextEncoder().encode(archiveContent);
                controller.enqueue(bytes.slice(0, 8));
                controller.enqueue(bytes.slice(8));
                controller.close();
              },
            }),
          );
    };
    let downloadedPath = "";
    const version = await withLatestForkCliArchive(async (archive) => {
      downloadedPath = archive.path;
      expect(readFileSync(archive.path, "utf8")).toBe(archiveContent);
      return archive.version;
    }, fetchRelease);
    expect(version).toBe("0.13.3");
    expect(requests).toEqual([
      "https://api.github.com/repos/derrickzhde/paseo/releases/latest",
      "https://github.com/derrickzhde/paseo/releases/download/v0.13.3/paseo-cli-0.13.3.tgz",
    ]);
    expect(existsSync(downloadedPath)).toBe(false);
    expect(existsSync(path.dirname(downloadedPath))).toBe(false);
  });

  test("does not fall back to npm when the release has only desktop assets", async () => {
    const metadata = releaseMetadata();
    metadata.assets[0].name = "Paseo-0.13.3-x64.tar.gz";
    let requests = 0;
    const fetchRelease: typeof fetch = async () => {
      requests += 1;
      return Response.json(metadata);
    };
    await expect(
      withLatestForkCliArchive(async () => {
        throw new Error("Must not install");
      }, fetchRelease),
    ).rejects.toThrow("does not contain paseo-cli-0.13.3.tgz");
    expect(requests).toBe(1);
  });

  test.each([
    ["draft", { draft: true }],
    ["prerelease", { prerelease: true }],
    ["invalid tag", { tag_name: "../../wrong" }],
    ["missing digest", { assets: [{ name: "paseo-cli-0.13.3.tgz", size: 1 }] }],
    [
      "oversized archive",
      {
        assets: [
          {
            name: "paseo-cli-0.13.3.tgz",
            size: 101 * 1024 * 1024,
            digest: `sha256:${"0".repeat(64)}`,
          },
        ],
      },
    ],
  ])("refuses %s metadata before installing", async (_name, override) => {
    const fetchRelease: typeof fetch = async () =>
      Response.json({ ...releaseMetadata(), ...override });
    await expect(
      withLatestForkCliArchive(async () => {
        throw new Error("Must not install");
      }, fetchRelease),
    ).rejects.not.toThrow("Must not install");
  });

  test.each([
    archiveContent.replace("verified", "tampered"),
    archiveContent.slice(0, -1),
    `${archiveContent}!`,
  ])("refuses a corrupted or truncated download: %s", async (contents) => {
    let requests = 0;
    const fetchRelease: typeof fetch = async () => {
      requests += 1;
      return requests === 1 ? Response.json(releaseMetadata()) : new Response(contents);
    };
    await expect(
      withLatestForkCliArchive(async () => {
        throw new Error("Must not install");
      }, fetchRelease),
    ).rejects.toThrow(/size|SHA256/);
  });

  test.each([1, 2])(
    "reports an HTTP failure at request %s without installing",
    async (failureAt) => {
      let requests = 0;
      const fetchRelease: typeof fetch = async () => {
        requests += 1;
        return requests === failureAt
          ? new Response("unavailable", { status: 503 })
          : Response.json(releaseMetadata());
      };
      await expect(
        withLatestForkCliArchive(async () => {
          throw new Error("Must not install");
        }, fetchRelease),
      ).rejects.toThrow("HTTP 503");
      expect(requests).toBe(failureAt);
    },
  );

  test("removes the downloaded archive when npm installation throws", async () => {
    let requests = 0;
    const fetchRelease: typeof fetch = async () => {
      requests += 1;
      return requests === 1 ? Response.json(releaseMetadata()) : new Response(archiveContent);
    };
    let downloadedPath = "";
    await expect(
      withLatestForkCliArchive(async (archive) => {
        downloadedPath = archive.path;
        throw new Error("npm failed");
      }, fetchRelease),
    ).rejects.toThrow("npm failed");
    expect(existsSync(path.dirname(downloadedPath))).toBe(false);
  });
});
