import { statementPdf } from "@/lib/documents";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return statementPdf((await params).id);
}
