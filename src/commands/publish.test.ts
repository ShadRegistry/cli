import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProjectConfig, ItemPayload, DiffResult } from "../types/index.js";

const mockGet = vi.fn();
const mockPost = vi.fn();
const mockDelete = vi.fn();

vi.mock("../lib/auth.js", () => ({
	resolveToken: vi.fn(),
	resolveHostname: vi.fn(() => "https://shadregistry.com"),
}));

vi.mock("../lib/api-client.js", () => ({
	ApiClient: class MockApiClient {
		get = mockGet;
		post = mockPost;
		delete = mockDelete;
	},
}));

vi.mock("../lib/config.js", () => ({
	readConfig: vi.fn(),
	writeConfig: vi.fn(),
}));

vi.mock("../lib/registry-builder.js", () => ({
	readBuildOutput: vi.fn(),
	validatePayload: vi.fn(),
	chunkItems: vi.fn(),
}));

vi.mock("../lib/diff-utils.js", () => ({
	computeDiff: vi.fn(),
	formatDiffSummary: vi.fn(() => "summary"),
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

vi.mock("ora", () => ({
	default: vi.fn(() => ({
		start: vi.fn().mockReturnThis(),
		stop: vi.fn(),
		fail: vi.fn(),
	})),
}));

let readlineAnswer = "y";

vi.mock("node:readline", () => ({
	createInterface: vi.fn(() => ({
		question: vi.fn((_q: string, cb: (answer: string) => void) =>
			cb(readlineAnswer),
		),
		close: vi.fn(),
	})),
}));

import { publishCommand } from "./publish.js";
import { resolveToken } from "../lib/auth.js";
import { readConfig } from "../lib/config.js";
import { readBuildOutput, validatePayload, chunkItems } from "../lib/registry-builder.js";
import { computeDiff } from "../lib/diff-utils.js";
import { log } from "../lib/logger.js";

let mockExit: ReturnType<typeof vi.spyOn>;

const config: ProjectConfig = {
	registry: "test",
	sourceDir: "src/registry/new-york/items",
	url: "https://shadregistry.com",
};

const samplePayload: ItemPayload = {
	name: "button",
	type: "registry:component",
	files: [
		{
			path: "src/registry/new-york/items/button/components/button.tsx",
			type: "registry:ui",
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

const newItemDiff: DiffResult = {
	newItems: [samplePayload],
	updatedItems: [],
	unchangedNames: [],
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
	resetCommanderOptions(publishCommand);
	readlineAnswer = "y";
	mockExit = vi
		.spyOn(process, "exit")
		.mockImplementation(((code?: number) => {
			throw new Error(`EXIT_${code}`);
		}) as any);
	vi.mocked(resolveToken).mockReturnValue("test_token");
	vi.mocked(readConfig).mockReturnValue(config);
	vi.mocked(readBuildOutput).mockReturnValue([samplePayload]);
	vi.mocked(validatePayload).mockReturnValue(null);
	vi.mocked(chunkItems).mockReturnValue([[samplePayload]]);
	vi.mocked(computeDiff).mockReturnValue(emptyDiff);
	mockGet.mockResolvedValue({ items: [] });
	mockPost.mockResolvedValue({ created: 0, updated: 0, errors: [] });
});

describe("publish command", () => {
	it("exits with 2 when not authenticated", async () => {
		vi.mocked(resolveToken).mockReturnValue(null);
		await publishCommand
			.parseAsync(["node", "shadregistry"])
			.catch(() => {});
		expect(mockExit).toHaveBeenCalledWith(2);
		expect(log.error).toHaveBeenCalledWith(
			expect.stringContaining("Not authenticated"),
		);
	});

	it("lists registries and creates config when no config exists", async () => {
		vi.mocked(readConfig).mockReturnValue(null);
		mockGet.mockResolvedValueOnce({
			registries: [
				{ name: "my-lib", displayName: "My Lib", isPrivate: false },
			],
		}).mockResolvedValue({ items: [] });
		readlineAnswer = "1"; // select first registry
		await publishCommand
			.parseAsync(["node", "shadregistry"])
			.catch(() => {});
		expect(log.warn).toHaveBeenCalledWith(
			expect.stringContaining("No shadregistry.config.json found"),
		);
		expect(log.info).toHaveBeenCalledWith(
			expect.stringContaining("my-lib"),
		);
		expect(log.success).toHaveBeenCalledWith(
			expect.stringContaining("Created shadregistry.config.json"),
		);
	});

	it("falls back to name prompt when no registries exist", async () => {
		vi.mocked(readConfig).mockReturnValue(null);
		mockGet.mockResolvedValueOnce({
			registries: [],
		}).mockResolvedValue({ items: [] });
		readlineAnswer = "my-registry";
		await publishCommand
			.parseAsync(["node", "shadregistry"])
			.catch(() => {});
		expect(log.success).toHaveBeenCalledWith(
			expect.stringContaining("Created shadregistry.config.json"),
		);
	});

	it("exits with 1 when no config and empty registry name", async () => {
		vi.mocked(readConfig).mockReturnValue(null);
		mockGet.mockResolvedValueOnce({ registries: [] });
		readlineAnswer = "";
		await publishCommand
			.parseAsync(["node", "shadregistry"])
			.catch(() => {});
		expect(mockExit).toHaveBeenCalledWith(1);
	});

	it("exits with 1 when build output is missing", async () => {
		vi.mocked(readBuildOutput).mockImplementation(() => {
			throw new Error("Build output directory not found");
		});
		await publishCommand
			.parseAsync(["node", "shadregistry"])
			.catch(() => {});
		expect(mockExit).toHaveBeenCalledWith(1);
		expect(log.error).toHaveBeenCalledWith(
			expect.stringContaining("Build output directory not found"),
		);
	});

	it("exits with 0 when no items in build output", async () => {
		vi.mocked(readBuildOutput).mockReturnValue([]);
		await publishCommand
			.parseAsync(["node", "shadregistry"])
			.catch(() => {});
		expect(mockExit).toHaveBeenCalledWith(0);
		expect(log.warn).toHaveBeenCalled();
	});

	it("exits with 1 on validation error", async () => {
		vi.mocked(validatePayload).mockReturnValue("Name too short");
		await publishCommand
			.parseAsync(["node", "shadregistry"])
			.catch(() => {});
		expect(mockExit).toHaveBeenCalledWith(1);
		expect(log.error).toHaveBeenCalledWith("Name too short");
	});

	it("exits with 0 on --dry-run", async () => {
		vi.mocked(computeDiff).mockReturnValue(newItemDiff);
		await publishCommand
			.parseAsync(["node", "shadregistry", "--dry-run"])
			.catch(() => {});
		expect(mockExit).toHaveBeenCalledWith(0);
		expect(mockPost).not.toHaveBeenCalledWith(
			"/api/cli/items/publish",
			expect.anything(),
		);
	});

	it("exits with 0 when nothing to publish", async () => {
		vi.mocked(computeDiff).mockReturnValue(emptyDiff);
		await publishCommand
			.parseAsync(["node", "shadregistry"])
			.catch(() => {});
		expect(mockExit).toHaveBeenCalledWith(0);
		expect(log.info).toHaveBeenCalledWith("Nothing to publish.");
	});

	it("publishes with --force without prompting", async () => {
		vi.mocked(computeDiff).mockReturnValue(newItemDiff);
		mockPost.mockResolvedValue({ created: 1, updated: 0, errors: [] });
		await publishCommand.parseAsync([
			"node",
			"shadregistry",
			"--force",
		]);
		expect(mockPost).toHaveBeenCalledWith(
			"/api/cli/items/publish",
			expect.objectContaining({ registry: "test" }),
		);
		expect(log.success).toHaveBeenCalledWith(
			expect.stringContaining("Published"),
		);
	});

	it("logs created and updated counts after publish", async () => {
		vi.mocked(computeDiff).mockReturnValue(newItemDiff);
		mockPost.mockResolvedValue({ created: 1, updated: 0, errors: [] });
		await publishCommand.parseAsync([
			"node",
			"shadregistry",
			"--force",
		]);
		expect(log.success).toHaveBeenCalledWith(
			expect.stringContaining("1 item"),
		);
		expect(log.info).toHaveBeenCalledWith(
			expect.stringContaining("button"),
		);
	});

	it("exits with 3 on upload API error", async () => {
		vi.mocked(computeDiff).mockReturnValue(newItemDiff);
		mockPost.mockRejectedValue(new Error("Server error"));
		await publishCommand
			.parseAsync(["node", "shadregistry", "--force"])
			.catch(() => {});
		expect(mockExit).toHaveBeenCalledWith(3);
	});

	it("aborts when user declines confirmation", async () => {
		vi.mocked(computeDiff).mockReturnValue(newItemDiff);
		readlineAnswer = "n";
		await publishCommand
			.parseAsync(["node", "shadregistry"])
			.catch(() => {});
		expect(log.info).toHaveBeenCalledWith("Aborted.");
		expect(mockPost).not.toHaveBeenCalledWith(
			"/api/cli/items/publish",
			expect.anything(),
		);
	});

	it("filters payloads with --filter flag", async () => {
		const payload2: ItemPayload = {
			name: "input",
			type: "registry:component",
			files: [
				{
					path: "src/registry/new-york/items/input/components/input.tsx",
					type: "registry:ui",
					content: "export function Input() {}",
				},
			],
		};
		vi.mocked(readBuildOutput).mockReturnValue([samplePayload, payload2]);
		vi.mocked(computeDiff).mockReturnValue({
			newItems: [samplePayload],
			updatedItems: [],
			unchangedNames: [],
			orphanedNames: [],
		});
		vi.mocked(chunkItems).mockReturnValue([[samplePayload]]);
		mockPost.mockResolvedValue({ created: 1, updated: 0, errors: [] });

		await publishCommand.parseAsync([
			"node",
			"shadregistry",
			"--force",
			"--filter",
			"button",
		]);
		// computeDiff should have been called with only the filtered payload
		expect(vi.mocked(computeDiff).mock.calls[0][0]).toEqual([
			samplePayload,
		]);
	});
});
