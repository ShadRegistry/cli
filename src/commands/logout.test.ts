import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/auth.js", () => ({
	deleteAuth: vi.fn(),
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

import { logoutCommand } from "./logout.js";
import { deleteAuth } from "../lib/auth.js";
import { log } from "../lib/logger.js";

beforeEach(() => {
	vi.clearAllMocks();
});

describe("logout command", () => {
	it("logs success when auth file deleted", async () => {
		vi.mocked(deleteAuth).mockReturnValue(true);
		await logoutCommand.parseAsync(["node", "shadregistry", "logout"]);
		expect(deleteAuth).toHaveBeenCalled();
		expect(log.success).toHaveBeenCalledWith("Logged out successfully.");
	});

	it("logs info when not logged in", async () => {
		vi.mocked(deleteAuth).mockReturnValue(false);
		await logoutCommand.parseAsync(["node", "shadregistry", "logout"]);
		expect(deleteAuth).toHaveBeenCalled();
		expect(log.info).toHaveBeenCalledWith("Not currently logged in.");
	});
});
