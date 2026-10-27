import { getErrorMessage } from "@getpaseo/protocol/error-utils";
import { lt } from "semver";
import {
  daemonInstallOriginRuntime,
  resolveNpmGlobalPrefix,
  validateDaemonInstallOrigin,
  type DaemonInstallOriginRuntime,
} from "./install-origin.js";
import { npmGlobalPaseoCli, type NpmGlobalPaseoCli } from "./npm-global-cli.js";
import { withLatestForkCliArchive, type ForkCliArchive } from "./github-cli-release.js";

export type DaemonSelfUpdatePhase = "starting" | "downloading" | "installing" | "complete";

export interface DaemonSelfUpdateResult {
  success: boolean;
  error: string | null;
  newVersion: string | null;
}

export interface DaemonSelfUpdateInput {
  daemonVersion: string | null;
  desktopManaged: boolean;
  onProgress: (phase: DaemonSelfUpdatePhase) => void;
  logger: DaemonSelfUpdateLogger;
}

export interface DaemonSelfUpdateLogger {
  error(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
}

export interface DaemonSelfUpdateRuntime {
  npm: NpmGlobalPaseoCli;
  installOrigin: DaemonInstallOriginRuntime;
  withLatestArchive<T>(install: (archive: ForkCliArchive) => Promise<T>): Promise<T>;
}

export class DaemonSelfUpdateInProgressError extends Error {
  constructor() {
    super("An update is already in progress");
    this.name = "DaemonSelfUpdateInProgressError";
  }
}

const defaultRuntime: DaemonSelfUpdateRuntime = {
  npm: npmGlobalPaseoCli,
  installOrigin: daemonInstallOriginRuntime,
  withLatestArchive: withLatestForkCliArchive,
};

const DESKTOP_MANAGED_UPDATE_ERROR =
  "This daemon is managed by Paseo Desktop. Update Paseo Desktop on the host.";

export class DaemonSelfUpdater {
  private inProgress = false;

  constructor(private readonly runtime: DaemonSelfUpdateRuntime = defaultRuntime) {}

  async update(input: DaemonSelfUpdateInput): Promise<DaemonSelfUpdateResult> {
    if (input.desktopManaged) {
      return { success: false, error: DESKTOP_MANAGED_UPDATE_ERROR, newVersion: null };
    }

    if (this.inProgress) {
      throw new DaemonSelfUpdateInProgressError();
    }

    this.inProgress = true;
    try {
      input.onProgress("starting");
      const npmOptions = {
        prefix: resolveNpmGlobalPrefix(
          this.runtime.installOrigin.resolveCurrentServerPackageRoot(),
        ),
      };
      const install = await this.runtime.npm.inspect(npmOptions);
      const unsupportedReason = validateDaemonInstallOrigin(
        install,
        input.daemonVersion,
        this.runtime.installOrigin,
      );
      if (unsupportedReason) {
        return { success: false, error: unsupportedReason, newVersion: null };
      }

      input.onProgress("downloading");
      return await this.runtime.withLatestArchive(async (archive) => {
        if (lt(archive.version, install.version)) {
          throw new Error(
            `Refusing to downgrade ${install.version} to fork release ${archive.version}.`,
          );
        }
        input.onProgress("installing");
        const result = await this.runtime.npm.installArchive(archive.path, npmOptions);
        if (result.exitCode !== 0) {
          const error =
            result.stderr.trim() ||
            result.stdout.trim() ||
            `npm exited with code ${result.exitCode}`;
          input.logger.error(
            { exitCode: result.exitCode, stderr: result.stderr },
            "Daemon self-update failed",
          );
          return { success: false, error, newVersion: null };
        }
        const updatedInstall = await this.runtime.npm.inspect(npmOptions);
        if (updatedInstall.version !== archive.version) {
          throw new Error(
            `Expected fork release ${archive.version}; npm reports ${updatedInstall.version}.`,
          );
        }
        input.onProgress("complete");
        return { success: true, error: null, newVersion: archive.version };
      });
    } catch (error) {
      input.logger.error({ err: error }, "Daemon self-update failed with exception");
      return { success: false, error: getErrorMessage(error), newVersion: null };
    } finally {
      this.inProgress = false;
    }
  }
}

export const daemonSelfUpdater = new DaemonSelfUpdater();
