import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGet = vi.fn();
const mockPost = vi.fn();

vi.mock("../lib/auth.js", () => ({
	readAuth: vi.fn(),
	writeAuth: vi.fn(),
	resolveHostname: vi.fn(() => "https://shadregistry.com"),
}));

vi.mock("../lib/api-client.js", () => ({
	ApiClient: class MockApiClient {
		get = mockGet;
		post = mockPost;
		delete = vi.fn();
	},
	createUnauthClient: vi.fn(() => ({
		get: mockGet,
		post: mockPost,
		delete: vi.fn(),
	})),
	ApiError: class MockApiError extends Error {
		status: number;
		constructor(message: string, status: number) {
			super(message);
			this.status = status;
		}
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

vi.mock("open", () => ({ default: vi.fn() }));
vi.mock("ora", () => ({
	default: vi.fn(() => ({
		start: vi.fn().mockReturnThis(),
		stop: vi.fn(),
		fail: vi.fn(),
	})),
}));

// Module-level variables to control readline behavior
let stdinLines: string[] = [];
let readlineAnswer = "";

vi.mock("node:readline", () => ({
	createInterface: vi.fn(() => ({
		[Symbol.asyncIterator]: () => {
			let i = 0;
			return {
				next: async () => {
					if (i < stdinLines.length) {
						return { value: stdinLines[i++], done: false };
					}
					return { value: undefined, done: true };
				},
			};
		},
		question: vi.fn((_q: string, cb: (answer: string) => void) =>
			cb(readlineAnswer),
		),
		close: vi.fn(),
	})),
}));

import { loginCommand } from "./login.js";
import { readAuth, writeAuth } from "../lib/auth.js";
import { ApiError } from "../lib/api-client.js";
import { log } from "../lib/logger.js";

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
	resetCommanderOptions(loginCommand);
	stdinLines = [];
	readlineAnswer = "";
	mockExit = vi
		.spyOn(process, "exit")
		.mockImplementation(((code?: number) => {
			throw new Error(`EXIT_${code}`);
		}) as any);
});

describe("login command", () => {
	describe("--with-token", () => {
		it("writes auth on valid token", async () => {
			stdinLines = ["pat_test123"];
			mockGet.mockResolvedValue({
				username: "alice",
				tokenType: "pat",
			});
			await loginCommand.parseAsync([
				"node",
				"shadregistry",
				"--with-token",
			]);
			expect(writeAuth).toHaveBeenCalledWith(
				expect.objectContaining({
					token: "pat_test123",
					user: { username: "alice" },
				}),
			);
			expect(log.success).toHaveBeenCalledWith(
				expect.stringContaining("alice"),
			);
		});

		it("exits with 2 when stdin is empty", async () => {
			stdinLines = [];
			await loginCommand
				.parseAsync(["node", "shadregistry", "--with-token"])
				.catch(() => {});
			expect(mockExit).toHaveBeenCalledWith(2);
			expect(log.error).toHaveBeenCalledWith(
				expect.stringContaining("No token"),
			);
		});

		it("exits with 2 on API error", async () => {
			stdinLines = ["bad_token"];
			mockGet.mockRejectedValue(
				new ApiError("Unauthorized", 401),
			);
			await loginCommand
				.parseAsync(["node", "shadregistry", "--with-token"])
				.catch(() => {});
			expect(mockExit).toHaveBeenCalledWith(2);
			expect(log.error).toHaveBeenCalledWith(
				expect.stringContaining("Authentication failed"),
			);
		});
	});

	describe("device auth", () => {
		it("returns early when already logged in", async () => {
			vi.mocked(readAuth).mockReturnValue({
				token: "existing_token",
				user: { username: "bob" },
				hostname: "https://shadregistry.com",
			});
			mockGet.mockResolvedValue({ username: "bob" });

			await loginCommand.parseAsync(["node", "shadregistry"]);
			expect(log.info).toHaveBeenCalledWith(
				expect.stringContaining("Already logged in"),
			);
			expect(writeAuth).not.toHaveBeenCalled();
		});

		it("proceeds with login when existing token is invalid", async () => {
			vi.mocked(readAuth).mockReturnValue({
				token: "expired_token",
				user: { username: "bob" },
				hostname: "https://shadregistry.com",
			});
			// whoami fails → token invalid, proceed with device auth
			mockGet.mockRejectedValue(new Error("Unauthorized"));
			// device code request fails
			mockPost.mockRejectedValue(new Error("Server down"));

			await loginCommand
				.parseAsync(["node", "shadregistry"])
				.catch(() => {});
			expect(mockExit).toHaveBeenCalledWith(2);
			expect(log.error).toHaveBeenCalledWith(
				expect.stringContaining("Failed to start login flow"),
			);
		});

		it("exits when device code request fails", async () => {
			vi.mocked(readAuth).mockReturnValue(null);
			mockPost.mockRejectedValue(new Error("Network error"));

			await loginCommand
				.parseAsync(["node", "shadregistry"])
				.catch(() => {});
			expect(mockExit).toHaveBeenCalledWith(2);
			expect(log.error).toHaveBeenCalledWith(
				expect.stringContaining("Failed to start login"),
			);
		});
	});
});
