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

		// Download template or fall back to built-in generators
		const hadPackageJson = existsSync(join(cwd, "package.json"));
		const downloaded = await downloadTemplate(cwd, opts.template);
		if (downloaded) {
			patchTemplateFiles(cwd, { registryName, sourceDir, hostname });
		} else {
			generateFallbackFiles(cwd, registryName, sourceDir);
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
					"  npm install -D shadcn react-dom vite @vitejs/plugin-react tailwindcss @tailwindcss/vite",
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
		log.info(`  shadr add my-component    # Scaffold a new component`);
		log.info(`  shadr dev --preview       # Preview components in browser`);
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
		log.warn(
			`Failed to download template: ${e instanceof Error ? e.message : "Unknown error"}. Using built-in fallback.`,
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

function patchTemplateFiles(
	cwd: string,
	vars: { registryName: string; sourceDir: string; hostname: string },
): void {
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
}

function generateFallbackFiles(
	cwd: string,
	registryName: string,
	sourceDir: string,
): void {
	mkdirSync(join(cwd, "src/preview"), { recursive: true });
	mkdirSync(join(cwd, "src/lib"), { recursive: true });

	const w = (p: string, content: string) => {
		if (!existsSync(p)) {
			mkdirSync(join(p, ".."), { recursive: true });
			writeFileSync(p, content);
		}
	};

	w(join(cwd, ".gitignore"), generateGitignore());
	w(join(cwd, "components.json"), generateComponentsJson());
	w(join(cwd, "tsconfig.json"), generateTsconfig());
	w(join(cwd, "vite.config.ts"), generateViteConfig());
	w(join(cwd, "package.json"), generatePackageJson(registryName));
	w(join(cwd, "src/lib/utils.ts"), generateUtils());
	w(join(cwd, "src/preview/index.html"), generatePreviewHtml());
	w(join(cwd, "src/preview/globals.css"), generatePreviewCss());
	w(join(cwd, "src/preview/main.tsx"), generatePreviewMain());
	w(join(cwd, "src/preview/App.tsx"), generatePreviewApp());
	w(join(cwd, "src/preview/registry.ts"), generatePreviewRegistry());
}

// ── Built-in file generators (offline fallback) ─────────────────

function generateViteConfig(): string {
	return `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  root: "src/preview",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 4201,
  },
});
`;
}

function generatePreviewHtml(): string {
	return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Registry Preview</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
`;
}

function generatePreviewCss(): string {
	return `@import "tailwindcss";
`;
}

function generatePreviewMain(): string {
	return `import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./globals.css";
import { App } from "./App";

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
`;
}

function generatePreviewApp(): string {
	return `import { Suspense, useState } from "react";
import { components } from "./registry";

export function App() {
  const names = Object.keys(components);
  const [active, setActive] = useState<string>(names[0] ?? "");

  const ActiveComponent = active ? components[active] : null;

  return (
    <div style={{ minHeight: "100vh", fontFamily: "system-ui, sans-serif" }}>
      <header style={{ borderBottom: "1px solid #e5e7eb", padding: "16px 24px" }}>
        <h1 style={{ fontSize: "18px", fontWeight: 600, margin: 0 }}>Registry Preview</h1>
      </header>
      <div style={{ display: "flex" }}>
        <nav style={{ width: "220px", borderRight: "1px solid #e5e7eb", padding: "16px" }}>
          {names.length === 0 && (
            <p style={{ fontSize: "14px", color: "#6b7280" }}>
              No components yet. Run:<br />
              <code>shadregistry add my-component</code>
            </p>
          )}
          {names.map((name) => (
            <button
              type="button"
              key={name}
              onClick={() => setActive(name)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "6px 12px",
                borderRadius: "6px",
                border: "none",
                cursor: "pointer",
                fontSize: "14px",
                marginBottom: "4px",
                background: active === name ? "#f3f4f6" : "transparent",
                fontWeight: active === name ? 600 : 400,
              }}
            >
              {name}
            </button>
          ))}
        </nav>
        <main style={{ flex: 1, padding: "32px" }}>
          {ActiveComponent ? (
            <Suspense fallback={<div>Loading...</div>}>
              <ActiveComponent />
            </Suspense>
          ) : (
            <p style={{ color: "#6b7280" }}>Select a component</p>
          )}
        </main>
      </div>
    </div>
  );
}
`;
}

function generateGitignore(): string {
	return `node_modules/
dist/
public/r/
`;
}

function generatePreviewRegistry(): string {
	return `import { lazy, type ComponentType } from "react";

export const components: Record<string, React.LazyExoticComponent<ComponentType>> = {
  // Components are added here by \`shadregistry add\`
};
`;
}

function generateComponentsJson(): string {
	return `${JSON.stringify(
		{
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
		},
		null,
		2,
	)}\n`;
}

function generateTsconfig(): string {
	return `${JSON.stringify(
		{
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
				paths: { "@/*": ["./src/*"] },
			},
			include: ["src/**/*.ts", "src/**/*.tsx"],
		},
		null,
		2,
	)}\n`;
}

function generatePackageJson(registryName: string): string {
	return `${JSON.stringify(
		{
			name: `${registryName}-registry`,
			private: true,
			scripts: {
				build: "shadcn build",
				dev: "shadregistry dev --preview",
			},
			dependencies: {
				clsx: "^2.1.1",
				"tailwind-merge": "^3.0.0",
			},
			devDependencies: {
				react: "^19.0.0",
				"react-dom": "^19.0.0",
				"@types/react": "^19.0.0",
				"@types/react-dom": "^19.0.0",
				typescript: "^5.0.0",
				shadcn: "^3.0.0",
				vite: "^6.0.0",
				"@vitejs/plugin-react": "^4.0.0",
				tailwindcss: "^4.0.0",
				"@tailwindcss/vite": "^4.0.0",
			},
		},
		null,
		2,
	)}\n`;
}

function generateUtils(): string {
	return `import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
`;
}
