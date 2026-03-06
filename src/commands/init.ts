import { execSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import https from "node:https";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { tmpdir } from "node:os";
import { Command } from "commander";
import { ApiClient } from "../lib/api-client.js";
import { resolveHostname, resolveToken } from "../lib/auth.js";
import {
	configExists,
	manifestExists,
	writeConfig,
	writeManifest,
} from "../lib/config.js";
import { DEFAULT_SOURCE_DIR, DEFAULT_TEMPLATE } from "../lib/constants.js";
import { log } from "../lib/logger.js";

export const initCommand = new Command("init")
	.description("Initialize a local registry project")
	.argument("[directory]", "Directory to create the project in (defaults to current directory)")
	.option("--name <name>", "Registry name")
	.option("--display-name <name>", "Human-readable display name")
	.option("--private", "Mark registry as private", false)
	.option(
		"--source-dir <dir>",
		"Source directory for components",
		DEFAULT_SOURCE_DIR,
	)
	.option(
		"--template <repo>",
		"GitHub repo to use as template (e.g., user/repo)",
		DEFAULT_TEMPLATE,
	)
	.option("-y, --yes", "Accept all defaults", false)
	.action(async (directory: string | undefined, opts) => {
		let cwd: string;

		if (directory) {
			cwd = resolve(process.cwd(), directory);
		} else if (!opts.yes) {
			const dir = await prompt("Project directory (. for current): ");
			cwd = dir && dir !== "."
				? resolve(process.cwd(), dir)
				: process.cwd();
		} else {
			cwd = process.cwd();
		}

		if (cwd !== process.cwd()) {
			if (existsSync(cwd) && readdirSync(cwd).length > 0) {
				if (!opts.yes) {
					const cont = await prompt(
						`Directory ${directory ?? cwd} already exists and is not empty. Continue? (y/n) `,
					);
					if (cont.toLowerCase() !== "y") {
						log.info("Aborted.");
						return;
					}
				}
			}
			mkdirSync(cwd, { recursive: true });
			log.info(`Creating project in ${cwd}`);
		}

		// Check existing config
		if (configExists(cwd) && !opts.yes) {
			const overwrite = await prompt(
				"A shadregistry.config.json already exists. Overwrite? (y/n) ",
			);
			if (overwrite.toLowerCase() !== "y") {
				log.info("Aborted.");
				return;
			}
		}

		const token = resolveToken();
		const hostname = resolveHostname();
		let registryName = opts.name;
		let displayName = opts.displayName;
		let isPrivate = opts.private;
		const sourceDir = opts.sourceDir;

		if (token) {
			// Authenticated — offer to select or create a registry
			const client = new ApiClient(hostname, token);

			try {
				const { registries } = await client.get<{
					registries: Array<{
						name: string;
						displayName: string;
						isPrivate: boolean;
					organization: string | null;
					}>;
				}>("/api/cli/registries");

				let needsRemoteCreate = false;

				const existingRegistry = registryName
					? registries.find((r) => r.name === registryName)
					: undefined;

				if (existingRegistry) {
					// --name matches an existing remote registry — use it
					displayName = displayName ?? existingRegistry.displayName;
					isPrivate = existingRegistry.isPrivate;
					log.success(`Using existing registry @${registryName}`);
				} else if (registryName) {
					// --name provided but doesn't exist remotely — need to create it
					needsRemoteCreate = true;
				} else if (registries.length > 0) {
					// No --name flag and user has registries — let them pick
					log.info("Your registries:");
					registries.forEach((r, i) => {
						log.info(
							`  ${i + 1}. ${r.name}${r.organization ? ` [${r.organization}]` : ""} ${r.isPrivate ? "(private)" : "(public)"}`,
						);
					});
					log.info(`  ${registries.length + 1}. Create a new registry`);
					log.newline();

					const choice = await prompt("Select a registry (number): ");
					const idx = parseInt(choice, 10) - 1;

					if (idx >= 0 && idx < registries.length) {
						registryName = registries[idx].name;
						displayName = registries[idx].displayName;
						isPrivate = registries[idx].isPrivate;
					} else {
						needsRemoteCreate = true;
					}
				} else {
					// No registries at all — need to create one
					needsRemoteCreate = true;
				}

				if (needsRemoteCreate) {
					if (!registryName) {
						registryName = await prompt("Registry name: ");
					}
					if (!displayName) {
						if (opts.yes) {
							displayName = toTitleCase(registryName);
						} else {
							displayName = await prompt(
								`Display name (${toTitleCase(registryName)}): `,
							);
							if (!displayName) displayName = toTitleCase(registryName);
						}
					}
					if (!opts.private && !opts.yes) {
						const privAnswer = await prompt("Private? (y/n, default: n): ");
						isPrivate = privAnswer.toLowerCase() === "y";
					}

					// Ask if user wants to create under an org
					let selectedOrg: string | undefined;
					if (!opts.yes) {
						const orgNames = [
							...new Set(
								registries
									.filter((r) => r.organization)
									.map((r) => r.organization!),
							),
						];
						if (orgNames.length > 0) {
							log.info("Create under:");
							log.info("  0. Personal (your account)");
							orgNames.forEach((o, i) => {
								log.info(`  ${i + 1}. ${o}`);
							});
							const orgChoice = await prompt("Select (number, default: 0): ");
							const orgIdx = parseInt(orgChoice, 10);
							if (orgIdx > 0 && orgIdx <= orgNames.length) {
								selectedOrg = orgNames[orgIdx - 1];
							}
						}
					}

					// Create on remote
					try {
						await client.post("/api/cli/registries/create", {
							name: registryName,
							displayName,
							isPrivate,
							...(selectedOrg ? { organization: selectedOrg } : {}),
						});
						const label = selectedOrg
							? `@${selectedOrg}/${registryName}`
							: `@${registryName}`;
						log.success(`Created registry ${label}`);
					} catch (e: unknown) {
						log.error(
							`Failed to create registry: ${e instanceof Error ? e.message : "Unknown error"}`,
						);
						process.exit(1);
					}
				}
			} catch {
				log.warn(
					"Could not fetch registries. Continuing with local-only setup.",
				);
			}
		}

		// Interactive prompts for unauthenticated users
		if (!registryName) {
			registryName = await prompt("Registry name: ");
		}
		if (!displayName) {
			displayName = toTitleCase(registryName);
		}

		const templateRepo = opts.template;

		// Write config (before download so template won't overwrite it)
		writeConfig(
			{
				$schema: "https://shadregistry.com/schema/config.json",
				registry: registryName,
				sourceDir,
				url: hostname,
			},
			cwd,
		);

		// Download template
		const hadPackageJson = existsSync(join(cwd, "package.json"));
		const downloaded = await downloadTemplate(cwd, templateRepo);
		if (downloaded) {
			patchTemplateFiles(cwd, { registryName, sourceDir, hostname });
		} else {
			log.error("Failed to download template. Please check your internet connection and try again.");
			process.exit(1);
		}

		// Write registry.json if it doesn't exist (always use writeManifest for consistency)
		if (!manifestExists(cwd)) {
			writeManifest(
				{
					$schema: "https://ui.shadcn.com/schema/registry.json",
					name: registryName,
					homepage: "",
					items: [],
				},
				cwd,
			);
		}

		// Create source directory
		const srcDir = resolve(cwd, sourceDir);
		if (!existsSync(srcDir)) {
			mkdirSync(srcDir, { recursive: true });
		}

		// Warn about deps if package.json already existed
		const needsInstall = !hadPackageJson && existsSync(join(cwd, "package.json"));
		if (hadPackageJson) {
			log.warn(
				"package.json already exists — make sure the following are installed:\n" +
					"  npm install clsx tailwind-merge\n" +
					"  npm install -D shadcn",
			);
		}

		// Auto-install dependencies if we created package.json
		if (needsInstall) {
			const pm = detectPackageManager(cwd);
			log.info(`Installing dependencies with ${pm}...`);
			try {
				execSync(`${pm} install`, { cwd, stdio: "pipe" });
			} catch {
				log.warn(
					`Could not auto-install. Run \`${pm} install\` manually.`,
				);
			}
		}

		log.newline();
		log.success("Initialized shadregistry project.");
		log.newline();
		log.info("Next steps:");
		if (cwd !== process.cwd()) {
			const relative = directory ?? cwd;
			log.info(`  cd ${relative}`);
		}
		log.info(`  shadr add my-component    # Scaffold a new component`);
		log.info(`  npm run dev               # Start Next.js dev server`);
		log.info(`  shadcn build              # Build the registry`);
		log.info(`  shadr publish             # Publish to the registry`);
		log.newline();
		log.dim("  Tip: shadr is short for shadregistry");
	});

function prompt(question: string): Promise<string> {
	const rl = createInterface({
		input: process.stdin,
		output: process.stdout,
	});
	return new Promise((resolve) => {
		rl.question(question, (answer) => {
			rl.close();
			resolve(answer.trim());
		});
	});
}

function toTitleCase(str: string): string {
	return str
		.split("-")
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(" ");
}

function detectPackageManager(cwd: string): string {
	if (
		existsSync(join(cwd, "bun.lock")) ||
		existsSync(join(cwd, "bun.lockb"))
	)
		return "bun";
	if (existsSync(join(cwd, "pnpm-lock.yaml"))) return "pnpm";
	if (existsSync(join(cwd, "yarn.lock"))) return "yarn";
	return "npm";
}

// ── Template download & patching ────────────────────────────────

async function downloadTemplate(
	cwd: string,
	templateRepo: string,
): Promise<boolean> {
	const tarballUrl = templateRepo.startsWith("http")
		? templateRepo
		: `https://github.com/${templateRepo}/archive/main.tar.gz`;

	const tmp = join(tmpdir(), `shadr-template-${Date.now()}`);
	const tarPath = join(tmp, "template.tar.gz");

	try {
		mkdirSync(tmp, { recursive: true });

		// Download tarball
		await new Promise<void>((resolve, reject) => {
			const follow = (url: string, redirects = 0) => {
				if (redirects > 5) {
					reject(new Error("Too many redirects"));
					return;
				}
				https
					.get(url, (resp) => {
						if (
							resp.statusCode === 301 ||
							resp.statusCode === 302
						) {
							const loc = resp.headers.location;
							if (!loc) {
								reject(new Error("Redirect without location"));
								return;
							}
							resp.resume();
							follow(loc, redirects + 1);
							return;
						}
						if (!resp.statusCode || resp.statusCode >= 400) {
							reject(new Error(`HTTP ${resp.statusCode}`));
							return;
						}
						const chunks: Buffer[] = [];
						resp.on("data", (c: Buffer) => chunks.push(c));
						resp.on("end", () => {
							writeFileSync(tarPath, Buffer.concat(chunks));
							resolve();
						});
						resp.on("error", reject);
					})
					.on("error", reject);
			};
			follow(tarballUrl);
		});

		// Extract tarball
		execSync(`tar xzf "${tarPath}" -C "${tmp}"`, { stdio: "pipe" });

		// Find extracted directory (e.g. "registry-template-main")
		const dirs = readdirSync(tmp).filter(
			(e) =>
				e !== "template.tar.gz" &&
				statSync(join(tmp, e)).isDirectory(),
		);
		if (dirs.length === 0)
			throw new Error("No directory found in archive");
		const extracted = join(tmp, dirs[0]);

		// Copy files to cwd, skip existing
		copyDirRecursive(extracted, cwd);

		log.success("Downloaded template from GitHub.");
		return true;
	} catch (e: unknown) {
		log.error(
			`Failed to download template: ${e instanceof Error ? e.message : "Unknown error"}.`,
		);
		return false;
	} finally {
		try {
			rmSync(tmp, { recursive: true, force: true });
		} catch {}
	}
}

function copyDirRecursive(src: string, dest: string): void {
	for (const entry of readdirSync(src)) {
		const srcPath = join(src, entry);
		const destPath = join(dest, entry);
		if (statSync(srcPath).isDirectory()) {
			if (!existsSync(destPath))
				mkdirSync(destPath, { recursive: true });
			copyDirRecursive(srcPath, destPath);
		} else if (!existsSync(destPath)) {
			mkdirSync(join(destPath, ".."), { recursive: true });
			copyFileSync(srcPath, destPath);
		}
	}
}

export function patchTemplateFiles(
	cwd: string,
	vars: { registryName: string; sourceDir: string; hostname: string },
): void {
	// Placeholder-based patching (for Vite template compatibility)
	const replacements: Record<string, string> = {
		"{{REGISTRY_NAME}}": vars.registryName,
		"{{SOURCE_DIR}}": vars.sourceDir,
		"{{API_URL}}": vars.hostname,
	};

	for (const file of [
		"package.json",
		"shadregistry.config.json",
		"registry.json",
	]) {
		const p = join(cwd, file);
		if (!existsSync(p)) continue;
		let content = readFileSync(p, "utf-8");
		for (const [placeholder, value] of Object.entries(replacements)) {
			content = content.replaceAll(placeholder, value);
		}
		writeFileSync(p, content);
	}

	// JSON field patching (works for any template, including Next.js)
	patchJsonField(join(cwd, "package.json"), "name", `${vars.registryName}-registry`);
	patchJsonField(join(cwd, "registry.json"), "name", vars.registryName);
}

function patchJsonField(filePath: string, field: string, value: string): void {
	if (!existsSync(filePath)) return;
	try {
		const content = readFileSync(filePath, "utf-8");
		const json = JSON.parse(content);
		json[field] = value;
		writeFileSync(filePath, JSON.stringify(json, null, 2) + "\n");
	} catch {
		// If the file isn't valid JSON, skip silently
	}
}

