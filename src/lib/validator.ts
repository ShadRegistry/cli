import { z } from "zod";

const VALID_TYPES = [
  "registry:component",
  "registry:block",
  "registry:ui",
  "registry:hook",
  "registry:lib",
  "registry:page",
  "registry:file",
  "registry:style",
  "registry:theme",
  "registry:item",
] as const;

const fileSchema = z.object({
  path: z.string().min(1),
  type: z.string().min(1),
  content: z.string(),
  target: z.string().optional(),
});

const fontSchema = z.object({
  family: z.string(),
  provider: z.string(),
  import: z.string(),
  variable: z.string(),
  weight: z.array(z.string()).optional(),
  subsets: z.array(z.string()).optional(),
});

const cssVarsSchema = z
  .object({
    theme: z.record(z.string(), z.string()).optional(),
    light: z.record(z.string(), z.string()).optional(),
    dark: z.record(z.string(), z.string()).optional(),
  })
  .optional();

export const registryItemSchema = z.object({
  name: z
    .string()
    .min(2, "Name must be at least 2 characters")
    .max(64, "Name must be at most 64 characters")
    .regex(
      /^[a-z0-9][a-z0-9-]*[a-z0-9]$/,
      "Name must be lowercase alphanumeric with hyphens",
    ),
  type: z.enum(VALID_TYPES),
  title: z.string().optional(),
  description: z.string().optional(),
  author: z.string().optional(),
  files: z.array(fileSchema),
  dependencies: z.array(z.string()).optional(),
  devDependencies: z.array(z.string()).optional(),
  registryDependencies: z.array(z.string()).optional(),
  cssVars: cssVarsSchema,
  css: z.string().optional(),
  envVars: z.record(z.string(), z.string()).optional(),
  docs: z.string().optional(),
  categories: z.array(z.string()).optional(),
  meta: z.string().optional(),
  extends: z.string().optional(),
  style: z.string().optional(),
  iconLibrary: z.string().optional(),
  baseColor: z.string().optional(),
  itemTheme: z.string().optional(),
  font: fontSchema.optional(),
  previewBundle: z.string().optional(),
});

export type ValidatedItem = z.infer<typeof registryItemSchema>;

export const VALID_TYPE_LIST = VALID_TYPES;
