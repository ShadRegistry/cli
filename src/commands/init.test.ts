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

// Mock https — configurable per-test via mockHttpsGet
const mockHttpsGet = vi.fn();
vi.mock("node:https", () => ({
	default: {
		get: (...args: any[]) => mockHttpsGet(...args),
	},
}));

import { initCommand, patchTemplateFiles } from "./init.js";
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

/**
 * Set up mocks so that downloadTemplate succeeds.
 * Creates a fake extracted directory with template files when tar is invoked.
 */
function setupSuccessfulDownload(templateFiles: Record<string, string> = {}) {
	// Mock https.get to return a successful response
	mockHttpsGet.mockImplementation((_url: string, cb: (resp: any) => void) => {
		const resp = {
			statusCode: 200,
			on: (event: string, handler: Function) => {
				if (event === "data") handler(Buffer.from("fake-tar-data"));
				if (event === "end") handler();
				return resp;
			},
			resume: vi.fn(),
		};
		cb(resp);
		return { on: vi.fn() };
	});

	// Mock execSync: when tar is called, create fake extracted dir with template files
	vi.mocked(execSync).mockImplementation((cmd: string) => {
		if (typeof cmd === "string" && cmd.includes("tar")) {
			const match = cmd.match(/-C "([^"]+)"/);
			if (match) {
				const extractDir = match[1];
				const templateDir = join(extractDir, "registry-template-main");
				mkdirSync(templateDir, { recursive: true });

				// Write default Next.js template files
				const defaults: Record<string, string> = {
					"package.json": JSON.stringify({
						name: "registry",
						private: true,
						scripts: { build: "shadcn build", dev: "next dev" },
						dependencies: { clsx: "^2.1.1", "tailwind-merge": "^3.0.0", next: "^15.0.0", react: "^19.0.0", "react-dom": "^19.0.0" },
						devDependencies: {
							shadcn: "^3.0.0",
							tailwindcss: "^4.0.0",
							typescript: "^5.0.0",
						},
					}),
					"registry.json": JSON.stringify({
						$schema: "https://ui.shadcn.com/schema/registry.json",
						name: "acme",
						homepage: "",
						items: [],
					}),
					"components.json": JSON.stringify({
						$schema: "https://ui.shadcn.com/schema.json",
						style: "new-york",
						rsc: true,
						tsx: true,
						aliases: { components: "@/components", utils: "@/lib/utils" },
					}),
					"tsconfig.json": JSON.stringify({
						compilerOptions: {
							jsx: "react-jsx",
							baseUrl: ".",
							paths: { "@/*": ["./src/*"] },
						},
					}),
					"next.config.ts": "export default {};",
					".gitignore": "node_modules/\n.next/\npublic/r/\n",
				};

				// Create subdirs for nested files
				mkdirSync(join(templateDir, "src/lib"), { recursive: true });
				defaults["src/lib/utils.ts"] = 'import { clsx } from "clsx";\nimport { twMerge } from "tailwind-merge";\nexport function cn(...inputs: any[]) { return twMerge(clsx(inputs)); }';

				// Merge with custom overrides
				const files = { ...defaults, ...templateFiles };
				for (const [path, content] of Object.entries(files)) {
					const fullPath = join(templateDir, path);
					mkdirSync(join(fullPath, ".."), { recursive: true });
					writeFileSync(fullPath, content);
				}
			}
		}
		return Buffer.from("");
	});
}

/** Set up mocks so that downloadTemplate fails. */
function setupFailedDownload() {
	mockHttpsGet.mockImplementation(() => {
		throw new Error("Network unavailable");
	});
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
	// Default: successful download
	setupSuccessfulDownload();
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
		readlineAnswers = ["my-registry"]; // registry name
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
		readlineAnswers = ["fallback-reg"]; // registry name
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
		expect(existsSync(join(tmpDir, "registry/new-york/blocks"))).toBe(true);
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
		// copyDirRecursive skips existing files, but patchTemplateFiles will
		// update the name field via JSON patching
		const pkg = JSON.parse(
			readFileSync(join(tmpDir, "package.json"), "utf-8"),
		);
		expect(pkg.name).toBe("test-reg-registry");
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

	it("exits with error when template download fails", async () => {
		setupFailedDownload();
		vi.mocked(resolveToken).mockReturnValue(null);
		await initCommand
			.parseAsync([
				"node",
				"shadregistry",
				"--name",
				"test-reg",
				"--yes",
			])
			.catch(() => {});
		expect(mockExit).toHaveBeenCalledWith(1);
		expect(log.error).toHaveBeenCalledWith(
			expect.stringContaining("Failed to download template"),
		);
	});

	it("accepts --template flag for custom template repo", async () => {
		vi.mocked(resolveToken).mockReturnValue(null);
		await initCommand.parseAsync([
			"node",
			"shadregistry",
			"--name",
			"test-reg",
			"--template",
			"myorg/my-template",
			"--yes",
		]);
		expect(log.success).toHaveBeenCalledWith(
			expect.stringContaining("Initialized"),
		);
	});

	it("patches package.json name from template", async () => {
		vi.mocked(resolveToken).mockReturnValue(null);
		await initCommand.parseAsync([
			"node",
			"shadregistry",
			"--name",
			"my-cool-lib",
			"--yes",
		]);
		const pkg = JSON.parse(
			readFileSync(join(tmpDir, "package.json"), "utf-8"),
		);
		expect(pkg.name).toBe("my-cool-lib-registry");
	});

	it("writes config without templateFlavor", async () => {
		vi.mocked(resolveToken).mockReturnValue(null);
		readlineAnswers = ["test-reg"]; // name
		await initCommand.parseAsync(["node", "shadregistry"]);
		const configArg = vi.mocked(writeConfig).mock.calls[0][0];
		expect(configArg).not.toHaveProperty("templateFlavor");
	});

	it("skips flavor prompt when --template is explicitly provided", async () => {
		vi.mocked(resolveToken).mockReturnValue(null);
		await initCommand.parseAsync([
			"node",
			"shadregistry",
			"--name",
			"test-reg",
			"--template",
			"myorg/custom-template",
			"--yes",
		]);
		const configArg = vi.mocked(writeConfig).mock.calls[0][0];
		expect(configArg).not.toHaveProperty("templateFlavor");
	});

	it("shows npm run dev in next steps", async () => {
		vi.mocked(resolveToken).mockReturnValue(null);
		await initCommand.parseAsync([
			"node",
			"shadregistry",
			"--name",
			"test-reg",
			"--yes",
		]);
		expect(log.info).toHaveBeenCalledWith(
			expect.stringContaining("npm run dev"),
		);
	});
});

describe("patchTemplateFiles", () => {
	it("replaces placeholder variables in template files", () => {
		writeFileSync(
			join(tmpDir, "package.json"),
			JSON.stringify({ name: "{{REGISTRY_NAME}}-registry" }),
		);
		writeFileSync(
			join(tmpDir, "registry.json"),
			JSON.stringify({ name: "{{REGISTRY_NAME}}", items: [] }),
		);

		patchTemplateFiles(tmpDir, {
			registryName: "my-lib",
			sourceDir: "registry/new-york/blocks",
			hostname: "https://shadregistry.com",
		});

		const pkg = JSON.parse(readFileSync(join(tmpDir, "package.json"), "utf-8"));
		expect(pkg.name).toBe("my-lib-registry");
		const registry = JSON.parse(readFileSync(join(tmpDir, "registry.json"), "utf-8"));
		expect(registry.name).toBe("my-lib");
	});

	it("patches JSON name fields even without placeholders (Next.js template)", () => {
		writeFileSync(
			join(tmpDir, "package.json"),
			JSON.stringify({ name: "registry", version: "0.1.0" }),
		);
		writeFileSync(
			join(tmpDir, "registry.json"),
			JSON.stringify({ name: "acme", homepage: "https://acme.com", items: [] }),
		);

		patchTemplateFiles(tmpDir, {
			registryName: "my-lib",
			sourceDir: "registry/new-york/blocks",
			hostname: "https://shadregistry.com",
		});

		const pkg = JSON.parse(readFileSync(join(tmpDir, "package.json"), "utf-8"));
		expect(pkg.name).toBe("my-lib-registry");
		expect(pkg.version).toBe("0.1.0"); // preserved

		const registry = JSON.parse(readFileSync(join(tmpDir, "registry.json"), "utf-8"));
		expect(registry.name).toBe("my-lib");
		expect(registry.homepage).toBe("https://acme.com"); // preserved
	});

	it("skips missing files gracefully", () => {
		// No files in tmpDir — should not throw
		expect(() =>
			patchTemplateFiles(tmpDir, {
				registryName: "my-lib",
				sourceDir: "registry/new-york/blocks",
				hostname: "https://shadregistry.com",
			}),
		).not.toThrow();
	});
});
