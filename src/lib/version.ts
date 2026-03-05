declare const __PKG_VERSION__: string;

/**
 * Read version from build-time define, with runtime fallback.
 */
export function getVersion(): string {
	if (typeof __PKG_VERSION__ !== "undefined") return __PKG_VERSION__;
	try {
		const { createRequire } = require("node:module");
		const r = createRequire(import.meta.url);
		return (r("../../package.json") as { version: string }).version;
	} catch {
		return "0.0.0";
	}
}
