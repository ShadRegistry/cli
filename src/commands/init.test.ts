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
		expect(existsSync(join(tmpDir, "src/registry/new-york/items"))).toBe(true);
	});

	it("creates components.json for shadcn build", async () => {
		vi.mocked(resolveToken).mockReturnValue(null);
		await initCommand.parseAsync([
			"node",
			"shadregistry",
			"--name",
			"test-reg",
			"--yes",
		]);
		const componentsPath = join(tmpDir, "components.json");
		expect(existsSync(componentsPath)).toBe(true);
		const components = JSON.parse(readFileSync(componentsPath, "utf-8"));
		expect(components.aliases.components).toBe("@/components");
		expect(components.style).toBe("new-york");
	});

	it("creates package.json with shadcn and build script", async () => {
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
		expect(pkg.devDependencies).toHaveProperty("shadcn");
		expect(pkg.dependencies).toHaveProperty("clsx");
		expect(pkg.dependencies).toHaveProperty("tailwind-merge");
		expect(pkg.scripts.build).toBe("shadcn build");
		expect(execSync).toHaveBeenCalled();
	});

	it("creates src/lib/utils.ts with cn helper", async () => {
		vi.mocked(resolveToken).mockReturnValue(null);
		await initCommand.parseAsync([
			"node",
			"shadregistry",
			"--name",
			"test-reg",
			"--yes",
		]);
		const utilsPath = join(tmpDir, "src/lib/utils.ts");
		expect(existsSync(utilsPath)).toBe(true);
		const content = readFileSync(utilsPath, "utf-8");
		expect(content).toContain("export function cn(");
		expect(content).toContain('from "clsx"');
		expect(content).toContain('from "tailwind-merge"');
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

	it("warns about missing deps when package.json already exists", async () => {
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
		expect(log.warn).toHaveBeenCalledWith(
			expect.stringContaining("package.json already exists"),
		);
		expect(log.warn).toHaveBeenCalledWith(
			expect.stringContaining("clsx"),
		);
		expect(log.warn).toHaveBeenCalledWith(
			expect.stringContaining("tailwind-merge"),
		);
	});

	it("creates tsconfig.json with @/ path aliases", async () => {
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
		expect(tsconfig.compilerOptions.baseUrl).toBe(".");
		expect(tsconfig.compilerOptions.paths["@/*"]).toEqual(["./src/*"]);
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

	it("creates preview app files and vite config", async () => {
		vi.mocked(resolveToken).mockReturnValue(null);
		await initCommand.parseAsync([
			"node",
			"shadregistry",
			"--name",
			"test-reg",
			"--yes",
		]);
		expect(existsSync(join(tmpDir, "vite.config.ts"))).toBe(true);
		expect(existsSync(join(tmpDir, "src/preview/index.html"))).toBe(true);
		expect(existsSync(join(tmpDir, "src/preview/main.tsx"))).toBe(true);
		expect(existsSync(join(tmpDir, "src/preview/App.tsx"))).toBe(true);
		expect(existsSync(join(tmpDir, "src/preview/registry.ts"))).toBe(true);
		expect(existsSync(join(tmpDir, "src/preview/globals.css"))).toBe(true);

		const viteConfig = readFileSync(join(tmpDir, "vite.config.ts"), "utf-8");
		expect(viteConfig).toContain("src/preview");
		expect(viteConfig).toContain('"@"');
	});

	it("includes vite deps in generated package.json", async () => {
		vi.mocked(resolveToken).mockReturnValue(null);
		await initCommand.parseAsync([
			"node",
			"shadregistry",
			"--name",
			"test-reg",
			"--yes",
		]);
		const pkg = JSON.parse(readFileSync(join(tmpDir, "package.json"), "utf-8"));
		expect(pkg.devDependencies).toHaveProperty("vite");
		expect(pkg.devDependencies).toHaveProperty("@vitejs/plugin-react");
		expect(pkg.devDependencies).toHaveProperty("react-dom");
		expect(pkg.devDependencies).toHaveProperty("tailwindcss");
		expect(pkg.scripts.dev).toBe("shadregistry dev --preview");
	});

	it("does not overwrite existing preview files", async () => {
		vi.mocked(resolveToken).mockReturnValue(null);
		mkdirSync(join(tmpDir, "src/preview"), { recursive: true });
		writeFileSync(join(tmpDir, "src/preview/App.tsx"), "custom content");
		await initCommand.parseAsync([
			"node",
			"shadregistry",
			"--name",
			"test-reg",
			"--yes",
		]);
		const content = readFileSync(join(tmpDir, "src/preview/App.tsx"), "utf-8");
		expect(content).toBe("custom content");
	});
});
