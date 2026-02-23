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
			};
			writeFileSync(pkgJsonPath, `${JSON.stringify(pkg, null, 2)}\n`);
			needsInstall = true;
		} else {
			log.warn(
				"package.json already exists — make sure the following are installed:\n" +
					"  npm install clsx tailwind-merge\n" +
					"  npm install -D shadcn react-dom vite @vitejs/plugin-react tailwindcss @tailwindcss/vite",
			);
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

		// Write vite.config.ts if it doesn't exist
		const viteConfigPath = join(cwd, "vite.config.ts");
		if (!existsSync(viteConfigPath)) {
			writeFileSync(viteConfigPath, generateViteConfig());
		}

		// Write .gitignore if it doesn't exist
		const gitignorePath = join(cwd, ".gitignore");
		if (!existsSync(gitignorePath)) {
			writeFileSync(gitignorePath, generateGitignore());
		}

		// Write preview app files
		const previewDir = resolve(cwd, "src/preview");
		if (!existsSync(previewDir)) {
			mkdirSync(previewDir, { recursive: true });
		}
		const previewFiles = [
			{ name: "index.html", content: generatePreviewHtml() },
			{ name: "globals.css", content: generatePreviewCss() },
			{ name: "main.tsx", content: generatePreviewMain() },
			{ name: "App.tsx", content: generatePreviewApp() },
			{ name: "registry.ts", content: generatePreviewRegistry() },
		];
		for (const file of previewFiles) {
			const filePath = join(previewDir, file.name);
			if (!existsSync(filePath)) {
				writeFileSync(filePath, file.content);
			}
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

// ── Preview app file generators ─────────────────────────────────

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
