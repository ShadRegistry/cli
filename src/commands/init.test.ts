import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	mkdtempSync,
	existsSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const mockGet = vi.fn();
const mockPost = vi.fn();

vi.mock("../lib/auth.js", () => ({
	resolveToken: vi.fn(),
	resolveHostname: vi.fn(() => "https://shadregistry.com"),
}));

vi.mock("../lib/api-client.js", () => ({
	ApiClient: class MockApiClient {
		get = mockGet;
		post = mockPost;
		delete = vi.fn();
	},
}));

vi.mock("../lib/config.js", () => ({
	configExists: vi.fn(),
	manifestExists: vi.fn(),
	writeConfig: vi.fn(),
	writeManifest: vi.fn(),
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

// Module-level variable to control readline answer queue
let readlineAnswers: string[] = [];
let readlineIndex = 0;

vi.mock("node:readline", () => ({
	createInterface: vi.fn(() => ({
		question: vi.fn((_q: string, cb: (answer: string) => void) => {
			cb(readlineAnswers[readlineIndex++] ?? "");
		}),
		close: vi.fn(),
	})),
}));

vi.mock("node:child_process", () => ({
	execSync: vi.fn(),
}));

import { initCommand } from "./init.js";
import { resolveToken } from "../lib/auth.js";
import {
	configExists,
	manifestExists,
	writeConfig,
	writeManifest,
} from "../lib/config.js";
import { log } from "../lib/logger.js";
import { execSync } from "node:child_process";

let tmpDir: string;
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
	resetCommanderOptions(initCommand);
	readlineAnswers = [];
	readlineIndex = 0;
	tmpDir = mkdtempSync(join(tmpdir(), "init-test-"));
	vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
	mockExit = vi
		.spyOn(process, "exit")
		.mockImplementation(((code?: number) => {
			throw new Error(`EXIT_${code}`);
		}) as any);
	vi.mocked(resolveToken).mockReturnValue(null);
	vi.mocked(configExists).mockReturnValue(false);
	vi.mocked(manifestExists).mockReturnValue(false);
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
	vi.restoreAllMocks();
});

describe("init command", () => {
	it("aborts when config exists and user declines overwrite", async () => {
		vi.mocked(configExists).mockReturnValue(true);
		readlineAnswers = ["n"]; // decline overwrite
		await initCommand.parseAsync(["node", "shadregistry"]);
		expect(log.info).toHaveBeenCalledWith("Aborted.");
		expect(writeConfig).not.toHaveBeenCalled();
	});

	it("creates local-only setup when not authenticated", async () => {
		vi.mocked(resolveToken).mockReturnValue(null);
		readlineAnswers = ["my-registry"]; // registry name prompt
		await initCommand.parseAsync(["node", "shadregistry"]);
		expect(writeConfig).toHaveBeenCalledWith(
			expect.objectContaining({
				registry: "my-registry",
			}),
			tmpDir,
		);
		expect(writeManifest).toHaveBeenCalled();
		expect(log.success).toHaveBeenCalledWith(
			expect.stringContaining("Initialized"),
		);
	});

	it("uses --name flag without prompting", async () => {
		vi.mocked(resolveToken).mockReturnValue(null);
		await initCommand.parseAsync([
			"node",
			"shadregistry",
			"--name",
			"test-reg",
			"--yes",
		]);
		expect(writeConfig).toHaveBeenCalledWith(
			expect.objectContaining({
				registry: "test-reg",
			}),
			tmpDir,
		);
	});

	it("uses existing registry when --name matches remote", async () => {
		vi.mocked(resolveToken).mockReturnValue("token123");
		mockGet.mockResolvedValue({
			registries: [
				{ name: "existing-reg", displayName: "Existing", isPrivate: false },
			],
		});
		await initCommand.parseAsync([
			"node",
			"shadregistry",
			"--name",
			"existing-reg",
			"--yes",
		]);
		expect(log.success).toHaveBeenCalledWith(
			expect.stringContaining("Using existing registry"),
		);
		expect(mockPost).not.toHaveBeenCalled();
	});

	it("creates remote registry when --name does not match", async () => {
		vi.mocked(resolveToken).mockReturnValue("token123");
		mockGet.mockResolvedValue({ registries: [] });
		mockPost.mockResolvedValue({});
		await initCommand.parseAsync([
			"node",
			"shadregistry",
			"--name",
			"new-reg",
			"--yes",
		]);
		expect(mockPost).toHaveBeenCalledWith(
			"/api/cli/registries/create",
			expect.objectContaining({ name: "new-reg" }),
		);
		expect(log.success).toHaveBeenCalledWith(
			expect.stringContaining("Created registry"),
		);
	});

	it("exits when remote creation fails", async () => {
		vi.mocked(resolveToken).mockReturnValue("token123");
		mockGet.mockResolvedValue({ registries: [] });
		mockPost.mockRejectedValue(new Error("Conflict"));
		await initCommand
			.parseAsync([
				"node",
				"shadregistry",
				"--name",
				"bad-reg",
				"--yes",
			])
			.catch(() => {});
		expect(mockExit).toHaveBeenCalledWith(1);
		expect(log.error).toHaveBeenCalledWith(
			expect.stringContaining("Failed to create"),
		);
	});

	it("skips manifest write when it already exists", async () => {
		vi.mocked(resolveToken).mockReturnValue(null);
		vi.mocked(manifestExists).mockReturnValue(true);
		await initCommand.parseAsync([
			"node",
			"shadregistry",
			"--name",
			"test-reg",
			"--yes",
		]);
		expect(writeConfig).toHaveBeenCalled();
		expect(writeManifest).not.toHaveBeenCalled();
	});

	it("warns when API listing fails but continues locally", async () => {
		vi.mocked(resolveToken).mockReturnValue("token123");
		mockGet.mockRejectedValue(new Error("Network down"));
		readlineAnswers = ["fallback-reg"]; // registry name prompt
		await initCommand.parseAsync(["node", "shadregistry"]);
		expect(log.warn).toHaveBeenCalledWith(
			expect.stringContaining("Could not fetch registries"),
		);
		expect(writeConfig).toHaveBeenCalled();
	});

	it("creates source directory if missing", async () => {
		vi.mocked(resolveToken).mockReturnValue(null);
		await initCommand.parseAsync([
			"node",
			"shadregistry",
			"--name",
			"test-reg",
			"--yes",
		]);
		expect(existsSync(join(tmpDir, "registry"))).toBe(true);
	});

	it("creates package.json and auto-installs", async () => {
		vi.mocked(resolveToken).mockReturnValue(null);
		await initCommand.parseAsync([
			"node",
			"shadregistry",
			"--name",
			"test-reg",
			"--yes",
		]);
		const pkgPath = join(tmpDir, "package.json");
		expect(existsSync(pkgPath)).toBe(true);
		const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
		expect(pkg.devDependencies).toHaveProperty("react");
		expect(execSync).toHaveBeenCalled();
	});

	it("does not overwrite existing package.json", async () => {
		vi.mocked(resolveToken).mockReturnValue(null);
		writeFileSync(
			join(tmpDir, "package.json"),
			JSON.stringify({ name: "existing" }),
		);
		await initCommand.parseAsync([
			"node",
			"shadregistry",
			"--name",
			"test-reg",
			"--yes",
		]);
		const pkg = JSON.parse(
			readFileSync(join(tmpDir, "package.json"), "utf-8"),
		);
		expect(pkg.name).toBe("existing");
	});

	it("creates tsconfig.json if missing", async () => {
		vi.mocked(resolveToken).mockReturnValue(null);
		await initCommand.parseAsync([
			"node",
			"shadregistry",
			"--name",
			"test-reg",
			"--yes",
		]);
		const tsconfigPath = join(tmpDir, "tsconfig.json");
		expect(existsSync(tsconfigPath)).toBe(true);
		const tsconfig = JSON.parse(readFileSync(tsconfigPath, "utf-8"));
		expect(tsconfig.compilerOptions.jsx).toBe("react-jsx");
	});

	it("warns when auto-install fails", async () => {
		vi.mocked(resolveToken).mockReturnValue(null);
		vi.mocked(execSync).mockImplementation(() => {
			throw new Error("Command not found");
		});
		await initCommand.parseAsync([
			"node",
			"shadregistry",
			"--name",
			"test-reg",
			"--yes",
		]);
		expect(log.warn).toHaveBeenCalledWith(
			expect.stringContaining("Could not auto-install"),
		);
	});
});
