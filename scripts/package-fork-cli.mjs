import { execFileSync } from "node:child_process";
import { constants } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { isMainModule } from "./is-main-module.mjs";

function pack(directory, outputDir) {
  const output = execFileSync(
    "npm",
    ["pack", "--ignore-scripts", "--workspaces=false", "--json", "--pack-destination", outputDir],
    {
      cwd: directory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const [packed] = JSON.parse(output);
  return path.join(outputDir, packed.filename);
}

function lockedDependency(lock, sourceDirectory, name) {
  let directory = sourceDirectory;
  while (true) {
    const entry = lock.packages[path.posix.join(directory, "node_modules", name)];
    if (entry?.version) return entry.version;
    if (directory === ".") throw new Error(`No locked runtime dependency: ${name}`);
    directory = path.posix.dirname(directory);
  }
}

function runtimeDependencies(sources, lock, repoRoot) {
  const dependencies = {};
  const optionalDependencies = {};
  const links = [];
  for (const { directory, manifest } of sources.values()) {
    const peers = Object.entries(manifest.peerDependencies ?? {}).filter(
      ([name]) => !manifest.peerDependenciesMeta?.[name]?.optional,
    );
    const required = { ...Object.fromEntries(peers), ...manifest.dependencies };
    const optional = manifest.optionalDependencies ?? {};
    for (const name of Object.keys({ ...required, ...optional })) {
      if (sources.has(name)) continue;
      const relative = path.relative(repoRoot, directory).split(path.sep).join("/");
      const version = lockedDependency(lock, relative, name);
      const previous = dependencies[name] ?? optionalDependencies[name];
      if (previous && previous !== version) {
        const alias = `paseo-dep-${name.replace(/[^a-z0-9-]/g, "-")}-${version}`;
        dependencies[alias] = `npm:${name}@${version}`;
        links.push({ workspace: manifest.name, dependency: name, alias });
        continue;
      }
      if (name in optional && !(name in dependencies)) optionalDependencies[name] = version;
      else {
        dependencies[name] = version;
        delete optionalDependencies[name];
      }
    }
  }
  return { dependencies, optionalDependencies, links };
}

export async function createForkCliArchive({ repoRoot, outputDir, version }) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version))
    throw new Error("Invalid release version");
  const sources = new Map();
  const pending = ["@getpaseo/cli"];
  for (const name of pending) {
    if (sources.has(name)) continue;
    const directory = path.join(repoRoot, "packages", name.slice("@getpaseo/".length));
    const manifest = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
    if (manifest.name !== name || manifest.version !== version) {
      throw new Error(
        `${name} version ${manifest.version} does not match release version ${version}`,
      );
    }
    sources.set(name, { directory, manifest });
    const dependencies = {
      ...manifest.dependencies,
      ...manifest.optionalDependencies,
      ...manifest.peerDependencies,
    };
    pending.push(
      ...Object.keys(dependencies).filter((dependency) => dependency.startsWith("@getpaseo/")),
    );
  }
  const lock = JSON.parse(await readFile(path.join(repoRoot, "package-lock.json"), "utf8"));
  const runtime = runtimeDependencies(sources, lock, repoRoot);
  // A source tarball or an unbuilt checkout cannot serve as a daemon update.
  for (const file of [
    "packages/cli/bin/paseo",
    "packages/cli/dist/index.js",
    "packages/server/dist/scripts/supervisor-entrypoint.js",
    "packages/server/dist/server/web-ui/index.html",
  ]) {
    if (!(await stat(path.join(repoRoot, file))).isFile())
      throw new Error(`Missing built CLI input: ${file}`);
  }

  await mkdir(outputDir, { recursive: true });
  const staging = await mkdtemp(path.join(os.tmpdir(), "paseo-cli-package-"));
  try {
    const packs = path.join(staging, "packs");
    const cli = path.join(staging, "cli");
    await mkdir(packs);
    for (const [name, source] of sources) {
      const target = name === "@getpaseo/cli" ? cli : path.join(cli, "node_modules", name);
      await mkdir(target, { recursive: true });
      const archive = pack(source.directory, packs);
      execFileSync("tar", ["-xzf", archive, "-C", target, "--strip-components=1"]);
      if (name !== "@getpaseo/cli") {
        // Dependencies of a bundled package are themselves treated as bundled
        // by npm. The root owns the complete runtime dependency set instead.
        const manifest = { ...source.manifest, dependencies: {}, optionalDependencies: {} };
        delete manifest.devDependencies;
        delete manifest.peerDependencies;
        delete manifest.peerDependenciesMeta;
        await writeFile(
          path.join(target, "package.json"),
          `${JSON.stringify(manifest, null, 2)}\n`,
        );
      }
    }
    const manifest = JSON.parse(await readFile(path.join(cli, "package.json"), "utf8"));
    // npm does not resolve missing dependencies of bundled packages. Hoist the
    // locked third-party runtime closure so npm installs it on the target host.
    const bundled = [...sources.keys()].filter((name) => name !== "@getpaseo/cli");
    manifest.bundleDependencies = bundled;
    manifest.dependencies = runtime.dependencies;
    manifest.optionalDependencies = runtime.optionalDependencies;
    for (const name of bundled) manifest.dependencies[name] = version;
    delete manifest.devDependencies;
    manifest.scripts.postinstall = "node install-fork-cli-dependencies.mjs";
    manifest.files.push("install-fork-cli-dependencies.mjs", "fork-cli-dependencies.json");
    await copyFile(
      new URL("./install-fork-cli-dependencies.mjs", import.meta.url),
      path.join(cli, "install-fork-cli-dependencies.mjs"),
    );
    await writeFile(path.join(cli, "fork-cli-dependencies.json"), JSON.stringify(runtime.links));
    await writeFile(path.join(cli, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    const archive = pack(cli, staging);
    const destination = path.join(outputDir, `paseo-cli-${version}.tgz`);
    await copyFile(archive, destination, constants.COPYFILE_EXCL);
    return destination;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

if (isMainModule(import.meta.url)) {
  const { values } = parseArgs({
    options: { version: { type: "string" }, output: { type: "string" } },
  });
  if (!values.version || !values.output)
    throw new Error(
      "Usage: node scripts/package-fork-cli.mjs --version <version> --output <directory>",
    );
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  console.log(
    await createForkCliArchive({
      repoRoot,
      outputDir: path.resolve(values.output),
      version: values.version,
    }),
  );
}
