import { quotePdf } from "@/lib/documents";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return quotePdf((await params).id);
}
