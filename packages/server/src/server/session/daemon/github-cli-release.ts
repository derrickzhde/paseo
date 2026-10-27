import { createHash } from "node:crypto";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { valid } from "semver";
import { z } from "zod";

const RELEASES_URL = "https://api.github.com/repos/derrickzhde/paseo/releases/latest";
const DOWNLOADS_URL = "https://github.com/derrickzhde/paseo/releases/download";
const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;

const ReleaseSchema = z.object({
  tag_name: z.string().regex(/^v\d+\.\d+\.\d+$/),
  draft: z.literal(false),
  prerelease: z.literal(false),
  assets: z.array(
    z.object({
      name: z.string(),
      size: z.number().int().positive(),
      digest: z.string().nullable().optional(),
    }),
  ),
});

export interface ForkCliArchive {
  path: string;
  version: string;
}

export async function withLatestForkCliArchive<T>(
  install: (archive: ForkCliArchive) => Promise<T>,
  fetchRelease: typeof fetch = fetch,
): Promise<T> {
  const metadata = await fetchRelease(RELEASES_URL, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "paseo-self-update" },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!metadata.ok) throw new Error(`Unable to read fork release (HTTP ${metadata.status}).`);
  const release = ReleaseSchema.parse(await metadata.json());
  const version = valid(release.tag_name.slice(1));
  if (!version) throw new Error("The fork release has an invalid version.");
  const name = `paseo-cli-${version}.tgz`;
  const assets = release.assets.filter((asset) => asset.name === name);
  const asset = assets.length === 1 ? assets[0] : undefined;
  if (!asset) {
    throw new Error(
      `Fork release ${release.tag_name} does not contain ${name}. Publish a release with the CLI archive before updating this host.`,
    );
  }
  if (asset.size > MAX_ARCHIVE_BYTES || !asset.digest?.match(/^sha256:[a-f0-9]{64}$/i)) {
    throw new Error(`Fork CLI archive ${name} has no valid size or SHA256 digest.`);
  }

  const directory = await mkdtemp(path.join(tmpdir(), "paseo-fork-update-"));
  const archivePath = path.join(directory, name);
  try {
    const response = await fetchRelease(`${DOWNLOADS_URL}/${release.tag_name}/${name}`, {
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok || !response.body) {
      throw new Error(`Unable to download fork CLI archive (HTTP ${response.status}).`);
    }
    const reader = response.body.getReader();
    const file = await open(archivePath, "wx");
    const hash = createHash("sha256");
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > asset.size) throw new Error("Fork CLI archive exceeds its published size.");
        hash.update(value);
        await file.writeFile(value);
      }
    } finally {
      await file.close();
      await reader.cancel();
    }
    if (bytes !== asset.size || `sha256:${hash.digest("hex")}` !== asset.digest.toLowerCase()) {
      throw new Error("Fork CLI archive size or SHA256 verification failed.");
    }
    return await install({ path: archivePath, version });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
