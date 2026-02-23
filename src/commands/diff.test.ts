import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProjectConfig, RegistryManifest, ItemPayload, DiffResult } from "../types/index.js";

const mockGet = vi.fn();

vi.mock("../lib/auth.js", () => ({
	resolveToken: vi.fn(),
	resolveHostname: vi.fn(() => "https://shadregistry.com"),
}));

vi.mock("../lib/api-client.js", () => ({
	ApiClient: class MockApiClient {
		get = mockGet;
		post = vi.fn();
		delete = vi.fn();
	},
}));

vi.mock("../lib/config.js", () => ({
	readConfig: vi.fn(),
	readManifest: vi.fn(),
}));

vi.mock("../lib/registry-builder.js", () => ({
	buildPayloads: vi.fn(),
	validatePayload: vi.fn(),
}));

vi.mock("../lib/diff-utils.js", () => ({
	computeDiff: vi.fn(),
	formatDiffSummary: vi.fn(() => "summary text"),
	formatItemDiff: vi.fn(() => "diff text"),
}));

vi.mock("../lib/import-scanner.js", () => ({
	scanRegistryItems: vi.fn(),
	findDepChanges: vi.fn(),
}));

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

import { diffCommand } from "./diff.js";
import { resolveToken } from "../lib/auth.js";
import { readConfig, readManifest } from "../lib/config.js";
import { buildPayloads, validatePayload } from "../lib/registry-builder.js";
import { computeDiff, formatDiffSummary, formatItemDiff } from "../lib/diff-utils.js";
import { scanRegistryItems, findDepChanges } from "../lib/import-scanner.js";
import { log } from "../lib/logger.js";

let mockExit: ReturnType<typeof vi.spyOn>;
let mockConsoleLog: ReturnType<typeof vi.spyOn>;

const config: ProjectConfig = {
	registry: "test",
	sourceDir: "registry",
	url: "https://shadregistry.com",
};

const manifest: RegistryManifest = {
	name: "test",
	items: [
		{
			name: "button",
			type: "registry:component",
			files: [{ path: "registry/button/button.tsx", type: "registry:component" }],
		},
	],
};

const samplePayload: ItemPayload = {
	name: "button",
	type: "registry:component",
	files: [
		{
			path: "registry/button/button.tsx",
			type: "registry:component",
			content: "export function Button() {}",
		},
	],
};

const emptyDiff: DiffResult = {
	newItems: [],
	updatedItems: [],
	unchangedNames: ["button"],
	orphanedNames: [],
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
	resetCommanderOptions(diffCommand);
	mockExit = vi
		.spyOn(process, "exit")
		.mockImplementation(((code?: number) => {
			throw new Error(`EXIT_${code}`);
		}) as any);
	mockConsoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
	vi.mocked(resolveToken).mockReturnValue("test_token");
	vi.mocked(readConfig).mockReturnValue(config);
	vi.mocked(readManifest).mockReturnValue(
		JSON.parse(JSON.stringify(manifest)),
	);
	vi.mocked(buildPayloads).mockReturnValue([samplePayload]);
	vi.mocked(validatePayload).mockReturnValue(null);
	vi.mocked(computeDiff).mockReturnValue(emptyDiff);
	vi.mocked(scanRegistryItems).mockReturnValue(new Map());
	vi.mocked(findDepChanges).mockReturnValue(new Map());
	mockGet.mockResolvedValue({ items: [] });
});

describe("diff command", () => {
	it("exits with 2 when not authenticated", async () => {
		vi.mocked(resolveToken).mockReturnValue(null);
		await diffCommand
			.parseAsync(["node", "shadregistry"])
			.catch(() => {});
		expect(mockExit).toHaveBeenCalledWith(2);
		expect(log.error).toHaveBeenCalledWith(
			expect.stringContaining("Not authenticated"),
		);
	});

	it("exits with 1 when no config", async () => {
		vi.mocked(readConfig).mockReturnValue(null);
		await diffCommand
			.parseAsync(["node", "shadregistry"])
			.catch(() => {});
		expect(mockExit).toHaveBeenCalledWith(1);
	});

	it("exits with 1 when empty manifest", async () => {
		vi.mocked(readManifest).mockReturnValue({ name: "test", items: [] });
		await diffCommand
			.parseAsync(["node", "shadregistry"])
			.catch(() => {});
		expect(mockExit).toHaveBeenCalledWith(1);
		expect(log.error).toHaveBeenCalledWith(
			expect.stringContaining("No items"),
		);
	});

	it("exits with 1 on build error", async () => {
		vi.mocked(buildPayloads).mockImplementation(() => {
			throw new Error("File missing");
		});
		await diffCommand
			.parseAsync(["node", "shadregistry"])
			.catch(() => {});
		expect(mockExit).toHaveBeenCalledWith(1);
		expect(log.error).toHaveBeenCalledWith(
			expect.stringContaining("File missing"),
		);
	});

	it("exits with 1 on validation error", async () => {
		vi.mocked(validatePayload).mockReturnValue("Invalid item");
		await diffCommand
			.parseAsync(["node", "shadregistry"])
			.catch(() => {});
		expect(mockExit).toHaveBeenCalledWith(1);
		expect(log.error).toHaveBeenCalledWith("Invalid item");
	});

	it("exits with 3 on API error fetching remote items", async () => {
		mockGet.mockRejectedValue(new Error("Network error"));
		await diffCommand
			.parseAsync(["node", "shadregistry"])
			.catch(() => {});
		expect(mockExit).toHaveBeenCalledWith(3);
	});

	it("outputs JSON with --json flag", async () => {
		vi.mocked(computeDiff).mockReturnValue({
			newItems: [samplePayload],
			updatedItems: [],
			unchangedNames: [],
			orphanedNames: ["old-comp"],
		});
		await diffCommand.parseAsync([
			"node",
			"shadregistry",
			"--json",
		]);
		expect(mockConsoleLog).toHaveBeenCalled();
		const output = JSON.parse(mockConsoleLog.mock.calls[0][0]);
		expect(output.new).toEqual(["button"]);
		expect(output.orphaned).toEqual(["old-comp"]);
	});

	it("displays diff summary for text output", async () => {
		await diffCommand.parseAsync(["node", "shadregistry"]);
		expect(log.bold).toHaveBeenCalledWith(
			expect.stringContaining("Diff for @test"),
		);
		expect(log.info).toHaveBeenCalledWith("summary text");
	});

	it("shows detailed diff for updated items", async () => {
		const remotePayload = {
			...samplePayload,
			files: [
				{
					...samplePayload.files[0],
					content: "old content",
				},
			],
		};
		vi.mocked(computeDiff).mockReturnValue({
			newItems: [],
			updatedItems: [samplePayload],
			unchangedNames: [],
			orphanedNames: [],
		});
		mockGet.mockResolvedValue({ items: [remotePayload] });

		await diffCommand.parseAsync(["node", "shadregistry"]);
		expect(formatItemDiff).toHaveBeenCalled();
		expect(log.dim).toHaveBeenCalledWith("diff text");
	});

	it("shows dependency changes section", async () => {
		const depChanges = new Map([
			[
				"button",
				{
					current: { dependencies: [] as string[], registryDependencies: [] as string[] },
					detected: { dependencies: ["clsx"], registryDependencies: [] as string[] },
				},
			],
		]);
		vi.mocked(findDepChanges).mockReturnValue(depChanges);
		await diffCommand.parseAsync(["node", "shadregistry"]);
		expect(log.bold).toHaveBeenCalledWith(
			expect.stringContaining("Dependency changes"),
		);
		expect(log.info).toHaveBeenCalledWith(
			expect.stringContaining("button"),
		);
	});

	it("filters payloads with --filter flag", async () => {
		const payload2: ItemPayload = {
			name: "input",
			type: "registry:component",
			files: [
				{
					path: "registry/input/input.tsx",
					type: "registry:component",
					content: "export function Input() {}",
				},
			],
		};
		vi.mocked(buildPayloads).mockReturnValue([samplePayload, payload2]);

		await diffCommand.parseAsync([
			"node",
			"shadregistry",
			"--filter",
			"button",
		]);
		// computeDiff should have been called with only the filtered payload
		expect(vi.mocked(computeDiff).mock.calls[0][0]).toEqual([
			samplePayload,
		]);
	});
});
