import { z } from "zod";

export const productSpecRowSchema = z.object({
  label: z
    .string()
    .trim()
    .min(1, "Label is required")
    .max(100, "Label must be at most 100 characters"),
  value: z
    .string()
    .trim()
    .min(1, "Value is required")
    .max(500, "Value must be at most 500 characters"),
});

export const productSpecGroupSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Group title is required")
    .max(120, "Group title must be at most 120 characters"),
  rows: z
    .array(productSpecRowSchema)
    .min(1, "Add at least one row")
    .max(100, "A group can hold at most 100 rows"),
});

export const productSchema = z.object({
  modelId: z.string().min(1, "Model is required"),
  family: z.enum(["car", "motorcycle", "phone", "tablet", "smartwatch"]),
  image: z
    .string()
    .max(500, "Image URL must be at most 500 characters")
    .optional(),
  specGroups: z
    .array(productSpecGroupSchema)
    .min(1, "Add at least one group")
    .max(50, "A product can hold at most 50 groups"),
  isPublished: z.boolean(),
});

/** `modelId` and `family` are immutable after create — the edit dialog never sends them. */
export const updateProductSchema = productSchema.omit({
  modelId: true,
  family: true,
});

export const deleteProductSchema = z.object({
  productId: z.string().min(1, "Product ID is required"),
});
