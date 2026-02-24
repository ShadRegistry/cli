import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	mkdtempSync,
	mkdirSync,
	existsSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ProjectConfig, RegistryManifest } from "../types/index.js";

vi.mock("../lib/logger.js", () => ({
	log: {
		info: vi.fn(),
		success: vi.fn(),
		error: vi.fn(),
		warn: vi.fn(),
		dim: vi.fn(),
		bold: vi.fn(),
		newline: vi.fn(),
	},
}));

vi.mock("../lib/config.js", () => ({
	readConfig: vi.fn(),
	readManifest: vi.fn(),
	writeManifest: vi.fn(),
}));

import { addCommand } from "./add.js";
import { log } from "../lib/logger.js";
import { readConfig, readManifest, writeManifest } from "../lib/config.js";

let tmpDir: string;
let mockExit: ReturnType<typeof vi.spyOn>;

const validConfig: ProjectConfig = {
	registry: "test",
	sourceDir: "src/registry/new-york/items",
	url: "https://shadregistry.com",
};

/** Reset Commander's internal option state to defaults between tests. */
function resetCommanderOptions(cmd: any) {
	cmd._optionValues = {};
	cmd._optionValueSources = {};
	for (const option of cmd.options) {
		if (option.defaultValue !== undefined) {
			cmd.setOptionValueWithSource(
				option.attributeName(),
				option.defaultValue,
				"default",
			);
		}
	}
}

beforeEach(() => {
	vi.clearAllMocks();
	resetCommanderOptions(addCommand);
	tmpDir = mkdtempSync(join(tmpdir(), "add-test-"));
	vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
	// Throw on process.exit so code stops at exit points
	mockExit = vi
		.spyOn(process, "exit")
		.mockImplementation(((code?: number) => {
			throw new Error(`EXIT_${code}`);
		}) as any);
	vi.mocked(readConfig).mockReturnValue(validConfig);
	vi.mocked(readManifest).mockReturnValue({
		name: "test",
		items: [],
	});
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
	vi.restoreAllMocks();
});

describe("add command", () => {
	describe("validation", () => {
		it("rejects name shorter than 2 characters", async () => {
			await addCommand.parseAsync(["node", "shadregistry", "a"]).catch(() => {});
			expect(mockExit).toHaveBeenCalledWith(1);
			expect(log.error).toHaveBeenCalledWith(
				expect.stringContaining("between 2 and 64"),
			);
		});

		it("rejects name longer than 64 characters", async () => {
			await addCommand
				.parseAsync(["node", "shadregistry", "a".repeat(65)])
				.catch(() => {});
			expect(mockExit).toHaveBeenCalledWith(1);
		});

		it("rejects name with uppercase", async () => {
			await addCommand
				.parseAsync(["node", "shadregistry", "MyButton"])
				.catch(() => {});
			expect(mockExit).toHaveBeenCalledWith(1);
		});

		it("rejects name starting with hyphen", async () => {
			await addCommand
				.parseAsync(["node", "shadregistry", "--", "-button"])
				.catch(() => {});
			expect(mockExit).toHaveBeenCalledWith(1);
		});

		it("rejects name ending with hyphen", async () => {
			await addCommand
				.parseAsync(["node", "shadregistry", "button-"])
				.catch(() => {});
			expect(mockExit).toHaveBeenCalledWith(1);
		});

		it("rejects invalid type", async () => {
			await addCommand
				.parseAsync([
					"node",
					"shadregistry",
					"my-comp",
					"--type",
					"invalid:type",
				])
				.catch(() => {});
			expect(mockExit).toHaveBeenCalledWith(1);
			expect(log.error).toHaveBeenCalledWith(
				expect.stringContaining("Invalid type"),
			);
		});
	});

	describe("missing config/manifest", () => {
		it("exits when no config", async () => {
			vi.mocked(readConfig).mockReturnValue(null);
			await addCommand
				.parseAsync(["node", "shadregistry", "my-comp"])
				.catch(() => {});
			expect(mockExit).toHaveBeenCalledWith(1);
		});

		it("exits when no manifest", async () => {
			vi.mocked(readManifest).mockReturnValue(null);
			await addCommand
				.parseAsync(["node", "shadregistry", "my-comp"])
				.catch(() => {});
			expect(mockExit).toHaveBeenCalledWith(1);
		});

		it("exits for duplicate name", async () => {
			vi.mocked(readManifest).mockReturnValue({
				name: "test",
				items: [
					{
						name: "my-comp",
						type: "registry:component",
						files: [],
					},
				],
			});
			await addCommand
				.parseAsync(["node", "shadregistry", "my-comp"])
				.catch(() => {});
			expect(mockExit).toHaveBeenCalledWith(1);
			expect(log.error).toHaveBeenCalledWith(
				expect.stringContaining("already exists"),
			);
		});
	});

	describe("scaffolding types", () => {
		it("creates .tsx file for registry:component in components/ subdirectory", async () => {
			await addCommand.parseAsync([
				"node",
				"shadregistry",
				"cool-button",
			]);
			expect(mockExit).not.toHaveBeenCalled();
			const filePath = join(
				tmpDir,
				"src/registry/new-york/items",
				"cool-button",
				"components",
				"cool-button.tsx",
			);
			expect(existsSync(filePath)).toBe(true);
			const content = readFileSync(filePath, "utf-8");
			expect(content).toContain("CoolButton");
			expect(content).toContain('@/lib/utils');
			expect(writeManifest).toHaveBeenCalled();
			const manifest = vi.mocked(writeManifest).mock.calls[0][0];
			expect(manifest.items[0].files[0].type).toBe("registry:ui");
		});

		it("creates hook with use- prefix in hooks/ subdirectory", async () => {
			await addCommand.parseAsync([
				"node",
				"shadregistry",
				"toggle",
				"--type",
				"registry:hook",
			]);
			const filePath = join(
				tmpDir,
				"src/registry/new-york/items",
				"toggle",
				"hooks",
				"use-toggle.ts",
			);
			expect(existsSync(filePath)).toBe(true);
			const content = readFileSync(filePath, "utf-8");
			expect(content).toContain("useToggle");
		});

		it("uses existing use- prefix for hook", async () => {
			await addCommand.parseAsync([
				"node",
				"shadregistry",
				"use-toggle",
				"--type",
				"registry:hook",
			]);
			const filePath = join(
				tmpDir,
				"src/registry/new-york/items",
				"use-toggle",
				"hooks",
				"use-toggle.ts",
			);
			expect(existsSync(filePath)).toBe(true);
		});

		it("creates .ts file for registry:lib in lib/ subdirectory", async () => {
			await addCommand.parseAsync([
				"node",
				"shadregistry",
				"my-utils",
				"--type",
				"registry:lib",
			]);
			const filePath = join(
				tmpDir,
				"src/registry/new-york/items",
				"my-utils",
				"lib",
				"my-utils.ts",
			);
			expect(existsSync(filePath)).toBe(true);
		});

		it("creates .tsx for registry:block in components/ subdirectory", async () => {
			await addCommand.parseAsync([
				"node",
				"shadregistry",
				"my-block",
				"--type",
				"registry:block",
			]);
			const filePath = join(
				tmpDir,
				"src/registry/new-york/items",
				"my-block",
				"components",
				"my-block.tsx",
			);
			expect(existsSync(filePath)).toBe(true);
			const manifest = vi.mocked(writeManifest).mock.calls[0][0];
			expect(manifest.items[0].files[0].type).toBe("registry:component");
		});

		it("creates page.tsx for registry:page", async () => {
			await addCommand.parseAsync([
				"node",
				"shadregistry",
				"my-page",
				"--type",
				"registry:page",
			]);
			const filePath = join(
				tmpDir,
				"src/registry/new-york/items",
				"my-page",
				"page.tsx",
			);
			expect(existsSync(filePath)).toBe(true);
			const manifest = vi.mocked(writeManifest).mock.calls[0][0];
			expect(manifest.items[0].files[0].target).toBe("");
		});

		it("creates .ts for registry:file", async () => {
			await addCommand.parseAsync([
				"node",
				"shadregistry",
				"my-file",
				"--type",
				"registry:file",
			]);
			const filePath = join(
				tmpDir,
				"src/registry/new-york/items",
				"my-file",
				"my-file.ts",
			);
			expect(existsSync(filePath)).toBe(true);
		});

		it("creates no files for registry:style", async () => {
			await addCommand.parseAsync([
				"node",
				"shadregistry",
				"my-style",
				"--type",
				"registry:style",
			]);
			expect(writeManifest).toHaveBeenCalled();
			const manifest = vi.mocked(writeManifest).mock.calls[0][0];
			expect(manifest.items[0].files).toHaveLength(0);
		});
	});

	describe("dependency flags", () => {
		it("parses --dependencies flag", async () => {
			await addCommand.parseAsync([
				"node",
				"shadregistry",
				"my-comp",
				"--dependencies",
				"zod,lodash",
			]);
			const manifest = vi.mocked(writeManifest).mock.calls[0][0];
			expect(manifest.items[0].dependencies).toEqual(["zod", "lodash"]);
		});

		it("parses --registry-dependencies flag", async () => {
			await addCommand.parseAsync([
				"node",
				"shadregistry",
				"my-comp",
				"--registry-dependencies",
				"button,input",
			]);
			const manifest = vi.mocked(writeManifest).mock.calls[0][0];
			expect(manifest.items[0].registryDependencies).toEqual([
				"button",
				"input",
			]);
		});

		it("parses --dev-dependencies flag", async () => {
			await addCommand.parseAsync([
				"node",
				"shadregistry",
				"my-comp",
				"--dev-dependencies",
				"@types/react",
			]);
			const manifest = vi.mocked(writeManifest).mock.calls[0][0];
			expect(manifest.items[0].devDependencies).toEqual(["@types/react"]);
		});

		it("omits dependency fields when not provided", async () => {
			await addCommand.parseAsync([
				"node",
				"shadregistry",
				"my-comp",
			]);
			const manifest = vi.mocked(writeManifest).mock.calls[0][0];
			expect(manifest.items[0].dependencies).toBeUndefined();
			expect(manifest.items[0].devDependencies).toBeUndefined();
			expect(manifest.items[0].registryDependencies).toBeUndefined();
		});
	});

});
