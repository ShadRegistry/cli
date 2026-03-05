import { createInterface } from "node:readline";
import { Command } from "commander";
import ora from "ora";
import { ApiClient } from "../lib/api-client.js";
import { resolveHostname, resolveToken } from "../lib/auth.js";
import { runBuild } from "../lib/build.js";
import { readConfig, writeConfig } from "../lib/config.js";
import { DEFAULT_SOURCE_DIR } from "../lib/constants.js";
import { computeDiff, formatDiffSummary } from "../lib/diff-utils.js";
import { log } from "../lib/logger.js";
import { bundlePreviewCode } from "../lib/preview-bundler.js";
import {
	chunkItems,
	readBuildOutput,
	validatePayload,
} from "../lib/registry-builder.js";
import type { ItemPayload, PublishResult } from "../types/index.js";

export const publishCommand = new Command("publish")
	.description("Publish components to the remote registry")
	.option("--dry-run", "Show what would change without publishing", false)
	.option("--force", "Skip confirmation prompt", false)
	.option("--filter <names>", "Only publish specific items (comma-separated)")
	.option("--prune", "Delete remote items not present locally", false)
	.option("--token <token>", "Override auth token")
	.option("--output <dir>", "Build output directory", "public/r")
	.option("--skip-build", "Skip the automatic shadcn build step", false)
	.action(async (opts) => {
		const cwd = process.cwd();

		// Step 1: Resolve auth
		const token = resolveToken(opts.token);
		if (!token) {
			log.error(
				"Not authenticated. Run `shadr login` or set SHADREGISTRY_TOKEN.",
			);
			process.exit(2);
		}

		// Step 2: Read config (or create one if missing)
		let config = readConfig(cwd);
		if (!config) {
			log.warn("No shadregistry.config.json found.");
			const hostname = resolveHostname();
			const client = new ApiClient(hostname, token);

			let registryName: string | undefined;
			try {
				const { registries } = await client.get<{
					registries: Array<{
						name: string;
						displayName: string;
						isPrivate: boolean;
					}>;
				}>("/api/cli/registries");

				if (registries.length > 0) {
					log.info("Your registries:");
					registries.forEach((r, i) => {
						log.info(
							`  ${i + 1}. ${r.name} ${r.isPrivate ? "(private)" : "(public)"}`,
						);
					});
					log.info(`  ${registries.length + 1}. Enter a new name`);
					log.newline();

					const choice = await prompt("Select a registry (number): ");
					const idx = parseInt(choice, 10) - 1;

					if (idx >= 0 && idx < registries.length) {
						registryName = registries[idx].name;
					}
				}
			} catch {
				// If API fails, fall through to manual prompt
			}

			if (!registryName) {
				registryName = await prompt("Registry name: ");
			}
			if (!registryName) {
				log.error("Registry name is required.");
				process.exit(1);
			}

			config = {
				$schema: "https://shadregistry.com/schema/config.json",
				registry: registryName,
				sourceDir: DEFAULT_SOURCE_DIR,
				url: hostname,
			};
			writeConfig(config, cwd);
			log.success("Created shadregistry.config.json");
		}

		// Step 3: Build registry
		if (!opts.skipBuild) {
			const buildSpinner = ora("Building registry...").start();
			try {
				runBuild(cwd);
				buildSpinner.succeed("Registry built.");
			} catch (e: any) {
				buildSpinner.fail("Build failed.");
				log.error(e.message);
				process.exit(1);
			}
		}

		// Step 4: Read build output
		let payloads: ItemPayload[];
		try {
			payloads = readBuildOutput(cwd, opts.output);
		} catch (e: any) {
			log.error(e.message);
			process.exit(1);
		}

		if (payloads.length === 0) {
			log.warn("No items found in build output. Run `shadcn build` first.");
			process.exit(0);
		}

		// Bundle preview code for each item
		const bundleSpinner = ora("Bundling preview code...").start();
		let bundled = 0;
		for (const payload of payloads) {
			try {
				const bundle = await bundlePreviewCode(payload, cwd, config.sourceDir);
				if (bundle) {
					payload.previewBundle = bundle.js;
					if (bundle.css) payload.previewCss = bundle.css;
					bundled++;
				}
			} catch {
				// Non-fatal — continue without bundle
			}
		}
		bundleSpinner.stop();
		if (bundled > 0) {
			log.dim(`Bundled preview code for ${bundled} item${bundled !== 1 ? "s" : ""}`);
		}

		// Validate each payload
		for (const payload of payloads) {
			const err = validatePayload(payload);
			if (err) {
				log.error(err);
				process.exit(1);
			}
		}

		// Step 4: Apply filter
		if (opts.filter) {
			const filterNames = new Set(
				(opts.filter as string).split(",").map((s: string) => s.trim()),
			);
			payloads = payloads.filter((p) => filterNames.has(p.name));

			// Warn about unmatched filters
			for (const name of filterNames) {
				if (!payloads.some((p) => p.name === name)) {
					log.warn(`Filter name '${name}' does not match any built item.`);
				}
			}
		}

		// Step 5: Fetch remote state
		const hostname = resolveHostname();
		const client = new ApiClient(hostname, token);

		let remoteItems: ItemPayload[];
		const spinner = ora("Fetching remote state...").start();
		try {
			const data = await client.get<{ items: ItemPayload[] }>(
				`/api/cli/items?registry=${encodeURIComponent(config.registry)}`,
			);
			remoteItems = data.items;
			spinner.stop();
		} catch (e: any) {
			spinner.fail(`Failed to fetch remote items: ${e.message}`);
			process.exit(3);
		}

		// Step 6: Compute diff
		const diff = computeDiff(payloads, remoteItems);

		// Step 7: Display summary
		log.bold(`Publishing to @${config.registry}`);
		log.newline();
		log.info(formatDiffSummary(diff, config.registry));

		const totalToPublish = diff.newItems.length + diff.updatedItems.length;

		// Step 8: Dry run exit
		if (opts.dryRun) {
			process.exit(0);
		}

		if (
			totalToPublish === 0 &&
			(!opts.prune || diff.orphanedNames.length === 0)
		) {
			log.info("Nothing to publish.");
			process.exit(0);
		}

		// Step 9: Confirm
		if (!opts.force && totalToPublish > 0) {
			const answer = await prompt(
				`\nPublish ${totalToPublish} item${totalToPublish !== 1 ? "s" : ""}? (y/n) `,
			);
			if (answer.toLowerCase() !== "y") {
				log.info("Aborted.");
				process.exit(0);
			}
		}

		// Step 10: Upload
		if (totalToPublish > 0) {
			const itemsToPublish = [...diff.newItems, ...diff.updatedItems];
			const chunks = chunkItems(itemsToPublish);

			let totalCreated = 0;
			let totalUpdated = 0;
			const allErrors: Array<{ name: string; error: string }> = [];

			const uploadSpinner = ora("Publishing...").start();

			for (let i = 0; i < chunks.length; i++) {
				try {
					const result = await client.post<PublishResult>(
						"/api/cli/items/publish",
						{
							registry: config.registry,
							items: chunks[i],
						},
					);

					totalCreated += result.created;
					totalUpdated += result.updated;
					if (result.errors?.length) {
						allErrors.push(...result.errors);
					}
				} catch (e: any) {
					uploadSpinner.fail(`Upload failed: ${e.message}`);
					process.exit(3);
				}
			}

			uploadSpinner.stop();

			if (allErrors.length > 0) {
				const TIER_LIMIT_KEYWORDS = ["plan allows", "storage limit", "Upgrade"];
				const isTierLimitError = (msg: string) =>
					TIER_LIMIT_KEYWORDS.some((kw) => msg.includes(kw));

				const tierErrors: Array<{ name: string; error: string }> = [];
				const otherErrors: Array<{ name: string; error: string }> = [];
				for (const err of allErrors) {
					if (isTierLimitError(err.error)) {
						tierErrors.push(err);
					} else {
						otherErrors.push(err);
					}
				}

				if (tierErrors.length > 0) {
					// Group by unique error message and show count
					const grouped = new Map<string, string[]>();
					for (const err of tierErrors) {
						const names = grouped.get(err.error) ?? [];
						names.push(err.name);
						grouped.set(err.error, names);
					}
					log.warn("Some items failed due to plan limits:");
					for (const [message, names] of grouped) {
						log.error(`  ${names.length} item${names.length !== 1 ? "s" : ""} failed: ${message}`);
					}
					log.newline();
					log.info(`  Upgrade your plan: ${hostname}/dashboard/billing`);
				}

				if (otherErrors.length > 0) {
					log.warn("Some items had errors:");
					for (const err of otherErrors) {
						log.error(`  ${err.name}: ${err.error}`);
					}
				}
			}

			// Step 11: Prune
			if (opts.prune && diff.orphanedNames.length > 0) {
				if (!opts.force) {
					log.newline();
					log.info(
						`Deleting ${diff.orphanedNames.length} orphaned item${diff.orphanedNames.length !== 1 ? "s" : ""}: ${diff.orphanedNames.join(", ")}`,
					);
					const pruneAnswer = await prompt("Proceed? (y/n) ");
					if (pruneAnswer.toLowerCase() !== "y") {
						log.info("Skipped pruning.");
					} else {
						await pruneItems(client, config.registry, diff.orphanedNames);
					}
				} else {
					await pruneItems(client, config.registry, diff.orphanedNames);
				}
			}

			// Step 12: Success
			log.newline();
			log.success(
				`Published ${totalCreated + totalUpdated} item${totalCreated + totalUpdated !== 1 ? "s" : ""} to @${config.registry}`,
			);
			log.newline();

			for (const item of diff.newItems) {
				log.info(`  + ${item.name}  (created)`);
			}
			for (const item of diff.updatedItems) {
				log.info(`  ~ ${item.name}  (updated)`);
			}

			log.newline();
			log.dim(`Registry: ${hostname}/r/@${config.registry}/registry.json`);

			if (allErrors.length > 0) {
				process.exit(3);
			}
		} else if (opts.prune && diff.orphanedNames.length > 0) {
			// Only pruning, no publishes
			if (!opts.force) {
				log.newline();
				const pruneAnswer = await prompt(
					`Delete ${diff.orphanedNames.length} orphaned item${diff.orphanedNames.length !== 1 ? "s" : ""}? (y/n) `,
				);
				if (pruneAnswer.toLowerCase() !== "y") {
					log.info("Aborted.");
					process.exit(0);
				}
			}
			await pruneItems(client, config.registry, diff.orphanedNames);
			log.success(`Pruned ${diff.orphanedNames.length} orphaned items.`);
		}
	});

async function pruneItems(
	client: ApiClient,
	registry: string,
	names: string[],
) {
	try {
		await client.delete("/api/cli/items/delete", { registry, names });
	} catch (e: any) {
		log.error(`Failed to prune items: ${e.message}`);
	}
}

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
