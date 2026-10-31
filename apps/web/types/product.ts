/** One label/value row inside a product spec section. */
export interface ProductSpecItem {
  label: string;
  value: string;
}

/** A named section ("Display", "Camera", …); array order is display order. */
export interface ProductSpecGroup {
  title: string;
  rows: ProductSpecItem[];
}

/** The five template families (mirrors the backend enum). */
export type ProductSpecFamily =
  | "car"
  | "motorcycle"
  | "phone"
  | "tablet"
  | "smartwatch";

/** One labelled input on a family template. */
export interface ProductSpecTemplateField {
  key: string;
  label: string;
  /** Multiple values per field (a phone's band lists differ per model). */
  multi?: boolean;
}

/** One ordered section of a family template. */
export interface ProductSpecTemplateSection {
  key: string;
  title: string;
  fields: ProductSpecTemplateField[];
}

/** The backend-owned page structure for one family. */
export interface ProductSpecTemplate {
  family: ProductSpecFamily;
  label: string;
  subcategorySlug: string;
  /** `template` fills fixed sections; `freeform` lets staff add any rows. */
  mode: "template" | "freeform";
  sections: ProductSpecTemplateSection[];
}

/** Search / post-form picker row. */
export interface ProductSummary {
  /** The product-spec row id. */
  id: string;
  /** The `models` id — what a listing stores in `productModelId`. */
  modelId: string;
  brandId: string;
  brandSlug: string;
  brandName: string;
  modelSlug: string;
  modelName: string;
  image: string | null;
}

/** Full public spec page. */
export interface ProductDetail extends ProductSummary {
  family: ProductSpecFamily;
  /** The staff-uploaded image (raw); empty when the model image is used. */
  specImage: string | null;
  specGroups: ProductSpecGroup[];
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Admin rows share the public shape; drafts are simply included. */
export type AdminProduct = ProductDetail;
