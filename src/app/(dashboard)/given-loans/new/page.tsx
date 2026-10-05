import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { GivenLoanForm } from "@/components/given-loans/given-loan-form";
import { getClientsForPicker } from "@/lib/actions/client-picker-actions";
import { getCashInHand } from "@/lib/services/cash-ledger-service";

export default async function NewGivenLoanPage() {
  const [clients, cashInHand] = await Promise.all([
    getClientsForPicker(),
    getCashInHand(),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href="/given-loans">
          <ArrowLeft className="h-4 w-4" />
          Back to loans given
        </Link>
      </Button>

      <Card>
        <CardHeader>
          <CardTitle>Give a Loan</CardTitle>
        </CardHeader>
        <CardContent>
          <GivenLoanForm
            clients={clients.map((c) => ({ id: c.id, label: c.label }))}
            cashInHand={cashInHand}
          />
        </CardContent>
      </Card>
    </div>
  );
}
