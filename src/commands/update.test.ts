import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:child_process", () => ({
	execSync: vi.fn(),
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

vi.mock("../lib/version.js", () => ({
	getVersion: () => "0.1.2",
}));

vi.mock("../lib/update-check.js", () => ({
	checkForUpdate: vi.fn(),
	compareSemver: vi.fn(),
}));

vi.mock("ora", () => ({
	default: vi.fn(() => ({
		start: vi.fn().mockReturnThis(),
		stop: vi.fn(),
		fail: vi.fn(),
	})),
}));

import { updateCommand } from "./update.js";
import { checkForUpdate } from "../lib/update-check.js";
import { log } from "../lib/logger.js";
import { execSync } from "node:child_process";

let mockExit: ReturnType<typeof vi.spyOn>;

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
	resetCommanderOptions(updateCommand);
	mockExit = vi
		.spyOn(process, "exit")
		.mockImplementation(((code?: number) => {
			throw new Error(`EXIT_${code}`);
		}) as any);
});

describe("update command", () => {
	it("reports up to date when no update available", async () => {
		vi.mocked(checkForUpdate).mockResolvedValue(null);
		await updateCommand.parseAsync(["node", "shadregistry"]);
		expect(log.success).toHaveBeenCalledWith(
			expect.stringContaining("up to date"),
		);
		expect(execSync).not.toHaveBeenCalledWith(
			expect.stringContaining("@shadregistry/cli"),
			expect.anything(),
		);
	});

	it("runs install when update is available", async () => {
		vi.mocked(checkForUpdate).mockResolvedValue("0.2.0");
		await updateCommand.parseAsync(["node", "shadregistry"]);
		expect(execSync).toHaveBeenCalledWith(
			expect.stringContaining("@shadregistry/cli@latest"),
			expect.objectContaining({ stdio: "inherit" }),
		);
		expect(log.success).toHaveBeenCalledWith(
			expect.stringContaining("Updated"),
		);
	});

	it("only checks with --check flag", async () => {
		vi.mocked(checkForUpdate).mockResolvedValue("0.2.0");
		await updateCommand.parseAsync([
			"node",
			"shadregistry",
			"--check",
		]);
		expect(log.info).toHaveBeenCalledWith(
			expect.stringContaining("v0.2.0"),
		);
		expect(execSync).not.toHaveBeenCalledWith(
			expect.stringContaining("@shadregistry/cli"),
			expect.anything(),
		);
	});

	it("shows current and latest versions", async () => {
		vi.mocked(checkForUpdate).mockResolvedValue("0.2.0");
		await updateCommand.parseAsync([
			"node",
			"shadregistry",
			"--check",
		]);
		expect(log.info).toHaveBeenCalledWith(
			expect.stringContaining("v0.1.2"),
		);
		expect(log.info).toHaveBeenCalledWith(
			expect.stringContaining("v0.2.0"),
		);
	});

	it("exits with 1 when install fails", async () => {
		vi.mocked(checkForUpdate).mockResolvedValue("0.2.0");
		vi.mocked(execSync).mockImplementation(() => {
			throw new Error("Permission denied");
		});
		await updateCommand
			.parseAsync(["node", "shadregistry"])
			.catch(() => {});
		expect(mockExit).toHaveBeenCalledWith(1);
		expect(log.error).toHaveBeenCalledWith(
			expect.stringContaining("Update failed"),
		);
	});
});
