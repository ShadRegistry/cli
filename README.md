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

> **Tip:** Use `shadr` as a shorthand for `shadregistry` in all commands (e.g. `shadr dev`, `shadr publish`).

## Quick Start

```bash
# Authenticate with your ShadRegistry account
shadregistry login

# Initialize a new registry project (uses official shadcn template)
shadregistry init

# Add a component
shadregistry add my-button

# Preview components locally
npm run dev

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

Initialize a shadcn-compatible registry project using the official [shadcn registry template](https://github.com/shadcn-ui/registry-template). Creates a Next.js app with everything you need to develop and publish components.

Adds `shadregistry.config.json` on top of the official template to configure where to publish (registry name, API URL).

```bash
shadregistry init
shadregistry init --name my-registry --private
shadregistry init --template myorg/my-template  # Use a custom template
```

### `shadregistry add <name>`

Scaffold a new registry item locally and add it to `registry.json`. Files are placed in subdirectories matching the shadcn convention:

```bash
shadregistry add my-button                          # → registry/new-york/blocks/my-button/components/my-button.tsx
shadregistry add use-toggle --type registry:hook    # → registry/new-york/blocks/use-toggle/hooks/use-toggle.ts
shadregistry add helpers --type registry:lib        # → registry/new-york/blocks/helpers/lib/helpers.ts
shadregistry add my-block --type registry:block     # → registry/new-york/blocks/my-block/components/my-block.tsx
```

Templates include `@/` alias imports (e.g., `import { cn } from "@/lib/utils"`) for portability.

Supported types: `registry:component`, `registry:hook`, `registry:lib`, `registry:block`, `registry:page`, `registry:file`, `registry:style`, `registry:theme`

### `shadregistry dev`

Build and serve your registry locally for testing. Runs `shadcn build`, starts a local HTTP server with CORS headers, and watches for file changes.

```bash
shadregistry dev                      # Build, serve JSON on port 4200, watch for changes
shadregistry dev --port 3000          # Custom JSON server port
shadregistry dev --no-watch           # Disable file watching
shadregistry dev --output dist/r      # Custom build output directory
```

> **Tip:** Use `npm run dev` to start the Next.js dev server for previewing components locally.

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

After `shadregistry init`, your project uses the [official shadcn registry template](https://github.com/shadcn-ui/registry-template) — a Next.js app with an additional `shadregistry.config.json` for publishing:

```
my-registry/
  shadregistry.config.json                   # Where to publish (registry name, API URL)
  registry.json                              # What to publish (standard shadcn manifest)
  components.json                            # shadcn config (style, aliases, icon library)
  next.config.ts                             # Next.js configuration
  package.json                               # Next.js + shadcn dependencies
  tsconfig.json                              # TypeScript config with @/* path aliases
  app/                                       # Next.js app (preview & dev server)
  components/                                # Shared components
  lib/
    utils.ts                                 # cn() helper (clsx + tailwind-merge)
  registry/
    new-york/
      my-button.tsx                          # Component source (uses @/ imports)
  public/
    r/                                       # Build output (generated by shadcn build)
      my-button.json
```

## License

MIT
