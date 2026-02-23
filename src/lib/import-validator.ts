import { resolve, dirname } from "node:path";
import type { RegistryManifest, ProjectConfig } from "../types/index.js";
import { scanFileImports } from "./import-scanner.js";

export interface ImportWarning {
  itemName: string;
  filePath: string;
  importPath: string;
  severity: "error" | "warning";
  message: string;
}

/**
 * Validate that registry source files use @/ aliases instead of relative imports.
 * Relative imports break when components are installed into consumer projects.
 */
export function validateImports(
  manifest: RegistryManifest,
  config: ProjectConfig,
  cwd: string,
): ImportWarning[] {
  const warnings: ImportWarning[] = [];
  const sourceDirAbs = resolve(cwd, config.sourceDir);
  const itemNames = new Set(manifest.items.map((item) => item.name));

  for (const item of manifest.items) {
    for (const file of item.files) {
      const filePath = resolve(cwd, file.path);
      const imports = scanFileImports(filePath);

      for (const imp of imports) {
        if (!isRelativeImport(imp)) continue;

        // Resolve where this relative import points to
        const fileDir = dirname(filePath);
        const resolvedPath = resolve(fileDir, imp);

        // Check if it resolves to a different registry item's directory
        if (resolvedPath.startsWith(sourceDirAbs)) {
          const relative = resolvedPath.slice(sourceDirAbs.length + 1);
          const targetItemDir = relative.split("/")[0];

          if (targetItemDir && targetItemDir !== item.name && itemNames.has(targetItemDir)) {
            warnings.push({
              itemName: item.name,
              filePath: file.path,
              importPath: imp,
              severity: "error",
              message:
                `Cross-item relative import "${imp}" references item "${targetItemDir}". ` +
                `Use @/components/ui/${targetItemDir} instead for portability.`,
            });
            continue;
          }
        }

        // Check if relative import goes outside the source directory
        if (!resolvedPath.startsWith(sourceDirAbs)) {
          warnings.push({
            itemName: item.name,
            filePath: file.path,
            importPath: imp,
            severity: "warning",
            message:
              `Relative import "${imp}" resolves outside the registry source directory. ` +
              `Consider using an @/ alias for portability.`,
          });
        }
      }
    }
  }

  return warnings;
}

function isRelativeImport(importPath: string): boolean {
  return importPath.startsWith("./") || importPath.startsWith("../");
}
