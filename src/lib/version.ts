import { createRequire } from "node:module";

/**
 * Read version from the package.json at runtime.
 * Uses createRequire to resolve package.json relative to this file,
 * which works both in development (ts source) and production (bundled dist).
 */
export function getVersion(): string {
	try {
		const require = createRequire(import.meta.url);
		const pkg = require("../../package.json") as { version: string };
		return pkg.version;
	} catch {
		return "0.0.0";
	}
}
