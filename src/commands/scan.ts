import { Command } from "commander";
import { createInterface } from "node:readline";
import { log } from "../lib/logger.js";
import { readConfig, readManifest, writeManifest } from "../lib/config.js";
import {
	scanRegistryItems,
	findDepChanges,
} from "../lib/import-scanner.js";
import { validateImports } from "../lib/import-validator.js";
import pc from "picocolors";

export const scanCommand = new Command("scan")
	.description(
		"Scan source files and auto-detect dependencies for registry items",
	)
	.option("-y, --yes", "Accept all detected dependencies without prompting", false)
	.action(async (opts) => {
		const cwd = process.cwd();

		// Read config
		const config = readConfig(cwd);
		if (!config) {
			log.error(
				"No shadregistry.config.json found. Run `shadregistry init` first.",
			);
			process.exit(1);
		}

		// Read manifest
		const manifest = readManifest(cwd);
		if (!manifest || manifest.items.length === 0) {
			log.warn(
				"No items in registry.json. Run `shadregistry add <name>` first.",
			);
			process.exit(0);
		}

		// Run import validation
		const importWarnings = validateImports(manifest, config, cwd);
		if (importWarnings.length > 0) {
			log.bold("Import warnings:");
			log.newline();
			for (const w of importWarnings) {
				const prefix = w.severity === "error" ? pc.red("error") : pc.yellow("warn");
				log.info(`  ${prefix} ${pc.dim(w.filePath)}`);
				log.info(`    ${w.message}`);
			}
			log.newline();

			const errors = importWarnings.filter((w) => w.severity === "error");
			if (errors.length > 0) {
				log.warn(
					`${errors.length} import error${errors.length !== 1 ? "s" : ""} found. ` +
					`These relative imports will break in consumer projects.`,
				);
				log.newline();
			}
		}

		// Scan all items
		log.info("Scanning source files for imports...");
		log.newline();

		const detected = scanRegistryItems(cwd, config, manifest);
		const changes = findDepChanges(manifest, detected);

		if (changes.size === 0 && importWarnings.length === 0) {
			log.success("All dependencies in registry.json are up to date.");
			return;
		}

		if (changes.size === 0) {
			log.success("All dependencies in registry.json are up to date.");
			return;
		}

		// Display detected changes
		for (const [name, { current, detected: det }] of changes) {
			log.bold(`  ${name}:`);

			if (det.dependencies.length > 0) {
				const added = det.dependencies.filter(
					(d) => !current.dependencies.includes(d),
				);
				const removed = current.dependencies.filter(
					(d) => !det.dependencies.includes(d),
				);

				if (added.length > 0 || removed.length > 0) {
					let line = "    dependencies:         ";
					const parts: string[] = [];
					for (const d of det.dependencies) {
						if (added.includes(d)) {
							parts.push(pc.green(`+${d}`));
						} else {
							parts.push(d);
						}
					}
					for (const d of removed) {
						parts.push(pc.red(`-${d}`));
					}
					log.info(line + parts.join(", "));
				} else {
					log.info(
						`    dependencies:         ${det.dependencies.join(", ")}`,
					);
				}
			} else if (current.dependencies.length > 0) {
				log.info(
					`    dependencies:         ${current.dependencies.map((d) => pc.red(`-${d}`)).join(", ")}`,
				);
			}

			if (det.registryDependencies.length > 0) {
				const added = det.registryDependencies.filter(
					(d) => !current.registryDependencies.includes(d),
				);
				const removed = current.registryDependencies.filter(
					(d) => !det.registryDependencies.includes(d),
				);

				if (added.length > 0 || removed.length > 0) {
					let line = "    registryDependencies: ";
					const parts: string[] = [];
					for (const d of det.registryDependencies) {
						if (added.includes(d)) {
							parts.push(pc.green(`+${d}`));
						} else {
							parts.push(d);
						}
					}
					for (const d of removed) {
						parts.push(pc.red(`-${d}`));
					}
					log.info(line + parts.join(", "));
				} else {
					log.info(
						`    registryDependencies: ${det.registryDependencies.join(", ")}`,
					);
				}
			} else if (current.registryDependencies.length > 0) {
				log.info(
					`    registryDependencies: ${current.registryDependencies.map((d) => pc.red(`-${d}`)).join(", ")}`,
				);
			}

			log.newline();
		}

		// Ask for confirmation
		if (!opts.yes) {
			const answer = await prompt(
				`Update registry.json with detected dependencies? (y/n) `,
			);
			if (answer.toLowerCase() !== "y") {
				log.info("Aborted.");
				return;
			}
		}

		// Apply changes
		for (const [name, { detected: det }] of changes) {
			const item = manifest.items.find((i) => i.name === name);
			if (!item) continue;

			if (det.dependencies.length > 0) {
				item.dependencies = det.dependencies;
			} else {
				delete item.dependencies;
			}

			if (det.registryDependencies.length > 0) {
				item.registryDependencies = det.registryDependencies;
			} else {
				delete item.registryDependencies;
			}
		}

		writeManifest(manifest, cwd);
		log.success(
			`Updated ${changes.size} item${changes.size !== 1 ? "s" : ""} in registry.json`,
		);
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
