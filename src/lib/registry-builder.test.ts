import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
	mkdtempSync,
	writeFileSync,
	mkdirSync,
	rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildPayloads, validatePayload, chunkItems } from "./registry-builder.js";
import type { RegistryManifest, ItemPayload } from "../types/index.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "builder-test-"));
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

function writeFile(relativePath: string, content: string) {
	const fullPath = join(tmpDir, relativePath);
	const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
	mkdirSync(dir, { recursive: true });
	writeFileSync(fullPath, content);
}

// ── buildPayloads ────────────────────────────────────────────────

describe("buildPayloads", () => {
	it("reads file content from disk when not inline", () => {
		writeFile("registry/my-comp/my-comp.tsx", "export function MyComp() {}");

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
				},
			],
		};

		const payloads = buildPayloads(manifest, tmpDir);
		expect(payloads).toHaveLength(1);
		expect(payloads[0].files[0].content).toBe(
			"export function MyComp() {}",
		);
	});

	it("uses inline content when present", () => {
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
							content: "inline content",
						},
					],
				},
			],
		};

		const payloads = buildPayloads(manifest, tmpDir);
		expect(payloads[0].files[0].content).toBe("inline content");
	});

	it("throws when file not found", () => {
		const manifest: RegistryManifest = {
			name: "test",
			items: [
				{
					name: "missing",
					type: "registry:component",
					files: [
						{
							path: "registry/missing/missing.tsx",
							type: "registry:component",
						},
					],
				},
			],
		};

		expect(() => buildPayloads(manifest, tmpDir)).toThrow(
			/File not found/,
		);
		expect(() => buildPayloads(manifest, tmpDir)).toThrow(/missing/);
	});

	it("serializes css object to JSON string", () => {
		writeFile("registry/my-comp/my-comp.tsx", "export default {}");

		const manifest: RegistryManifest = {
			name: "test",
			items: [
				{
					name: "my-comp",
					type: "registry:component",
					css: { color: "red" } as unknown as string,
					files: [
						{
							path: "registry/my-comp/my-comp.tsx",
							type: "registry:component",
						},
					],
				},
			],
		};

		const payloads = buildPayloads(manifest, tmpDir);
		expect(payloads[0].css).toBe(JSON.stringify({ color: "red" }));
	});

	it("passes through css string as-is", () => {
		writeFile("registry/my-comp/my-comp.tsx", "export default {}");

		const manifest: RegistryManifest = {
			name: "test",
			items: [
				{
					name: "my-comp",
					type: "registry:component",
					css: ".foo { color: red; }",
					files: [
						{
							path: "registry/my-comp/my-comp.tsx",
							type: "registry:component",
						},
					],
				},
			],
		};

		const payloads = buildPayloads(manifest, tmpDir);
		expect(payloads[0].css).toBe(".foo { color: red; }");
	});

	it("serializes meta object to JSON string", () => {
		writeFile("registry/my-comp/my-comp.tsx", "export default {}");

		const manifest: RegistryManifest = {
			name: "test",
			items: [
				{
					name: "my-comp",
					type: "registry:component",
					meta: { key: "value" } as unknown as string,
					files: [
						{
							path: "registry/my-comp/my-comp.tsx",
							type: "registry:component",
						},
					],
				},
			],
		};

		const payloads = buildPayloads(manifest, tmpDir);
		expect(payloads[0].meta).toBe(JSON.stringify({ key: "value" }));
	});

	it("maps theme field to itemTheme", () => {
		writeFile("registry/my-comp/my-comp.tsx", "export default {}");

		const manifest: RegistryManifest = {
			name: "test",
			items: [
				{
					name: "my-comp",
					type: "registry:component",
					theme: "dark",
					files: [
						{
							path: "registry/my-comp/my-comp.tsx",
							type: "registry:component",
						},
					],
				},
			],
		};

		const payloads = buildPayloads(manifest, tmpDir);
		expect(payloads[0].itemTheme).toBe("dark");
	});
});

// ── validatePayload ──────────────────────────────────────────────

describe("validatePayload", () => {
	it("returns null for valid payload", () => {
		const payload: ItemPayload = {
			name: "my-comp",
			type: "registry:component",
			files: [
				{
					path: "registry/my-comp/my-comp.tsx",
					type: "registry:component",
					content: "export function MyComp() {}",
				},
			],
		};
		expect(validatePayload(payload)).toBeNull();
	});

	it("returns error string for invalid payload", () => {
		const payload = {
			name: "x", // too short
			type: "registry:component",
			files: [],
		} as unknown as ItemPayload;
		const result = validatePayload(payload);
		expect(result).not.toBeNull();
		expect(result).toContain("Validation error");
		expect(result).toContain("x");
	});
});

// ── chunkItems ───────────────────────────────────────────────────

describe("chunkItems", () => {
	it("returns empty array for empty input", () => {
		expect(chunkItems([])).toEqual([]);
	});

	it("puts small items in a single chunk", () => {
		const items: ItemPayload[] = [
			{
				name: "aa",
				type: "registry:component",
				files: [{ path: "a.tsx", type: "registry:component", content: "a" }],
			},
			{
				name: "bb",
				type: "registry:component",
				files: [{ path: "b.tsx", type: "registry:component", content: "b" }],
			},
		];
		const chunks = chunkItems(items);
		expect(chunks).toHaveLength(1);
		expect(chunks[0]).toHaveLength(2);
	});

	it("splits large items into multiple chunks", () => {
		const largeContent = "x".repeat(300 * 1024); // 300KB each
		const items: ItemPayload[] = [
			{
				name: "aa",
				type: "registry:component",
				files: [
					{
						path: "a.tsx",
						type: "registry:component",
						content: largeContent,
					},
				],
			},
			{
				name: "bb",
				type: "registry:component",
				files: [
					{
						path: "b.tsx",
						type: "registry:component",
						content: largeContent,
					},
				],
			},
		];
		const chunks = chunkItems(items);
		expect(chunks.length).toBeGreaterThan(1);
	});

	it("puts single oversized item in its own chunk", () => {
		const hugeContent = "x".repeat(600 * 1024); // 600KB
		const items: ItemPayload[] = [
			{
				name: "huge",
				type: "registry:component",
				files: [
					{
						path: "huge.tsx",
						type: "registry:component",
						content: hugeContent,
					},
				],
			},
		];
		const chunks = chunkItems(items);
		expect(chunks).toHaveLength(1);
		expect(chunks[0]).toHaveLength(1);
	});
});
