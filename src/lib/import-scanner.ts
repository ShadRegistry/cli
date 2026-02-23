import { readFileSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import type { RegistryManifest, ProjectConfig } from "../types/index.js";

/**
 * Node built-in modules to skip (not real dependencies).
 */
const NODE_BUILTINS = new Set([
	"assert",
	"buffer",
	"child_process",
	"cluster",
	"crypto",
	"dgram",
	"dns",
	"events",
	"fs",
	"http",
	"http2",
	"https",
	"net",
	"os",
	"path",
	"perf_hooks",
	"querystring",
	"readline",
	"stream",
	"string_decoder",
	"timers",
	"tls",
	"tty",
	"url",
	"util",
	"v8",
	"vm",
	"worker_threads",
	"zlib",
]);

/**
 * Packages that are always present in the consumer's project
 * and should not be listed as dependencies.
 */
const SKIP_PACKAGES = new Set([
	"react",
	"react-dom",
	"react/jsx-runtime",
	"react/jsx-dev-runtime",
	"next",
]);

/**
 * Extract all import source strings from a TypeScript/JavaScript file.
 */
export function scanFileImports(filePath: string): string[] {
	let content: string;
	try {
		content = readFileSync(filePath, "utf-8");
	} catch {
		return [];
	}

	const imports: string[] = [];

	// Match: import ... from "source"
	// Match: export ... from "source"
	// Match: import "source" (side-effect)
	// Match: require("source")
	const importRegex =
		/(?:import|export)\s+(?:type\s+)?(?:\{[^}]*\}|[*\w][\w$]*(?:\s+as\s+\w[\w$]*)?)?\s*(?:,\s*(?:\{[^}]*\}|[*]\s+as\s+\w[\w$]*))?\s*(?:from\s+)?["']([^"']+)["']|require\s*\(\s*["']([^"']+)["']\s*\)/gm;

	let match: RegExpExecArray | null;
	while ((match = importRegex.exec(content)) !== null) {
		const source = match[1] || match[2];
		if (source) {
			imports.push(source);
		}
	}

	return [...new Set(imports)];
}

/**
 * Extract the npm package name from an import path.
 * "@scope/pkg/sub/path" → "@scope/pkg"
 * "pkg/sub/path" → "pkg"
 */
function extractPackageName(importPath: string): string {
	if (importPath.startsWith("@")) {
		// Scoped: @scope/pkg[/...]
		const parts = importPath.split("/");
		return parts.slice(0, 2).join("/");
	}
	// Unscoped: pkg[/...]
	return importPath.split("/")[0];
}

/**
 * Check if an import path is relative (starts with . or ..)
 */
function isRelativeImport(importPath: string): boolean {
	return importPath.startsWith("./") || importPath.startsWith("../");
}

/**
 * Check if an import path is a Node built-in.
 */
function isNodeBuiltin(importPath: string): boolean {
	if (importPath.startsWith("node:")) return true;
	return NODE_BUILTINS.has(extractPackageName(importPath));
}

/**
 * Check if an import path should be skipped (framework deps).
 */
function isSkipPackage(importPath: string): boolean {
	return SKIP_PACKAGES.has(importPath) || SKIP_PACKAGES.has(extractPackageName(importPath));
}

/**
 * Try to match a relative import to another registry item.
 * e.g., "../button/button" when imported from "registry/my-comp/my-comp.tsx"
 * and "button" exists in the registry.
 */
function matchRelativeToRegistryItem(
	importPath: string,
	filePath: string,
	sourceDir: string,
	itemNames: Set<string>,
	cwd: string,
): string | null {
	if (!isRelativeImport(importPath)) return null;

	const fileDir = dirname(filePath);
	const resolvedDir = resolve(cwd, fileDir, importPath);
	const sourceDirAbs = resolve(cwd, sourceDir);

	// Check if resolved path is inside the source directory
	if (!resolvedDir.startsWith(sourceDirAbs)) return null;

	// Extract the item directory name
	const relative = resolvedDir.slice(sourceDirAbs.length + 1);
	const itemDirName = relative.split("/")[0];

	if (itemDirName && itemNames.has(itemDirName)) {
		return itemDirName;
	}

	return null;
}

export interface ScanResult {
	dependencies: string[];
	registryDependencies: string[];
}

/**
 * Categorize a list of import paths into npm dependencies and registry dependencies.
 */
export function categorizeImports(
	imports: string[],
	itemNames: Set<string>,
	currentItemName: string,
	filePath: string,
	sourceDir: string,
	cwd: string,
): ScanResult {
	const dependencies = new Set<string>();
	const registryDependencies = new Set<string>();

	for (const imp of imports) {
		// Skip relative imports within the same component
		if (isRelativeImport(imp)) {
			// Check if it resolves to another registry item
			const match = matchRelativeToRegistryItem(
				imp,
				filePath,
				sourceDir,
				itemNames,
				cwd,
			);
			if (match && match !== currentItemName) {
				registryDependencies.add(match);
			}
			continue;
		}

		// Skip Node built-ins
		if (isNodeBuiltin(imp)) continue;

		// Skip framework packages
		if (isSkipPackage(imp)) continue;

		// Check if the import matches another registry item name
		const pkgName = extractPackageName(imp);
		if (itemNames.has(pkgName) && pkgName !== currentItemName) {
			registryDependencies.add(pkgName);
			continue;
		}

		// It's an npm dependency
		dependencies.add(pkgName);
	}

	return {
		dependencies: [...dependencies].sort(),
		registryDependencies: [...registryDependencies].sort(),
	};
}

/**
 * Scan all registry items and detect their dependencies.
 * Returns a map of item name → detected dependencies.
 */
export function scanRegistryItems(
	cwd: string,
	config: ProjectConfig,
	manifest: RegistryManifest,
): Map<string, ScanResult> {
	const itemNames = new Set(manifest.items.map((item) => item.name));
	const results = new Map<string, ScanResult>();

	for (const item of manifest.items) {
		const allDeps = new Set<string>();
		const allRegDeps = new Set<string>();

		for (const file of item.files) {
			const filePath = resolve(cwd, file.path);
			const imports = scanFileImports(filePath);
			const categorized = categorizeImports(
				imports,
				itemNames,
				item.name,
				file.path,
				config.sourceDir,
				cwd,
			);

			for (const dep of categorized.dependencies) allDeps.add(dep);
			for (const dep of categorized.registryDependencies)
				allRegDeps.add(dep);
		}

		results.set(item.name, {
			dependencies: [...allDeps].sort(),
			registryDependencies: [...allRegDeps].sort(),
		});
	}

	return results;
}

/**
 * Compare detected dependencies with what's currently in the manifest.
 * Returns only items where detected deps differ from current.
 */
export function findDepChanges(
	manifest: RegistryManifest,
	detected: Map<string, ScanResult>,
): Map<string, { current: ScanResult; detected: ScanResult }> {
	const changes = new Map<
		string,
		{ current: ScanResult; detected: ScanResult }
	>();

	for (const item of manifest.items) {
		const det = detected.get(item.name);
		if (!det) continue;

		const currentDeps = [...(item.dependencies ?? [])].sort();
		const currentRegDeps = [...(item.registryDependencies ?? [])].sort();

		const depsChanged =
			JSON.stringify(currentDeps) !== JSON.stringify(det.dependencies);
		const regDepsChanged =
			JSON.stringify(currentRegDeps) !==
			JSON.stringify(det.registryDependencies);

		if (depsChanged || regDepsChanged) {
			changes.set(item.name, {
				current: {
					dependencies: currentDeps,
					registryDependencies: currentRegDeps,
				},
				detected: det,
			});
		}
	}

	return changes;
}
