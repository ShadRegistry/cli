import { execSync } from "node:child_process";
import { Command } from "commander";
import ora from "ora";
import { log } from "../lib/logger.js";
import { getVersion } from "../lib/version.js";
import { checkForUpdate } from "../lib/update-check.js";

export const updateCommand = new Command("update")
	.description("Update the shadregistry CLI to the latest version")
	.option("--check", "Only check for updates without installing", false)
	.action(async (opts) => {
		const current = getVersion();

		const spinner = ora("Checking for updates...").start();
		const latestVersion = await checkForUpdate();
		spinner.stop();

		if (!latestVersion) {
			log.success(`Already up to date (v${current}).`);
			return;
		}

		log.info(`Current version:  v${current}`);
		log.info(`Latest version:   v${latestVersion}`);
		log.newline();

		if (opts.check) {
			log.info("Run `shadregistry update` to update.");
			return;
		}

		const pm = detectGlobalPackageManager();
		const command = getUpdateCommand(pm);

		log.info(`Updating via ${pm}...`);
		log.dim(`  $ ${command}`);
		log.newline();

		try {
			execSync(command, { stdio: "inherit" });
			log.newline();
			log.success(`Updated to v${latestVersion}.`);
		} catch {
			log.error("Update failed. Try running manually:");
			log.info(`  ${command}`);
			process.exit(1);
		}
	});

/**
 * Detect which package manager to use for global install.
 *
 * Strategy:
 * 1. Check npm_config_user_agent env var (set by npm/yarn/pnpm/bun)
 * 2. Probe which package managers are available on PATH (bun preferred)
 * 3. Fall back to npm
 */
function detectGlobalPackageManager(): "bun" | "npm" | "yarn" | "pnpm" {
	const userAgent = process.env.npm_config_user_agent ?? "";
	if (userAgent.startsWith("bun/")) return "bun";
	if (userAgent.startsWith("pnpm/")) return "pnpm";
	if (userAgent.startsWith("yarn/")) return "yarn";
	if (userAgent.startsWith("npm/")) return "npm";

	// Prefer bun per project conventions
	try {
		execSync("bun --version", { stdio: "pipe" });
		return "bun";
	} catch {}

	try {
		execSync("pnpm --version", { stdio: "pipe" });
		return "pnpm";
	} catch {}

	try {
		execSync("yarn --version", { stdio: "pipe" });
		return "yarn";
	} catch {}

	return "npm";
}

function getUpdateCommand(pm: "bun" | "npm" | "yarn" | "pnpm"): string {
	switch (pm) {
		case "bun":
			return "bun add -g @shadregistry/cli@latest";
		case "pnpm":
			return "pnpm add -g @shadregistry/cli@latest";
		case "yarn":
			return "yarn global add @shadregistry/cli@latest";
		case "npm":
			return "npm install -g @shadregistry/cli@latest";
	}
}
