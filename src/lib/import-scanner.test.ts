import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	scanFileImports,
	categorizeImports,
	scanRegistryItems,
	findDepChanges,
} from "./import-scanner.js";
import type { RegistryManifest, ProjectConfig } from "../types/index.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "scanner-test-"));
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

function writeFile(relativePath: string, content: string): string {
	const fullPath = join(tmpDir, relativePath);
	const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
	mkdirSync(dir, { recursive: true });
	writeFileSync(fullPath, content);
	return fullPath;
}

// ── scanFileImports ──────────────────────────────────────────────

describe("scanFileImports", () => {
	it("extracts ES6 named import", () => {
		const fp = writeFile("test.ts", `import { cn } from "clsx";`);
		expect(scanFileImports(fp)).toEqual(["clsx"]);
	});

	it("extracts default import", () => {
		const fp = writeFile("test.ts", `import React from "react";`);
		expect(scanFileImports(fp)).toEqual(["react"]);
	});

	it("extracts namespace import", () => {
		const fp = writeFile("test.ts", `import * as path from "node:path";`);
		expect(scanFileImports(fp)).toEqual(["node:path"]);
	});

	it("extracts side-effect import", () => {
		const fp = writeFile("test.ts", `import "tailwindcss/base";`);
		expect(scanFileImports(fp)).toEqual(["tailwindcss/base"]);
	});

	it("extracts re-export", () => {
		const fp = writeFile("test.ts", `export { Button } from "./button";`);
		expect(scanFileImports(fp)).toEqual(["./button"]);
	});

	it("extracts type import", () => {
		const fp = writeFile("test.ts", `import type { FC } from "react";`);
		expect(scanFileImports(fp)).toEqual(["react"]);
	});

	it("extracts require()", () => {
		const fp = writeFile("test.ts", `const x = require("lodash");`);
		expect(scanFileImports(fp)).toEqual(["lodash"]);
	});

	it("extracts multiple imports and deduplicates", () => {
		const fp = writeFile(
			"test.ts",
			[
				`import { cn } from "clsx";`,
				`import { useState } from "react";`,
				`import { cn as cn2 } from "clsx";`,
				`import type { FC } from "react";`,
			].join("\n"),
		);
		const result = scanFileImports(fp);
		expect(result).toEqual(["clsx", "react"]);
	});

	it("extracts relative imports", () => {
		const fp = writeFile(
			"test.ts",
			`import { helper } from "../utils/cn";`,
		);
		expect(scanFileImports(fp)).toEqual(["../utils/cn"]);
	});

	it("returns empty for non-existent file", () => {
		expect(scanFileImports("/nonexistent/path.ts")).toEqual([]);
	});

	it("returns empty for empty file", () => {
		const fp = writeFile("test.ts", "");
		expect(scanFileImports(fp)).toEqual([]);
	});

	it("returns empty for file with no imports", () => {
		const fp = writeFile(
			"test.ts",
			`const x = 1;\nexport default x;\n`,
		);
		expect(scanFileImports(fp)).toEqual([]);
	});
});

// ── categorizeImports ────────────────────────────────────────────

describe("categorizeImports", () => {
	const cwd = "/fake/project";
	const sourceDir = "registry";
	const currentItem = "my-comp";

	it("categorizes npm dependency", () => {
		const result = categorizeImports(
			["clsx"],
			new Set(["my-comp"]),
			currentItem,
			"registry/my-comp/my-comp.tsx",
			sourceDir,
			cwd,
		);
		expect(result.dependencies).toEqual(["clsx"]);
		expect(result.registryDependencies).toEqual([]);
	});

	it("extracts scoped npm package name", () => {
		const result = categorizeImports(
			["@radix-ui/react-accordion"],
			new Set(["my-comp"]),
			currentItem,
			"registry/my-comp/my-comp.tsx",
			sourceDir,
			cwd,
		);
		expect(result.dependencies).toEqual(["@radix-ui/react-accordion"]);
	});

	it("extracts scoped package from subpath import", () => {
		const result = categorizeImports(
			["@radix-ui/react-accordion/sub/path"],
			new Set(["my-comp"]),
			currentItem,
			"registry/my-comp/my-comp.tsx",
			sourceDir,
			cwd,
		);
		expect(result.dependencies).toEqual(["@radix-ui/react-accordion"]);
	});

	it("skips react, react-dom, and jsx-runtime", () => {
		const result = categorizeImports(
			["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
			new Set(["my-comp"]),
			currentItem,
			"registry/my-comp/my-comp.tsx",
			sourceDir,
			cwd,
		);
		expect(result.dependencies).toEqual([]);
		expect(result.registryDependencies).toEqual([]);
	});

	it("skips Node builtins", () => {
		const result = categorizeImports(
			["node:fs", "path", "crypto"],
			new Set(["my-comp"]),
			currentItem,
			"registry/my-comp/my-comp.tsx",
			sourceDir,
			cwd,
		);
		expect(result.dependencies).toEqual([]);
		expect(result.registryDependencies).toEqual([]);
	});

	it("skips next", () => {
		const result = categorizeImports(
			["next", "next/image"],
			new Set(["my-comp"]),
			currentItem,
			"registry/my-comp/my-comp.tsx",
			sourceDir,
			cwd,
		);
		expect(result.dependencies).toEqual([]);
		expect(result.registryDependencies).toEqual([]);
	});

	it("detects cross-item relative import as registryDependency", () => {
		// File is at registry/my-comp/my-comp.tsx
		// Import is ../button/button → resolves to registry/button/button
		// "button" is in itemNames
		const result = categorizeImports(
			["../button/button"],
			new Set(["my-comp", "button"]),
			currentItem,
			"registry/my-comp/my-comp.tsx",
			sourceDir,
			cwd,
		);
		expect(result.registryDependencies).toEqual(["button"]);
		expect(result.dependencies).toEqual([]);
	});

	it("skips relative imports within same item", () => {
		const result = categorizeImports(
			["./helpers"],
			new Set(["my-comp"]),
			currentItem,
			"registry/my-comp/my-comp.tsx",
			sourceDir,
			cwd,
		);
		expect(result.dependencies).toEqual([]);
		expect(result.registryDependencies).toEqual([]);
	});

	it("excludes self-reference from registryDependencies", () => {
		// A relative import that resolves to the same item
		const result = categorizeImports(
			["../my-comp/helpers"],
			new Set(["my-comp"]),
			currentItem,
			"registry/my-comp/my-comp.tsx",
			sourceDir,
			cwd,
		);
		expect(result.registryDependencies).toEqual([]);
	});

	it("categorizes mixed imports correctly", () => {
		const result = categorizeImports(
			[
				"clsx",
				"react",
				"node:path",
				"@radix-ui/react-accordion",
				"../button/button",
				"./helpers",
				"zod",
			],
			new Set(["my-comp", "button"]),
			currentItem,
			"registry/my-comp/my-comp.tsx",
			sourceDir,
			cwd,
		);
		expect(result.dependencies).toEqual([
			"@radix-ui/react-accordion",
			"clsx",
			"zod",
		]);
		expect(result.registryDependencies).toEqual(["button"]);
	});

	it("sorts results alphabetically", () => {
		const result = categorizeImports(
			["zod", "clsx", "axios"],
			new Set(["my-comp"]),
			currentItem,
			"registry/my-comp/my-comp.tsx",
			sourceDir,
			cwd,
		);
		expect(result.dependencies).toEqual(["axios", "clsx", "zod"]);
	});
});

// ── findDepChanges ───────────────────────────────────────────────

describe("findDepChanges", () => {
	it("returns empty map when no changes", () => {
		const manifest: RegistryManifest = {
			name: "test",
			items: [
				{
					name: "my-comp",
					type: "registry:component",
					files: [],
					dependencies: ["clsx"],
					registryDependencies: ["button"],
				},
			],
		};
		const detected = new Map([
			[
				"my-comp",
				{
					dependencies: ["clsx"],
					registryDependencies: ["button"],
				},
			],
		]);
		expect(findDepChanges(manifest, detected).size).toBe(0);
	});

	it("detects new dependency", () => {
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
		const detected = new Map([
			[
				"my-comp",
				{
					dependencies: ["clsx"],
					registryDependencies: [],
				},
			],
		]);
		const changes = findDepChanges(manifest, detected);
		expect(changes.size).toBe(1);
		expect(changes.get("my-comp")!.detected.dependencies).toEqual(["clsx"]);
	});

	it("detects removed dependency", () => {
		const manifest: RegistryManifest = {
			name: "test",
			items: [
				{
					name: "my-comp",
					type: "registry:component",
					files: [],
					dependencies: ["clsx"],
				},
			],
		};
		const detected = new Map([
			[
				"my-comp",
				{
					dependencies: [],
					registryDependencies: [],
				},
			],
		]);
		const changes = findDepChanges(manifest, detected);
		expect(changes.size).toBe(1);
		expect(changes.get("my-comp")!.current.dependencies).toEqual(["clsx"]);
		expect(changes.get("my-comp")!.detected.dependencies).toEqual([]);
	});

	it("treats undefined deps as empty array", () => {
		const manifest: RegistryManifest = {
			name: "test",
			items: [
				{
					name: "my-comp",
					type: "registry:component",
					files: [],
					// no dependencies or registryDependencies
				},
			],
		};
		const detected = new Map([
			[
				"my-comp",
				{
					dependencies: [],
					registryDependencies: [],
				},
			],
		]);
		expect(findDepChanges(manifest, detected).size).toBe(0);
	});

	it("returns only changed items from multiple", () => {
		const manifest: RegistryManifest = {
			name: "test",
			items: [
				{
					name: "comp-a",
					type: "registry:component",
					files: [],
					dependencies: ["clsx"],
				},
				{
					name: "comp-b",
					type: "registry:component",
					files: [],
				},
			],
		};
		const detected = new Map([
			["comp-a", { dependencies: ["clsx"], registryDependencies: [] }],
			["comp-b", { dependencies: ["zod"], registryDependencies: [] }],
		]);
		const changes = findDepChanges(manifest, detected);
		expect(changes.size).toBe(1);
		expect(changes.has("comp-b")).toBe(true);
	});
});

// ── scanRegistryItems (integration) ──────────────────────────────

describe("scanRegistryItems", () => {
	it("scans single item with npm deps", () => {
		writeFile(
			"registry/my-comp/my-comp.tsx",
			[
				`import { cn } from "clsx";`,
				`import { useState } from "react";`,
				`export function MyComp() { return <div className={cn("foo")} />; }`,
			].join("\n"),
		);

		const config: ProjectConfig = {
			registry: "test",
			sourceDir: "registry",
			url: "https://shadregistry.com",
		};
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

		const results = scanRegistryItems(tmpDir, config, manifest);
		expect(results.get("my-comp")).toEqual({
			dependencies: ["clsx"],
			registryDependencies: [],
		});
	});

	it("detects cross-item registry dependencies", () => {
		writeFile(
			"registry/my-comp/my-comp.tsx",
			`import { Button } from "../button/button";`,
		);
		writeFile(
			"registry/button/button.tsx",
			`export function Button() { return <button />; }`,
		);

		const config: ProjectConfig = {
			registry: "test",
			sourceDir: "registry",
			url: "https://shadregistry.com",
		};
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
				{
					name: "button",
					type: "registry:component",
					files: [
						{
							path: "registry/button/button.tsx",
							type: "registry:component",
						},
					],
				},
			],
		};

		const results = scanRegistryItems(tmpDir, config, manifest);
		expect(results.get("my-comp")!.registryDependencies).toEqual(["button"]);
		expect(results.get("button")!.registryDependencies).toEqual([]);
	});

	it("returns empty arrays for item with no imports", () => {
		writeFile(
			"registry/my-comp/my-comp.tsx",
			`export function MyComp() { return <div />; }`,
		);

		const config: ProjectConfig = {
			registry: "test",
			sourceDir: "registry",
			url: "https://shadregistry.com",
		};
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

		const results = scanRegistryItems(tmpDir, config, manifest);
		expect(results.get("my-comp")).toEqual({
			dependencies: [],
			registryDependencies: [],
		});
	});
});
