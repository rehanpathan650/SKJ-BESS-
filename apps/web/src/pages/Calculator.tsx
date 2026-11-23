import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { CalcForm, CalcResultsView, cleanInputs, emptyInputs } from "../components/Calculator";
import { Card, ErrorBox, PageHead } from "../components/ui";
import { api } from "../lib/api";

/** Quick what-if calculator. To save a configuration for validation, use a project's Calculator tab. */
export function CalculatorPage() {
  const [inputs, setInputs] = useState(emptyInputs());
  const defaults = useQuery({ queryKey: ["calc-defaults"], queryFn: api.calculator.defaults });
  const run = useMutation({ mutationFn: () => api.calculator.preview(cleanInputs(inputs)) });
  return (
    <>
      <PageHead title="BESS calculator" sub="Quick estimate. Save configurations from a project so an engineer can validate them." />
      <div className="split">
        <Card title="Inputs">
          <form onSubmit={(e) => { e.preventDefault(); run.mutate(); }}>
            <CalcForm value={inputs} onChange={setInputs} defaults={defaults.data} />
            <div className="spacer" />
            <button className="primary" disabled={run.isPending}>{run.isPending ? "Calculating…" : "Calculate"}</button>
          </form>
        </Card>
        <div>
          <ErrorBox error={run.error} />
          {run.data ? <CalcResultsView results={run.data.results} commercial={run.data.commercial} />
            : <Card><p className="muted">Enter the customer's load, tariff and a battery size, then calculate.</p></Card>}
        </div>
      </div>
    </>
  );
}
