import { createServer } from "node:http";

const port = Number(process.env.MEDLINK_E2E_PROVIDER_PORT ?? 4010);
const whatsAppMessages = [];
const paymentIntents = [];
const paymentRefunds = [];

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
  if (request.url === "/whatsapp/messages" && request.method === "GET") {
    return json(response, 200, { messages: whatsAppMessages });
  }
  if (request.url === "/payments/intents" && request.method === "GET") {
    return json(response, 200, { intents: paymentIntents });
  }
  if (request.url === "/payments/intents" && request.method === "POST") {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const idempotencyKey = request.headers["idempotency-key"];
    const prior = paymentIntents.find((intent) => intent.idempotencyKey === idempotencyKey);
    if (prior) return json(response, 200, prior.response);
    const result = {
      idempotencyKey,
      reference: body.reference,
      amountMinor: body.amountMinor,
      currency: body.currency,
      response: {
        providerReference: body.reference,
        hostedPaymentUrl: `http://127.0.0.1:${port}/payments/checkout/${body.reference}`,
      },
    };
    paymentIntents.push(result);
    return json(response, 201, result.response);
  }
  if (request.url === "/payments/refunds" && request.method === "GET") {
    return json(response, 200, { refunds: paymentRefunds });
  }
  if (request.url === "/payments/refunds" && request.method === "POST") {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const idempotencyKey = request.headers["idempotency-key"];
    const prior = paymentRefunds.find((refund) => refund.idempotencyKey === idempotencyKey);
    if (prior) return json(response, 200, prior.response);
    const result = {
      idempotencyKey,
      reference: body.reference,
      amountMinor: body.amountMinor,
      currency: body.currency,
      response: { providerRefundReference: body.reference },
    };
    paymentRefunds.push(result);
    return json(response, 201, result.response);
  }
  if (/^\/v\d+\.\d+\/[^/]+\/messages$/.test(request.url ?? "") && request.method === "POST") {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const externalMessageId = `wamid.sim.${whatsAppMessages.length + 1}`;
    whatsAppMessages.push({ externalMessageId, body });
    return json(response, 200, { messages: [{ id: externalMessageId }] });
  }
  return json(response, 404, { error: "not_found" });
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`MedLink provider simulator listening on ${port}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
