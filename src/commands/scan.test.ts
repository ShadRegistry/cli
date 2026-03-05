import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RegistryManifest, ProjectConfig } from "../types/index.js";

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

vi.mock("../lib/import-scanner.js", () => ({
	scanRegistryItems: vi.fn(),
	findDepChanges: vi.fn(),
}));

vi.mock("../lib/import-validator.js", () => ({
	validateImports: vi.fn(),
}));

// Module-level variable to control readline answer
let readlineAnswer = "y";

vi.mock("node:readline", () => ({
	createInterface: vi.fn(() => ({
		question: vi.fn((_q: string, cb: (answer: string) => void) =>
			cb(readlineAnswer),
		),
		close: vi.fn(),
	})),
}));

import { scanCommand } from "./scan.js";
import { log } from "../lib/logger.js";
import { readConfig, readManifest, writeManifest } from "../lib/config.js";
import { scanRegistryItems, findDepChanges } from "../lib/import-scanner.js";
import { validateImports } from "../lib/import-validator.js";

let mockExit: ReturnType<typeof vi.spyOn>;

const config: ProjectConfig = {
	registry: "test",
	sourceDir: "registry/new-york/blocks",
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
	readlineAnswer = "y"; // reset default
	resetCommanderOptions(scanCommand);
	mockExit = vi
		.spyOn(process, "exit")
		.mockImplementation(((code?: number) => {
			throw new Error(`EXIT_${code}`);
		}) as any);
	vi.mocked(readConfig).mockReturnValue(config);
	vi.mocked(readManifest).mockReturnValue(
		JSON.parse(JSON.stringify(manifest)),
	);
	vi.mocked(scanRegistryItems).mockReturnValue(new Map());
	vi.mocked(findDepChanges).mockReturnValue(new Map());
	vi.mocked(validateImports).mockReturnValue([]);
});

describe("scan command", () => {
	it("exits with error when no config", async () => {
		vi.mocked(readConfig).mockReturnValue(null);
		await scanCommand.parseAsync(["node", "shadregistry"]).catch(() => {});
		expect(mockExit).toHaveBeenCalledWith(1);
		expect(log.error).toHaveBeenCalledWith(
			expect.stringContaining("No shadregistry.config.json"),
		);
	});

	it("exits with 0 when empty manifest", async () => {
		vi.mocked(readManifest).mockReturnValue({ name: "test", items: [] });
		await scanCommand.parseAsync(["node", "shadregistry"]).catch(() => {});
		expect(mockExit).toHaveBeenCalledWith(0);
		expect(log.warn).toHaveBeenCalled();
	});

	it("logs success when no changes detected", async () => {
		vi.mocked(findDepChanges).mockReturnValue(new Map());
		await scanCommand.parseAsync(["node", "shadregistry"]);
		expect(log.success).toHaveBeenCalledWith(
			expect.stringContaining("up to date"),
		);
		expect(writeManifest).not.toHaveBeenCalled();
	});

	it("writes manifest with --yes flag", async () => {
		const changes = new Map([
			[
				"my-comp",
				{
					current: {
						dependencies: [] as string[],
						registryDependencies: [] as string[],
					},
					detected: {
						dependencies: ["clsx"],
						registryDependencies: [] as string[],
					},
				},
			],
		]);
		vi.mocked(findDepChanges).mockReturnValue(changes);

		await scanCommand.parseAsync([
			"node",
			"shadregistry",
			"--yes",
		]);
		expect(writeManifest).toHaveBeenCalled();
		expect(log.success).toHaveBeenCalledWith(
			expect.stringContaining("Updated"),
		);
	});

	it("writes manifest when user confirms", async () => {
		const changes = new Map([
			[
				"my-comp",
				{
					current: {
						dependencies: [] as string[],
						registryDependencies: [] as string[],
					},
					detected: {
						dependencies: ["clsx"],
						registryDependencies: [] as string[],
					},
				},
			],
		]);
		vi.mocked(findDepChanges).mockReturnValue(changes);

		// readlineAnswer defaults to "y"
		await scanCommand.parseAsync(["node", "shadregistry"]);
		expect(writeManifest).toHaveBeenCalled();
	});

	it("displays import warnings when found", async () => {
		vi.mocked(validateImports).mockReturnValue([
			{
				itemName: "my-comp",
				filePath: "registry/new-york/blocks/my-comp/components/my-comp.tsx",
				importPath: "../../button/components/button",
				severity: "error",
				message: 'Cross-item relative import references item "button".',
			},
		]);
		vi.mocked(findDepChanges).mockReturnValue(new Map());

		await scanCommand.parseAsync(["node", "shadregistry"]);
		expect(log.bold).toHaveBeenCalledWith("Import warnings:");
		expect(log.warn).toHaveBeenCalledWith(
			expect.stringContaining("import error"),
		);
	});

	it("does not write manifest when user declines", async () => {
		const changes = new Map([
			[
				"my-comp",
				{
					current: {
						dependencies: [] as string[],
						registryDependencies: [] as string[],
					},
					detected: {
						dependencies: ["clsx"],
						registryDependencies: [] as string[],
					},
				},
			],
		]);
		vi.mocked(findDepChanges).mockReturnValue(changes);

		// Override readline answer to "n"
		readlineAnswer = "n";

		await scanCommand.parseAsync(["node", "shadregistry"]);
		expect(writeManifest).not.toHaveBeenCalled();
		expect(log.info).toHaveBeenCalledWith("Aborted.");
	});
});
