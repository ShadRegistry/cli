import { describe, it, expect, vi, beforeEach } from "vitest";

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

import { listCommand } from "./list.js";
import { resolveToken } from "../lib/auth.js";
import { log } from "../lib/logger.js";

let mockExit: ReturnType<typeof vi.spyOn>;
let mockConsoleLog: ReturnType<typeof vi.spyOn>;

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
	resetCommanderOptions(listCommand);
	vi.mocked(resolveToken).mockReturnValue("test_token");
	mockExit = vi
		.spyOn(process, "exit")
		.mockImplementation(((code?: number) => {
			throw new Error(`EXIT_${code}`);
		}) as any);
	mockConsoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("list command", () => {
	it("exits when not authenticated", async () => {
		vi.mocked(resolveToken).mockReturnValue(null);
		await listCommand.parseAsync(["node", "shadregistry"]).catch(() => {});
		expect(mockExit).toHaveBeenCalledWith(2);
		expect(log.error).toHaveBeenCalledWith(
			expect.stringContaining("Not authenticated"),
		);
	});

	describe("list registries (no arg)", () => {
		it("outputs JSON with --json flag", async () => {
			mockGet.mockResolvedValue({
				registries: [
					{
						name: "my-reg",
						displayName: "My Reg",
						isPrivate: false,
						totalInstalls: 10,
					},
				],
			});
			await listCommand.parseAsync([
				"node",
				"shadregistry",
				"--json",
			]);
			expect(mockConsoleLog).toHaveBeenCalled();
			const output = JSON.parse(mockConsoleLog.mock.calls[0][0]);
			expect(output[0].name).toBe("my-reg");
		});

		it("shows info when no registries", async () => {
			mockGet.mockResolvedValue({ registries: [] });
			await listCommand.parseAsync(["node", "shadregistry"]);
			expect(log.info).toHaveBeenCalledWith(
				expect.stringContaining("No registries found"),
			);
		});

		it("displays formatted table for registries", async () => {
			mockGet.mockResolvedValue({
				registries: [
					{
						name: "my-reg",
						displayName: "My Reg",
						isPrivate: false,
						totalInstalls: 42,
					},
				],
			});
			await listCommand.parseAsync(["node", "shadregistry"]);
			expect(log.info).toHaveBeenCalledWith(
				expect.stringContaining("NAME"),
			);
			expect(log.info).toHaveBeenCalledWith(
				expect.stringContaining("my-reg"),
			);
		});

		it("exits on API error", async () => {
			mockGet.mockRejectedValue(new Error("Network error"));
			await listCommand.parseAsync(["node", "shadregistry"]).catch(() => {});
			expect(mockExit).toHaveBeenCalledWith(3);
		});
	});

	describe("list items (with registry arg)", () => {
		it("outputs JSON with --json flag", async () => {
			mockGet.mockResolvedValue({
				items: [
					{
						name: "button",
						type: "registry:component",
						title: "Button",
					},
				],
			});
			await listCommand.parseAsync([
				"node",
				"shadregistry",
				"my-reg",
				"--json",
			]);
			expect(mockConsoleLog).toHaveBeenCalled();
			const output = JSON.parse(mockConsoleLog.mock.calls[0][0]);
			expect(output[0].name).toBe("button");
		});

		it("shows info when no items", async () => {
			mockGet.mockResolvedValue({ items: [] });
			await listCommand.parseAsync([
				"node",
				"shadregistry",
				"my-reg",
			]);
			expect(log.info).toHaveBeenCalledWith(
				expect.stringContaining("No items"),
			);
		});

		it("exits on API error", async () => {
			mockGet.mockRejectedValue(new Error("Not found"));
			await listCommand.parseAsync([
				"node",
				"shadregistry",
				"my-reg",
			]).catch(() => {});
			expect(mockExit).toHaveBeenCalledWith(3);
		});
	});
});
