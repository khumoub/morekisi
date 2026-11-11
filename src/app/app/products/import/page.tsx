import { requireRole } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui";
import { Importer } from "./importer";

export const metadata = { title: "Import products · Morekisi" };

export default async function ImportPage() {
  await requireRole("manager");
  return (
    <>
      <PageHeader title="Import products" description="Bring in your whole product list at once from a spreadsheet." />
      <Importer />
    </>
  );
}
