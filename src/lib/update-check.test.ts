import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	mkdtempSync,
	mkdirSync,
	writeFileSync,
	rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let tmpDir: string;

vi.mock("node:os", async () => {
	const actual = await vi.importActual<typeof import("node:os")>("node:os");
	return {
		...actual,
		homedir: () => tmpDir,
	};
});

vi.mock("./version.js", () => ({
	getVersion: () => "0.1.2",
}));

import {
	compareSemver,
	checkForUpdate,
} from "./update-check.js";

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "update-check-test-"));
	vi.stubGlobal("fetch", vi.fn());
	// Clear CI env vars
	delete process.env.CI;
	delete process.env.SHADREGISTRY_NO_UPDATE_CHECK;
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("compareSemver", () => {
	it("returns -1 when a < b", () => {
		expect(compareSemver("0.1.0", "0.1.2")).toBe(-1);
		expect(compareSemver("0.1.2", "1.0.0")).toBe(-1);
		expect(compareSemver("1.0.0", "1.0.1")).toBe(-1);
	});

	it("returns 0 when equal", () => {
		expect(compareSemver("1.2.3", "1.2.3")).toBe(0);
		expect(compareSemver("0.0.0", "0.0.0")).toBe(0);
	});

	it("returns 1 when a > b", () => {
		expect(compareSemver("0.2.0", "0.1.9")).toBe(1);
		expect(compareSemver("1.0.0", "0.9.9")).toBe(1);
		expect(compareSemver("0.1.3", "0.1.2")).toBe(1);
	});
});

describe("checkForUpdate", () => {
	it("returns latest version when newer is available", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({ version: "0.2.0" }),
			}),
		);

		const result = await checkForUpdate();
		expect(result).toBe("0.2.0");
	});

	it("returns null when already up to date", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({ version: "0.1.2" }),
			}),
		);

		const result = await checkForUpdate();
		expect(result).toBeNull();
	});

	it("returns null when current is newer than npm", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({ version: "0.1.0" }),
			}),
		);

		const result = await checkForUpdate();
		expect(result).toBeNull();
	});

	it("returns null on network failure", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockRejectedValue(new Error("network error")),
		);
		const result = await checkForUpdate();
		expect(result).toBeNull();
	});

	it("returns null on non-ok response", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: false,
			}),
		);
		const result = await checkForUpdate();
		expect(result).toBeNull();
	});

	it("uses cache within 24h interval", async () => {
		// Write a recent cache
		const cacheDir = join(tmpDir, ".shadregistry");
		mkdirSync(cacheDir, { recursive: true });
		writeFileSync(
			join(cacheDir, "update-check.json"),
			JSON.stringify({
				lastChecked: Date.now(),
				latestVersion: "0.3.0",
			}),
		);

		const mockFetch = vi.fn();
		vi.stubGlobal("fetch", mockFetch);

		const result = await checkForUpdate();
		expect(result).toBe("0.3.0");
		expect(mockFetch).not.toHaveBeenCalled();
	});

	it("fetches when cache is stale", async () => {
		// Write an old cache (25 hours ago)
		const cacheDir = join(tmpDir, ".shadregistry");
		mkdirSync(cacheDir, { recursive: true });
		writeFileSync(
			join(cacheDir, "update-check.json"),
			JSON.stringify({
				lastChecked: Date.now() - 25 * 60 * 60 * 1000,
				latestVersion: "0.1.2",
			}),
		);

		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({ version: "0.2.0" }),
			}),
		);

		const result = await checkForUpdate();
		expect(result).toBe("0.2.0");
	});

	it("returns null when CI env is set", async () => {
		process.env.CI = "true";
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({ version: "0.2.0" }),
			}),
		);

		const result = await checkForUpdate();
		expect(result).toBeNull();
	});

	it("returns null when SHADREGISTRY_NO_UPDATE_CHECK is set", async () => {
		process.env.SHADREGISTRY_NO_UPDATE_CHECK = "1";
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({ version: "0.2.0" }),
			}),
		);

		const result = await checkForUpdate();
		expect(result).toBeNull();
	});
});
