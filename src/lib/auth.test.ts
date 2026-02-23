import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
	mkdtempSync,
	writeFileSync,
	readFileSync,
	mkdirSync,
	existsSync,
	rmSync,
	statSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Mock os.homedir() to point to our temp dir
let tmpDir: string;
vi.mock("node:os", async () => {
	const actual = await vi.importActual<typeof import("node:os")>("node:os");
	return {
		...actual,
		homedir: () => tmpDir,
	};
});

// Import after mock setup
import {
	readAuth,
	writeAuth,
	deleteAuth,
	resolveToken,
	resolveHostname,
	getTokenType,
} from "./auth.js";
import type { AuthConfig } from "../types/index.js";

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "auth-test-"));
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
	delete process.env.SHADREGISTRY_TOKEN;
});

const testAuth: AuthConfig = {
	token: "pat_testtoken123",
	user: { username: "testuser" },
	hostname: "https://example.com",
};

// ── readAuth ─────────────────────────────────────────────────────

describe("readAuth", () => {
	it("returns parsed AuthConfig when file exists", () => {
		const authDir = join(tmpDir, ".shadregistry");
		mkdirSync(authDir, { recursive: true });
		writeFileSync(
			join(authDir, "auth.json"),
			JSON.stringify(testAuth),
		);
		expect(readAuth()).toEqual(testAuth);
	});

	it("returns null when file does not exist", () => {
		expect(readAuth()).toBeNull();
	});

	it("returns null for invalid JSON", () => {
		const authDir = join(tmpDir, ".shadregistry");
		mkdirSync(authDir, { recursive: true });
		writeFileSync(join(authDir, "auth.json"), "not json{{{");
		expect(readAuth()).toBeNull();
	});
});

// ── writeAuth ────────────────────────────────────────────────────

describe("writeAuth", () => {
	it("creates directory and writes file", () => {
		writeAuth(testAuth);
		const authPath = join(tmpDir, ".shadregistry", "auth.json");
		expect(existsSync(authPath)).toBe(true);
		const content = JSON.parse(readFileSync(authPath, "utf-8"));
		expect(content).toEqual(testAuth);
	});

	it("writes file when directory already exists", () => {
		mkdirSync(join(tmpDir, ".shadregistry"), { recursive: true });
		writeAuth(testAuth);
		const authPath = join(tmpDir, ".shadregistry", "auth.json");
		const content = JSON.parse(readFileSync(authPath, "utf-8"));
		expect(content).toEqual(testAuth);
	});
});

// ── deleteAuth ───────────────────────────────────────────────────

describe("deleteAuth", () => {
	it("deletes existing file and returns true", () => {
		const authDir = join(tmpDir, ".shadregistry");
		mkdirSync(authDir, { recursive: true });
		writeFileSync(join(authDir, "auth.json"), "{}");
		expect(deleteAuth()).toBe(true);
		expect(existsSync(join(authDir, "auth.json"))).toBe(false);
	});

	it("returns false when file does not exist", () => {
		expect(deleteAuth()).toBe(false);
	});
});

// ── resolveToken ─────────────────────────────────────────────────

describe("resolveToken", () => {
	it("returns flag token with highest priority", () => {
		process.env.SHADREGISTRY_TOKEN = "env_token";
		writeAuth(testAuth);
		expect(resolveToken("flag_token")).toBe("flag_token");
	});

	it("returns env var when no flag token", () => {
		process.env.SHADREGISTRY_TOKEN = "env_token";
		writeAuth(testAuth);
		expect(resolveToken()).toBe("env_token");
	});

	it("returns auth file token when no flag or env", () => {
		writeAuth(testAuth);
		expect(resolveToken()).toBe("pat_testtoken123");
	});

	it("returns null when all absent", () => {
		expect(resolveToken()).toBeNull();
	});
});

// ── resolveHostname ──────────────────────────────────────────────

describe("resolveHostname", () => {
	it("returns flag hostname with highest priority", () => {
		writeAuth(testAuth);
		expect(resolveHostname("https://flag.com")).toBe("https://flag.com");
	});

	it("returns auth file hostname when no flag", () => {
		writeAuth(testAuth);
		expect(resolveHostname()).toBe("https://example.com");
	});

	it("returns default when no flag or auth file", () => {
		expect(resolveHostname()).toBe("https://shadregistry.com");
	});
});

// ── getTokenType ─────────────────────────────────────────────────

describe("getTokenType", () => {
	it("returns 'pat' for pat_ prefix", () => {
		expect(getTokenType("pat_abc123")).toBe("pat");
	});

	it("returns 'skey' for skey_ prefix", () => {
		expect(getTokenType("skey_xyz789")).toBe("skey");
	});

	it("returns 'unknown' for other tokens", () => {
		expect(getTokenType("random_token")).toBe("unknown");
	});
});
