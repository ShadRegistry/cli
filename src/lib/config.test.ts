import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	readConfig,
	writeConfig,
	readManifest,
	writeManifest,
	configExists,
	manifestExists,
} from "./config.js";
import type { ProjectConfig, RegistryManifest } from "../types/index.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "config-test-"));
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

// ── readConfig ───────────────────────────────────────────────────

describe("readConfig", () => {
	it("returns parsed config when file exists", () => {
		const config: ProjectConfig = {
			registry: "my-reg",
			sourceDir: "registry",
			url: "https://shadregistry.com",
		};
		writeFileSync(
			join(tmpDir, "shadregistry.config.json"),
			JSON.stringify(config),
		);
		expect(readConfig(tmpDir)).toEqual(config);
	});

	it("returns null when file does not exist", () => {
		expect(readConfig(tmpDir)).toBeNull();
	});

	it("returns null for invalid JSON", () => {
		writeFileSync(
			join(tmpDir, "shadregistry.config.json"),
			"not valid json{{{",
		);
		expect(readConfig(tmpDir)).toBeNull();
	});
});

// ── writeConfig ──────────────────────────────────────────────────

describe("writeConfig", () => {
	it("writes formatted JSON with trailing newline", () => {
		const config: ProjectConfig = {
			registry: "my-reg",
			sourceDir: "registry",
			url: "https://shadregistry.com",
		};
		writeConfig(config, tmpDir);
		const raw = readFileSync(
			join(tmpDir, "shadregistry.config.json"),
			"utf-8",
		);
		expect(raw).toBe(JSON.stringify(config, null, 2) + "\n");
		expect(raw.endsWith("\n")).toBe(true);
	});
});

// ── readManifest ─────────────────────────────────────────────────

describe("readManifest", () => {
	it("returns parsed manifest when file exists", () => {
		const manifest: RegistryManifest = {
			name: "test",
			items: [],
		};
		writeFileSync(
			join(tmpDir, "registry.json"),
			JSON.stringify(manifest),
		);
		expect(readManifest(tmpDir)).toEqual(manifest);
	});

	it("returns null when file does not exist", () => {
		expect(readManifest(tmpDir)).toBeNull();
	});

	it("returns null for invalid JSON", () => {
		writeFileSync(join(tmpDir, "registry.json"), "broken");
		expect(readManifest(tmpDir)).toBeNull();
	});
});

// ── writeManifest ────────────────────────────────────────────────

describe("writeManifest", () => {
	it("writes formatted JSON with trailing newline", () => {
		const manifest: RegistryManifest = {
			name: "test",
			items: [
				{
					name: "my-comp",
					type: "registry:component",
					files: [],
				},
			],
		};
		writeManifest(manifest, tmpDir);
		const raw = readFileSync(join(tmpDir, "registry.json"), "utf-8");
		expect(raw).toBe(JSON.stringify(manifest, null, 2) + "\n");
	});
});

// ── configExists / manifestExists ────────────────────────────────

describe("configExists", () => {
	it("returns true when config file present", () => {
		writeFileSync(join(tmpDir, "shadregistry.config.json"), "{}");
		expect(configExists(tmpDir)).toBe(true);
	});

	it("returns false when config file absent", () => {
		expect(configExists(tmpDir)).toBe(false);
	});
});

describe("manifestExists", () => {
	it("returns true when manifest file present", () => {
		writeFileSync(join(tmpDir, "registry.json"), "{}");
		expect(manifestExists(tmpDir)).toBe(true);
	});

	it("returns false when manifest file absent", () => {
		expect(manifestExists(tmpDir)).toBe(false);
	});
});

// ── Round-trip ───────────────────────────────────────────────────

describe("round-trip", () => {
	it("write then read config returns same data", () => {
		const config: ProjectConfig = {
			registry: "my-reg",
			sourceDir: "src/registry",
			url: "https://shadregistry.com",
		};
		writeConfig(config, tmpDir);
		expect(readConfig(tmpDir)).toEqual(config);
	});

	it("write then read manifest returns same data", () => {
		const manifest: RegistryManifest = {
			name: "test",
			items: [
				{
					name: "my-comp",
					type: "registry:component",
					files: [
						{
							path: "registry/my-comp/my-comp.tsx",
							type: "registry:component",
						},
					],
					dependencies: ["clsx"],
				},
			],
		};
		writeManifest(manifest, tmpDir);
		expect(readManifest(tmpDir)).toEqual(manifest);
	});
});
