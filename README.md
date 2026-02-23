# shadregistry

CLI for publishing and managing [shadcn](https://ui.shadcn.com)-compatible component registries on [ShadRegistry](https://shadregistry.com).

Built on top of the standard `shadcn build` command — ShadRegistry handles publishing, hosting, and DX tooling so you don't need your own server.

## Install

```bash
npx @shadregistry/cli
```

Or install globally:

```bash
npm install -g @shadregistry/cli
# or
bunx @shadregistry/cli
```

> **Tip:** Use `shadr` as a shorthand for `shadregistry` in all commands (e.g. `shadr dev --preview`).

## Quick Start

```bash
# Authenticate with your ShadRegistry account
shadregistry login

# Initialize a new registry project
shadregistry init

# Add a component
shadregistry add my-button

# Preview components in the browser (includes HMR)
shadregistry dev --preview

# Build the registry (uses shadcn's native build)
shadcn build

# Publish to ShadRegistry
shadregistry publish
```

## Commands

### `shadregistry login`

Authenticate with the ShadRegistry platform using a device authorization flow (similar to `gh auth login`).

```bash
shadregistry login              # Interactive device auth
echo "$TOKEN" | shadregistry login --with-token  # CI/CD with token from stdin
```

### `shadregistry logout`

Remove stored authentication credentials.

### `shadregistry init`

Initialize a shadcn-compatible registry project. Creates:

- `shadregistry.config.json` — where to publish (registry name, API URL)
- `registry.json` — what to publish (standard shadcn manifest format)
- `components.json` — shadcn configuration with `@/` path aliases
- `tsconfig.json` — with `baseUrl` and `@/*` path mapping
- `package.json` — with `shadcn` as a devDependency and `"build": "shadcn build"` script
- `src/registry/new-york/items/` — directory structure for component source files
- `src/lib/utils.ts` — `cn` helper function (with `clsx` and `tailwind-merge`)
- `src/preview/` — Vite + React preview app for rendering components during development
- `vite.config.ts` — Vite configuration with `@/` alias and Tailwind CSS v4

```bash
shadregistry init
shadregistry init --name my-registry --private
```

### `shadregistry add <name>`

Scaffold a new registry item locally and add it to `registry.json`. Files are placed in subdirectories matching the shadcn convention:

```bash
shadregistry add my-button                          # → src/registry/new-york/items/my-button/components/my-button.tsx
shadregistry add use-toggle --type registry:hook    # → src/registry/new-york/items/use-toggle/hooks/use-toggle.ts
shadregistry add helpers --type registry:lib        # → src/registry/new-york/items/helpers/lib/helpers.ts
shadregistry add my-block --type registry:block     # → src/registry/new-york/items/my-block/components/my-block.tsx
```

Templates include `@/` alias imports (e.g., `import { cn } from "@/lib/utils"`) for portability. Components are automatically registered in the preview app.

Supported types: `registry:component`, `registry:hook`, `registry:lib`, `registry:block`, `registry:page`, `registry:file`, `registry:style`, `registry:theme`

### `shadregistry dev`

Build and serve your registry locally for testing. Runs `shadcn build`, starts a local HTTP server with CORS headers, and watches for file changes.

```bash
shadregistry dev                      # Build, serve JSON on port 4200, watch for changes
shadregistry dev --preview            # Also launch Vite preview app on port 4201
shadregistry dev --port 3000          # Custom JSON server port
shadregistry dev --preview-port 3001  # Custom preview app port
shadregistry dev --no-watch           # Disable file watching
shadregistry dev --output dist/r      # Custom build output directory
```

With `--preview`, a Vite + React app opens at `http://localhost:4201` showing a gallery of all your components with hot module replacement.

Install components in a consumer project with:

```bash
npx shadcn@latest add http://localhost:4200/r/my-button.json
```

### `shadregistry scan`

Scan source files to auto-detect dependencies and validate import patterns.

```bash
shadregistry scan                     # Interactive — review and confirm changes
shadregistry scan --yes               # Auto-apply detected dependency changes
```

Detects npm dependencies and registry dependencies from import statements, and warns about relative imports that should use `@/` aliases.

### `shadregistry publish`

Publish components to the remote registry. Reads from the `shadcn build` output (`public/r/`), diffs against remote, and uploads changes.

> **Note:** Run `shadcn build` (or `npm run build`) before publishing.

```bash
shadregistry publish                  # Interactive confirmation
shadregistry publish --dry-run        # Preview only, no upload
shadregistry publish --force          # Skip confirmation (for CI)
shadregistry publish --prune          # Delete remote items not in local registry.json
shadregistry publish --filter a,b     # Publish only specific items
shadregistry publish --output dist/r  # Custom build output directory
```

### `shadregistry diff`

Show what would change if `publish` were run. Reads from the build output.

```bash
shadregistry diff
shadregistry diff --filter my-button
shadregistry diff --json
shadregistry diff --output dist/r     # Custom build output directory
```

### `shadregistry list [registry]`

List registries or items within a registry.

```bash
shadregistry list                     # List all your registries
shadregistry list my-registry         # List items in a registry
shadregistry list --json              # JSON output
```

## CI/CD

Use server API keys for automated publishing. Create a server key from the ShadRegistry dashboard and set it as a CI secret.

```yaml
# GitHub Actions example
- run: npx shadcn build && npx shadregistry publish --force
  env:
    SHADREGISTRY_TOKEN: ${{ secrets.SHADREGISTRY_TOKEN }}
```

### Token Resolution Order

1. `--token <token>` flag
2. `SHADREGISTRY_TOKEN` environment variable
3. `~/.shadregistry/auth.json` (from `shadregistry login`)

## Project Structure

After `shadregistry init`, your project will have:

```
my-registry/
  components.json                            # shadcn config (style, aliases, icon library)
  shadregistry.config.json                   # Where to publish (registry name, API URL)
  registry.json                              # What to publish (standard shadcn manifest)
  tsconfig.json                              # TypeScript config with @/* path aliases
  package.json                               # Includes shadcn + Vite devDeps, build script
  vite.config.ts                             # Vite config for preview app
  src/
    lib/
      utils.ts                               # cn() helper (clsx + tailwind-merge)
    preview/                                 # Vite + React preview app (dev only)
      index.html
      main.tsx
      App.tsx
      registry.ts                            # Component map (auto-updated by `add`)
      globals.css
    registry/
      new-york/
        items/
          my-button/
            components/
              my-button.tsx                  # Component source (uses @/ imports)
  public/
    r/                                       # Build output (generated by shadcn build)
      registry.json
      my-button.json
```

## License

MIT
