import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { createServer } from "node:http";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createForkCliArchive } from "./package-fork-cli.mjs";

async function createFixture(root) {
  await writeFile(
    path.join(root, "package-lock.json"),
    JSON.stringify({
      packages: {
        "node_modules/fixture-runtime": { version: "1.0.0" },
        "packages/plugin/node_modules/fixture-runtime": { version: "2.0.0" },
      },
    }),
  );
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ private: true, workspaces: ["packages/*"] }),
  );
  for (const name of ["cli", "server", "protocol", "plugin"]) {
    const directory = path.join(root, "packages", name);
    await mkdir(path.join(directory, "dist"), { recursive: true });
    const dependencies = name === "cli" ? { "@getpaseo/server": "9000.0.0" } : {};
    if (name === "server") {
      dependencies["@getpaseo/protocol"] = "9000.0.0";
      dependencies["@getpaseo/plugin"] = "9000.0.0";
    }
    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({
        name: `@getpaseo/${name}`,
        version: "9000.0.0",
        type: "module",
        files: ["dist", "bin"],
        exports: "./dist/index.js",
        dependencies,
        bin: name === "cli" ? { paseo: "bin/paseo" } : undefined,
        scripts: { prepack: "node -e 'process.exit(99)'" },
      }),
    );
    await writeFile(path.join(directory, "dist/index.js"), `export default "fork-${name}";\n`);
  }
  const server = path.join(root, "packages/server");
  const external = path.join(root, "external");
  await mkdir(external);
  await writeFile(
    path.join(external, "package.json"),
    JSON.stringify({
      name: "fixture-runtime",
      version: "1.0.0",
      type: "module",
      exports: "./index.js",
    }),
  );
  await writeFile(path.join(external, "index.js"), 'export default "target-dependency";\n');
  const [packed] = JSON.parse(
    execFileSync("npm", ["pack", "--workspaces=false", "--json", "--pack-destination", root], {
      cwd: external,
      encoding: "utf8",
      stdio: "pipe",
    }),
  );
  const serverManifest = JSON.parse(await readFile(path.join(server, "package.json"), "utf8"));
  serverManifest.dependencies["fixture-runtime"] = "^1.0.0";
  await writeFile(path.join(server, "package.json"), JSON.stringify(serverManifest));
  const plugin = path.join(root, "packages/plugin");
  const pluginManifest = JSON.parse(await readFile(path.join(plugin, "package.json"), "utf8"));
  pluginManifest.dependencies["fixture-runtime"] = "^2.0.0";
  await writeFile(path.join(plugin, "package.json"), JSON.stringify(pluginManifest));
  await writeFile(
    path.join(plugin, "dist/index.js"),
    'import external from "fixture-runtime"; export default `fork-plugin/${external}`;\n',
  );
  const externalManifest = JSON.parse(await readFile(path.join(external, "package.json"), "utf8"));
  externalManifest.version = "2.0.0";
  await writeFile(path.join(external, "package.json"), JSON.stringify(externalManifest));
  await writeFile(path.join(external, "index.js"), 'export default "other-version";\n');
  const [otherPacked] = JSON.parse(
    execFileSync("npm", ["pack", "--workspaces=false", "--json", "--pack-destination", root], {
      cwd: external,
      encoding: "utf8",
      stdio: "pipe",
    }),
  );
  for (const file of [
    "dist/scripts/supervisor-entrypoint.js",
    "dist/server/web-ui/index.html",
    "dist/server/builtin-plugins/custom/index.server.ts",
  ]) {
    await mkdir(path.dirname(path.join(server, file)), { recursive: true });
    await writeFile(path.join(server, file), "// fork runtime asset\n");
  }
  await writeFile(
    path.join(server, "dist/index.js"),
    'import protocol from "@getpaseo/protocol"; import plugin from "@getpaseo/plugin"; import external from "fixture-runtime"; export default `fork-server/${protocol}/${plugin}/${external}`;\n',
  );
  const bin = path.join(root, "packages/cli/bin");
  await mkdir(bin);
  await writeFile(
    path.join(bin, "paseo"),
    '#!/usr/bin/env node\nimport server from "@getpaseo/server"; console.log(server);\n',
    { mode: 0o755 },
  );
  return {
    first: await readFile(path.join(root, packed.filename)),
    second: await readFile(path.join(root, otherPacked.filename)),
  };
}

test("the release CLI archive installs fork code and resolves only third-party packages from a registry", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "paseo-fork-package-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const externalArchive = await createFixture(root);
  const requests = [];
  let registry = "";
  const server = createServer((request, response) => {
    requests.push(request.url);
    if (request.url === "/fixture-runtime-1.tgz") response.end(externalArchive.first);
    else if (request.url === "/fixture-runtime-2.tgz") response.end(externalArchive.second);
    else if (request.url === "/fixture-runtime") {
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          name: "fixture-runtime",
          "dist-tags": { latest: "1.0.0" },
          versions: {
            "1.0.0": {
              name: "fixture-runtime",
              version: "1.0.0",
              dist: { tarball: `${registry}/fixture-runtime-1.tgz` },
            },
            "2.0.0": {
              name: "fixture-runtime",
              version: "2.0.0",
              dist: { tarball: `${registry}/fixture-runtime-2.tgz` },
            },
          },
        }),
      );
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  registry = `http://127.0.0.1:${server.address().port}`;
  const archive = await createForkCliArchive({
    repoRoot: root,
    outputDir: path.join(root, "release"),
    version: "9000.0.0",
  });
  assert.equal(path.basename(archive), "paseo-cli-9000.0.0.tgz");
  const prefix = path.join(root, "isolated-prefix");
  await promisify(execFile)(
    "npm",
    [
      "install",
      "-g",
      archive,
      "--prefix",
      prefix,
      "--registry",
      registry,
      "--cache",
      path.join(root, "npm-cache"),
      "--update-notifier=false",
      "--no-audit",
      "--no-fund",
    ],
    { stdio: "pipe" },
  );
  const installed = path.join(prefix, "lib/node_modules/@getpaseo/cli");
  execFileSync(process.execPath, [path.join(installed, "install-fork-cli-dependencies.mjs")]);
  const output = execFileSync(process.execPath, [path.join(installed, "bin/paseo")], {
    encoding: "utf8",
  });
  assert.equal(
    output.trim(),
    "fork-server/fork-protocol/fork-plugin/other-version/target-dependency",
  );
  assert.deepEqual([...new Set(requests)].sort(), [
    "/fixture-runtime",
    "/fixture-runtime-1.tgz",
    "/fixture-runtime-2.tgz",
  ]);
  const builtin = await readFile(
    path.join(
      installed,
      "node_modules/@getpaseo/server/dist/server/builtin-plugins/custom/index.server.ts",
    ),
    "utf8",
  );
  assert.equal(builtin, "// fork runtime asset\n");
});

test("packaging refuses a fork workspace version that differs from the release", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "paseo-fork-package-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await createFixture(root);
  await assert.rejects(
    createForkCliArchive({
      repoRoot: root,
      outputDir: path.join(root, "release"),
      version: "9000.0.1",
    }),
    /version/,
  );
});
