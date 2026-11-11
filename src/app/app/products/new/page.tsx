import { requireRole } from "@/lib/auth/session";
import { Card, PageHeader } from "@/components/ui";
import { loadCategories } from "../data";
import { ProductForm } from "../product-form";

export const metadata = { title: "Add product · Morekisi" };

export default async function NewProductPage() {
  const { current } = await requireRole("manager");
  const categories = await loadCategories(current.businessId);
  return (
    <>
      <PageHeader title="Add product" />
      <Card>
        <ProductForm categories={categories} />
      </Card>
    </>
  );
}
