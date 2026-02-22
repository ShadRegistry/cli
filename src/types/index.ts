export interface AuthConfig {
  token: string;
  user: {
    username: string;
  };
  hostname: string;
}

export interface ProjectConfig {
  $schema?: string;
  registry: string;
  sourceDir: string;
  url: string;
}

export interface RegistryFile {
  path: string;
  type: string;
  content?: string;
  target?: string;
}

export interface RegistryItem {
  name: string;
  type: string;
  title?: string;
  description?: string;
  author?: string;
  files: RegistryFile[];
  dependencies?: string[];
  devDependencies?: string[];
  registryDependencies?: string[];
  cssVars?: {
    theme?: Record<string, string>;
    light?: Record<string, string>;
    dark?: Record<string, string>;
  };
  css?: string | Record<string, unknown>;
  envVars?: Record<string, string>;
  docs?: string;
  categories?: string[];
  meta?: string | Record<string, unknown>;
  extends?: string;
  style?: string;
  iconLibrary?: string;
  baseColor?: string;
  theme?: string;
  font?: {
    family: string;
    provider: string;
    import: string;
    variable: string;
    weight?: string[];
    subsets?: string[];
  };
}

export interface RegistryManifest {
  $schema?: string;
  name: string;
  homepage?: string;
  items: RegistryItem[];
}

export interface ItemPayload {
  name: string;
  type: string;
  title?: string;
  description?: string;
  author?: string;
  files: { path: string; type: string; content: string; target?: string }[];
  dependencies?: string[];
  devDependencies?: string[];
  registryDependencies?: string[];
  cssVars?: {
    theme?: Record<string, string>;
    light?: Record<string, string>;
    dark?: Record<string, string>;
  };
  css?: string;
  envVars?: Record<string, string>;
  docs?: string;
  categories?: string[];
  meta?: string;
  extends?: string;
  style?: string;
  iconLibrary?: string;
  baseColor?: string;
  itemTheme?: string;
  font?: {
    family: string;
    provider: string;
    import: string;
    variable: string;
    weight?: string[];
    subsets?: string[];
  };
}

export interface DiffResult {
  newItems: ItemPayload[];
  updatedItems: ItemPayload[];
  unchangedNames: string[];
  orphanedNames: string[];
}

export interface PublishResult {
  created: number;
  updated: number;
  errors: Array<{ name: string; error: string }>;
}
