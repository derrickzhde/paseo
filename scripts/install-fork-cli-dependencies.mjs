import { mkdir, readFile, realpath, symlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// npm aliases keep incompatible dependency versions intact. Link them only
// within this CLI's bundled packages, without changing the host's npm prefix.
const root = path.dirname(fileURLToPath(import.meta.url));
const links = JSON.parse(await readFile(path.join(root, "fork-cli-dependencies.json"), "utf8"));
for (const { workspace, dependency, alias } of links) {
  const destination = path.join(root, "node_modules", workspace, "node_modules", dependency);
  const target = path.join(root, "node_modules", alias);
  await mkdir(path.dirname(destination), { recursive: true });
  const relativeTarget = path.relative(path.dirname(destination), target);
  try {
    await symlink(process.platform === "win32" ? target : relativeTarget, destination, "junction");
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const [existingTarget, expectedTarget] = await Promise.all([
      realpath(destination),
      realpath(target),
    ]);
    if (existingTarget !== expectedTarget)
      throw new Error(`Unexpected dependency link at ${destination}`, { cause: error });
  }
}
