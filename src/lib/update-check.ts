import {
	readFileSync,
	writeFileSync,
	mkdirSync,
	existsSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import pc from "picocolors";
import { AUTH_DIR } from "./constants.js";
import { getVersion } from "./version.js";

const UPDATE_CHECK_FILE = "update-check.json";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const NPM_REGISTRY_URL =
	"https://registry.npmjs.org/@shadregistry/cli/latest";
const FETCH_TIMEOUT_MS = 5000; // 5 second timeout

interface UpdateCheckCache {
	lastChecked: number;
	latestVersion: string;
}

function getCachePath(): string {
	return join(homedir(), AUTH_DIR, UPDATE_CHECK_FILE);
}

function getCacheDir(): string {
	return join(homedir(), AUTH_DIR);
}

function readCache(): UpdateCheckCache | null {
	const cachePath = getCachePath();
	if (!existsSync(cachePath)) return null;
	try {
		const content = readFileSync(cachePath, "utf-8");
		return JSON.parse(content) as UpdateCheckCache;
	} catch {
		return null;
	}
}

function writeCache(cache: UpdateCheckCache): void {
	const dir = getCacheDir();
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true, mode: 0o700 });
	}
	writeFileSync(getCachePath(), JSON.stringify(cache, null, 2), {
		mode: 0o600,
	});
}

/**
 * Compare two semver strings (MAJOR.MINOR.PATCH).
 * Returns -1 if a < b, 0 if equal, 1 if a > b.
 */
export function compareSemver(a: string, b: string): number {
	const pa = a.split(".").map(Number);
	const pb = b.split(".").map(Number);
	for (let i = 0; i < 3; i++) {
		const va = pa[i] ?? 0;
		const vb = pb[i] ?? 0;
		if (va < vb) return -1;
		if (va > vb) return 1;
	}
	return 0;
}

/**
 * Fetch latest version from npm registry.
 * Uses AbortController for timeout. Returns null on any failure.
 */
async function fetchLatestVersion(): Promise<string | null> {
	try {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
		const res = await fetch(NPM_REGISTRY_URL, {
			signal: controller.signal,
		});
		clearTimeout(timeout);
		if (!res.ok) return null;
		const data = (await res.json()) as { version?: string };
		return data.version ?? null;
	} catch {
		return null;
	}
}

/**
 * Check for updates non-blockingly. Returns the latest version string
 * if a newer version is available, or null otherwise.
 * Respects the 24-hour cache interval.
 */
export async function checkForUpdate(): Promise<string | null> {
	try {
		// Skip in CI environments
		if (process.env.CI || process.env.SHADREGISTRY_NO_UPDATE_CHECK) {
			return null;
		}

		const cache = readCache();
		const now = Date.now();

		// If we checked recently, use cached result
		if (cache && now - cache.lastChecked < CHECK_INTERVAL_MS) {
			const current = getVersion();
			if (compareSemver(current, cache.latestVersion) < 0) {
				return cache.latestVersion;
			}
			return null;
		}

		// Fetch from npm
		const latestVersion = await fetchLatestVersion();
		if (!latestVersion) return null;

		// Update cache
		writeCache({ lastChecked: now, latestVersion });

		const current = getVersion();
		if (compareSemver(current, latestVersion) < 0) {
			return latestVersion;
		}
		return null;
	} catch {
		// Never let update check errors bubble up
		return null;
	}
}

/**
 * Print the update notification box to stderr so it doesn't
 * interfere with --json output on stdout.
 */
export function printUpdateNotification(latestVersion: string): void {
	const current = getVersion();
	const msg = `Update available: ${pc.dim(current)} → ${pc.green(latestVersion)}`;
	const cmd = `Run ${pc.cyan("shadregistry update")} to update`;

	console.error("");
	console.error(
		pc.yellow("┏") + pc.yellow("━".repeat(50)) + pc.yellow("┓"),
	);
	console.error(`${pc.yellow("┃")}  ${msg}  ${pc.yellow("┃")}`);
	console.error(`${pc.yellow("┃")}  ${cmd}  ${pc.yellow("┃")}`);
	console.error(
		pc.yellow("┗") + pc.yellow("━".repeat(50)) + pc.yellow("┛"),
	);
	console.error("");
}
