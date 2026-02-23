import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
	mkdtempSync,
	writeFileSync,
	mkdirSync,
	rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validateImports } from "./import-validator.js";
import type { RegistryManifest, ProjectConfig } from "../types/index.js";

let tmpDir: string;

const config: ProjectConfig = {
	registry: "test",
	sourceDir: "src/registry/new-york/items",
	url: "https://shadregistry.com",
};

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "import-validator-test-"));
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

describe("validateImports", () => {
	it("returns no warnings for @/ alias imports", () => {
		writeFile(
			"src/registry/new-york/items/my-comp/components/my-comp.tsx",
			`import { cn } from "@/lib/utils";\nimport { Button } from "@/components/ui/button";\nexport function MyComp() {}`,
		);

		const manifest: RegistryManifest = {
			name: "test",
			items: [
				{
					name: "my-comp",
					type: "registry:component",
					files: [
						{
							path: "src/registry/new-york/items/my-comp/components/my-comp.tsx",
							type: "registry:ui",
						},
					],
				},
			],
		};

		const warnings = validateImports(manifest, config, tmpDir);
		expect(warnings).toHaveLength(0);
	});

	it("flags cross-item relative imports as errors", () => {
		writeFile(
			"src/registry/new-york/items/my-comp/components/my-comp.tsx",
			`import { Button } from "../../button/components/button";\nexport function MyComp() {}`,
		);

		const manifest: RegistryManifest = {
			name: "test",
			items: [
				{
					name: "my-comp",
					type: "registry:component",
					files: [
						{
							path: "src/registry/new-york/items/my-comp/components/my-comp.tsx",
							type: "registry:ui",
						},
					],
				},
				{
					name: "button",
					type: "registry:component",
					files: [
						{
							path: "src/registry/new-york/items/button/components/button.tsx",
							type: "registry:ui",
						},
					],
				},
			],
		};

		const warnings = validateImports(manifest, config, tmpDir);
		expect(warnings).toHaveLength(1);
		expect(warnings[0].severity).toBe("error");
		expect(warnings[0].itemName).toBe("my-comp");
		expect(warnings[0].message).toContain("button");
	});

	it("flags relative imports escaping source dir as warnings", () => {
		writeFile(
			"src/registry/new-york/items/my-comp/components/my-comp.tsx",
			`import { helper } from "../../../../utils/helper";\nexport function MyComp() {}`,
		);

		const manifest: RegistryManifest = {
			name: "test",
			items: [
				{
					name: "my-comp",
					type: "registry:component",
					files: [
						{
							path: "src/registry/new-york/items/my-comp/components/my-comp.tsx",
							type: "registry:ui",
						},
					],
				},
			],
		};

		const warnings = validateImports(manifest, config, tmpDir);
		expect(warnings).toHaveLength(1);
		expect(warnings[0].severity).toBe("warning");
		expect(warnings[0].message).toContain("outside the registry source directory");
	});

	it("allows relative imports within the same item", () => {
		writeFile(
			"src/registry/new-york/items/my-comp/components/my-comp.tsx",
			`import { helper } from "../lib/helper";\nexport function MyComp() {}`,
		);

		const manifest: RegistryManifest = {
			name: "test",
			items: [
				{
					name: "my-comp",
					type: "registry:component",
					files: [
						{
							path: "src/registry/new-york/items/my-comp/components/my-comp.tsx",
							type: "registry:ui",
						},
					],
				},
			],
		};

		const warnings = validateImports(manifest, config, tmpDir);
		expect(warnings).toHaveLength(0);
	});

	it("ignores non-relative imports", () => {
		writeFile(
			"src/registry/new-york/items/my-comp/components/my-comp.tsx",
			`import { clsx } from "clsx";\nimport React from "react";\nexport function MyComp() {}`,
		);

		const manifest: RegistryManifest = {
			name: "test",
			items: [
				{
					name: "my-comp",
					type: "registry:component",
					files: [
						{
							path: "src/registry/new-york/items/my-comp/components/my-comp.tsx",
							type: "registry:ui",
						},
					],
				},
			],
		};

		const warnings = validateImports(manifest, config, tmpDir);
		expect(warnings).toHaveLength(0);
	});
});
