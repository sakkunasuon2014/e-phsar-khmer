import { redirect } from "next/navigation";

/** The old single-page surface now lives under Product Specifications → Cars. */
export default function ProductsRedirect() {
  redirect("/wanderer/dashboard/product-specifications/cars");
}
