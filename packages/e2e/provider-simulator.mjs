import { createServer } from "node:http";

const port = Number(process.env.MEDLINK_E2E_PROVIDER_PORT ?? 4010);

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

const server = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const mode = request.headers["x-medlink-simulate"];
  if (mode === "timeout") await new Promise((resolve) => setTimeout(resolve, 20_000));
  if (mode === "failure") return json(response, 503, { error: "simulated_provider_failure" });

  if (request.url === "/scan" && request.method === "POST") {
    return json(response, 200, {
      status: mode === "rejected" ? "rejected" : "clean",
      scanner: "medlink-e2e-scanner",
      signature: "e2e-clean-v1",
    });
  }
  if (request.url === "/ocr" && request.method === "POST") {
    return json(response, 200, {
      text: "Golden Loop Medicine 500 mg. Take one tablet twice daily. Quantity 14.",
      pageCount: 1,
      confidence: 0.98,
      provider: "medlink-e2e-ocr",
      model: "deterministic-v1",
    });
  }
  if (request.url === "/parse" && request.method === "POST") {
    const field = (value, confidence = 0.98) => ({ value, confidence });
    return json(response, 200, {
      prescriberName: field("Dr Golden Loop"),
      items: [{
        medicineName: field("Golden Loop Medicine"),
        strength: field("500 mg"),
        dosage: field("Take one tablet twice daily"),
        quantity: field("14"),
      }],
      overallConfidence: 0.98,
    });
  }
  return json(response, 404, { error: "not_found" });
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`MedLink provider simulator listening on ${port}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
