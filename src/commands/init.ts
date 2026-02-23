import { execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { Command } from "commander";
import { ApiClient } from "../lib/api-client.js";
import { resolveHostname, resolveToken } from "../lib/auth.js";
import {
	configExists,
	manifestExists,
	writeConfig,
	writeManifest,
} from "../lib/config.js";
import { DEFAULT_SOURCE_DIR } from "../lib/constants.js";
import { log } from "../lib/logger.js";

export const initCommand = new Command("init")
	.description("Initialize a local registry project")
	.option("--name <name>", "Registry name")
	.option("--display-name <name>", "Human-readable display name")
	.option("--private", "Mark registry as private", false)
	.option(
		"--source-dir <dir>",
		"Source directory for components",
		DEFAULT_SOURCE_DIR,
	)
	.option("-y, --yes", "Accept all defaults", false)
	.action(async (opts) => {
		const cwd = process.cwd();

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
							`  ${i + 1}. ${r.name} ${r.isPrivate ? "(private)" : "(public)"}`,
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

					// Create on remote
					try {
						await client.post("/api/cli/registries/create", {
							name: registryName,
							displayName,
							isPrivate,
						});
						log.success(`Created registry @${registryName}`);
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

		// Write config
		writeConfig(
			{
				$schema: "https://shadregistry.com/schema/config.json",
				registry: registryName,
				sourceDir,
				url: hostname,
			},
			cwd,
		);

		// Write registry.json if it doesn't exist
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

		// Create src/lib/utils.ts (cn helper used by component templates)
		const utilsDir = resolve(cwd, "src/lib");
		if (!existsSync(utilsDir)) {
			mkdirSync(utilsDir, { recursive: true });
		}
		const utilsPath = join(utilsDir, "utils.ts");
		if (!existsSync(utilsPath)) {
			writeFileSync(
				utilsPath,
				[
					'import { type ClassValue, clsx } from "clsx";',
					'import { twMerge } from "tailwind-merge";',
					"",
					"export function cn(...inputs: ClassValue[]) {",
					"  return twMerge(clsx(inputs));",
					"}",
					"",
				].join("\n"),
			);
		}

		// Write components.json if it doesn't exist (required by shadcn build)
		const componentsJsonPath = join(cwd, "components.json");
		if (!existsSync(componentsJsonPath)) {
			const componentsJson = {
				$schema: "https://ui.shadcn.com/schema.json",
				style: "new-york",
				rsc: false,
				tsx: true,
				tailwind: {
					config: "",
					css: "",
					baseColor: "neutral",
					cssVariables: true,
					prefix: "",
				},
				aliases: {
					components: "@/components",
					utils: "@/lib/utils",
					ui: "@/components/ui",
					lib: "@/lib",
					hooks: "@/hooks",
				},
				iconLibrary: "lucide",
			};
			writeFileSync(
				componentsJsonPath,
				`${JSON.stringify(componentsJson, null, 2)}\n`,
			);
		}

		// Write package.json if it doesn't exist
		const pkgJsonPath = join(cwd, "package.json");
		let needsInstall = false;
		if (!existsSync(pkgJsonPath)) {
			const pkg = {
				name: `${registryName}-registry`,
				private: true,
				scripts: {
					build: "shadcn build",
				},
				dependencies: {
					clsx: "^2.1.1",
					"tailwind-merge": "^3.0.0",
				},
				devDependencies: {
					react: "^19.0.0",
					"@types/react": "^19.0.0",
					typescript: "^5.0.0",
					shadcn: "^3.0.0",
				},
			};
			writeFileSync(pkgJsonPath, `${JSON.stringify(pkg, null, 2)}\n`);
			needsInstall = true;
		}

		// Write tsconfig.json if it doesn't exist
		const tsconfigPath = join(cwd, "tsconfig.json");
		if (!existsSync(tsconfigPath)) {
			const tsconfig = {
				compilerOptions: {
					target: "ES2020",
					module: "ESNext",
					moduleResolution: "bundler",
					jsx: "react-jsx",
					strict: true,
					esModuleInterop: true,
					skipLibCheck: true,
					noEmit: true,
					baseUrl: ".",
					paths: {
						"@/*": ["./src/*"],
					},
				},
				include: ["src/**/*.ts", "src/**/*.tsx"],
			};
			writeFileSync(tsconfigPath, `${JSON.stringify(tsconfig, null, 2)}\n`);
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
		log.info(`  shadregistry add my-component    # Scaffold a new component`);
		log.info(`  shadcn build                     # Build the registry`);
		log.info(`  shadregistry dev                 # Preview locally`);
		log.info(`  shadregistry publish              # Publish to the registry`);
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
