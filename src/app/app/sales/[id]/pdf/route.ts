import { invoicePdf } from "@/lib/documents";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return invoicePdf((await params).id);
}
