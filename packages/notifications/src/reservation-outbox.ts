import type { SupabaseClient } from "@supabase/supabase-js";
import type { EventConsumer, OutboxEvent, OutboxStore } from "@medlink/workflows";
import { OutboxDispatcher } from "@medlink/workflows";
import type { WhatsAppSender } from "@medlink/whatsapp";
import { GraphApiWhatsAppSender } from "@medlink/whatsapp";
import { RuntimeError } from "@medlink/runtime";
import type { Notification, NotificationChannel, NotificationStore } from "./service";
import { NotificationError, NotificationService } from "./service";

// G09 minimum slice, reconciled onto the canonical PR#26 fulfillment RPCs.
// Everything in this file is a Supabase-backed adapter for interfaces that
// already exist in a package (@medlink/workflows' OutboxStore,
// @medlink/notifications' own NotificationChannel/NotificationStore) --
// no new abstraction is invented here. It lives in the shared package
// (not a single consuming app) because, unlike G09's original
// reservations.create-only slice, reservation lifecycle transitions
// (confirm/cancel/ready/collect) happen from apps/pharmacy while the
// original create event happens from apps/patient -- both apps need to be
// able to instantiate and drive the same dispatcher with their own
// service-role Supabase client.

function infrastructureError(cause: unknown): RuntimeError {
  return new RuntimeError(
    "infrastructure",
    "database_operation_failed",
    "The data operation could not be completed",
    503,
    true,
    "Retry later.",
    { cause },
  );
}

interface RuntimeOutboxEventRow {
  readonly id: string;
  readonly organization_id: string;
  readonly event_type: string;
  readonly aggregate_id: string | null;
  readonly payload: Record<string, unknown>;
  readonly retry_count: number;
}

function toOutboxEvent(row: RuntimeOutboxEventRow): OutboxEvent {
  return {
    id: row.id,
    tenantId: row.organization_id,
    type: row.event_type,
    aggregateId: row.aggregate_id ?? "",
    payload: row.payload,
    attempts: row.retry_count,
  };
}

// claim() is the only operation that needs a database function: picking up
// to N unclaimed rows and locking them against a second, concurrent worker
// needs FOR UPDATE SKIP LOCKED (migration 202608160034), which PostgREST's
// .update()/.select() cannot express. published()/retry()/deadLetter() are
// plain single-row updates on a row this worker already exclusively holds
// (locked_by = its own worker id from the claim).
export class SupabaseOutboxStore implements OutboxStore {
  constructor(private readonly database: SupabaseClient) {}

  async claim(worker: string, limit: number): Promise<readonly OutboxEvent[]> {
    const { data, error } = await this.database.rpc("claim_runtime_outbox_events", {
      target_worker: worker,
      target_limit: limit,
    });
    if (error) throw infrastructureError(error);
    return ((data ?? []) as RuntimeOutboxEventRow[]).map(toOutboxEvent);
  }

  async published(id: string): Promise<void> {
    const { error } = await this.database.from("runtime_outbox_events")
      .update({ status: "published", published_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw infrastructureError(error);
  }

  async retry(id: string, availableAt: Date, errorCode: string): Promise<void> {
    const { data: current, error: readError } = await this.database
      .from("runtime_outbox_events")
      .select("retry_count")
      .eq("id", id)
      .single<{ retry_count: number }>();
    if (readError) throw infrastructureError(readError);

    const { error } = await this.database.from("runtime_outbox_events")
      .update({
        status: "retrying",
        available_at: availableAt.toISOString(),
        last_error_code: errorCode,
        retry_count: current.retry_count + 1,
      })
      .eq("id", id);
    if (error) throw infrastructureError(error);
  }

  // runtime_dead_letters (migration 202607270006) is deliberately not
  // populated here -- see the file-level comment on scope. A genuinely
  // dead-lettered event gets this status flag but no audit-log row yet,
  // named as a follow-up rather than silently skipped.
  async deadLetter(id: string, errorCode: string): Promise<void> {
    const { error } = await this.database.from("runtime_outbox_events")
      .update({ status: "dead_letter", last_error_code: errorCode })
      .eq("id", id);
    if (error) throw infrastructureError(error);
  }
}

// Deliberately no patient name or pharmacy name in any template: none of
// these consumers have that data cheaply available (would require a
// second table join beyond the reservation row itself for every send),
// and the READY template must never carry the pickup credential --
// plaintext exists only in the pharmacy app process that generates it
// (apps/pharmacy/lib/reservations.ts markReservationReady), synchronously,
// and is never written to this outbox row or any other durable store.
// This slice's READY notification intentionally tells the patient to
// return to the app/pharmacy for the code, not the code itself -- see the
// final report's open item on secure one-time credential delivery.
const NOTIFICATION_TEMPLATES: Readonly<Record<string, string>> = {
  reservation_confirmed:
    "Hi! Your MedLink medication reservation has been confirmed and is being " +
    "prepared for pickup. Open the MedLink app for pickup details.",
  reservation_cancelled:
    "Hi, your MedLink medication reservation was declined by the pharmacy. " +
    "Open the MedLink app to see the reason and your options.",
  reservation_ready:
    "Good news! Your MedLink medication reservation is ready for pickup. " +
    "Open the MedLink app for your pickup code, then bring it to the pharmacy.",
  reservation_collected:
    "Your MedLink medication pickup is complete. Thanks for using MedLink!",
  payment_required:
    "Payment is required for your confirmed MedLink reservation. " +
    "Open the MedLink app to pay securely.",
  payment_failed:
    "Your MedLink payment attempt was not completed. Your reservation remains active until its expiry time. " +
    "Open the MedLink app to retry securely.",
  payment_succeeded:
    "Your MedLink payment is confirmed. The pharmacy can now prepare your reservation for pickup.",
};

export interface RecipientWhatsAppIdentity {
  readonly phoneNumberId: string;
  readonly to: string;
}

export type ResolveWhatsAppRecipient = (
  tenantId: string,
  recipientId: string,
) => Promise<RecipientWhatsAppIdentity | null>;

// The only NotificationChannel this slice builds. Wraps the already-tested
// GraphApiWhatsAppSender -- no new transport code, just the mapping from
// the generic Notification shape to WhatsAppMessageSend and back.
export class WhatsAppNotificationChannel implements NotificationChannel {
  readonly name = "whatsapp" as const;

  constructor(
    private readonly sender: WhatsAppSender,
    private readonly resolveRecipient: ResolveWhatsAppRecipient,
  ) {}

  async send(message: Notification): Promise<{ readonly providerId: string }> {
    const body = NOTIFICATION_TEMPLATES[message.template];
    if (body === undefined) {
      throw new NotificationError(
        `Unknown WhatsApp notification template '${message.template}'`,
        "unknown_template",
      );
    }
    const recipient = await this.resolveRecipient(message.tenantId, message.recipientId);
    if (!recipient) {
      throw new NotificationError(
        "No WhatsApp channel identity is bound for this recipient yet",
        "recipient_not_bound",
      );
    }
    const result = await this.sender.send(recipient.phoneNumberId, {
      to: recipient.to,
      contentType: "text",
      body,
      mediaId: null,
      templateName: null,
    });
    return { providerId: result.externalMessageId };
  }
}

// Both directions of conversation_channel_bindings/conversations already
// exist in the schema (the inbound webhook path already resolves
// phoneNumberId -> organizationId; this is organizationId -> phoneNumberId,
// plus patientId -> the patient's own WhatsApp number from their most
// recent conversation). No schema change needed for either lookup.
export function toSupabaseWhatsAppRecipientResolver(
  database: SupabaseClient,
): ResolveWhatsAppRecipient {
  return async (tenantId, recipientId) => {
    const { data: binding, error: bindingError } = await database
      .from("conversation_channel_bindings")
      .select("channel_identifier")
      .eq("organization_id", tenantId)
      .eq("channel", "whatsapp")
      .is("deleted_at", null)
      .maybeSingle<{ channel_identifier: string }>();
    if (bindingError) throw infrastructureError(bindingError);
    if (!binding) return null;

    const { data: conversation, error: conversationError } = await database
      .from("conversations")
      .select("channel_identity")
      .eq("organization_id", tenantId)
      .eq("patient_id", recipientId)
      .eq("channel", "whatsapp")
      .is("deleted_at", null)
      .order("last_interaction_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ channel_identity: string }>();
    if (conversationError) throw infrastructureError(conversationError);
    if (!conversation) return null;

    return { phoneNumberId: binding.channel_identifier, to: conversation.channel_identity };
  };
}

interface NotificationRow {
  readonly id: string;
}

interface DeliveryAttemptRow {
  readonly provider_message_reference: string | null;
}

// notification_outbox/notification_delivery_attempts (migration
// 202607270004) already exist, but notification_outbox's own claim/retry
// bookkeeping would be a second, competing dispatch mechanism duplicating
// what runtime_outbox_events/OutboxDispatcher already does -- notifications
// and notification_delivery_attempts are used here only as the durable
// idempotency/evidence record NotificationStore's contract needs;
// notification_outbox itself is left deliberately unpopulated.
//
// Scoped per call by message.tenantId, not a constructor-fixed
// organizationId: a single dispatch() pass can claim outbox rows across
// more than one tenant, so a fixed organizationId here would misfile a
// second tenant's notification under the first's.
export class SupabaseNotificationStore implements NotificationStore {
  constructor(private readonly database: SupabaseClient) {}

  async find(key: string, message: Notification): Promise<{ readonly providerId: string } | null> {
    const { data: notification, error: notificationError } = await this.database
      .from("notifications")
      .select("id")
      .eq("organization_id", message.tenantId)
      .eq("idempotency_key", key)
      .maybeSingle<NotificationRow>();
    if (notificationError) throw infrastructureError(notificationError);
    if (!notification) return null;

    const { data: attempt, error: attemptError } = await this.database
      .from("notification_delivery_attempts")
      .select("provider_message_reference")
      .eq("notification_id", notification.id)
      .eq("attempt_number", 1)
      .maybeSingle<DeliveryAttemptRow>();
    if (attemptError) throw infrastructureError(attemptError);

    return { providerId: attempt?.provider_message_reference ?? notification.id };
  }

  async record(
    key: string,
    message: Notification,
    result: { readonly providerId: string },
  ): Promise<void> {
    const { data: notification, error: notificationError } = await this.database
      .from("notifications")
      .insert({
        organization_id: message.tenantId,
        recipient_id: message.recipientId,
        channel: message.channel,
        template_key: message.template,
        template_version: "v1",
        template_variables: message.variables,
        status: "sent",
        idempotency_key: key,
        sent_at: new Date().toISOString(),
      })
      .select("id")
      .single<NotificationRow>();
    if (notificationError) throw infrastructureError(notificationError);

    const { error: attemptError } = await this.database
      .from("notification_delivery_attempts")
      .insert({
        organization_id: message.tenantId,
        notification_id: notification.id,
        attempt_number: 1,
        provider: message.channel,
        provider_message_reference: result.providerId,
        status: "accepted",
      });
    if (attemptError) throw infrastructureError(attemptError);
  }
}

interface ReservationPatientRow {
  readonly patient_id: string;
}

// Shared by every lifecycle consumer below: the generic API-layer outbox
// event (runtime.operation.completed) only carries {operation, requestId,
// actorId} -- for reservations.create that's enough (the actor *is* the
// recipient patient), but decide_reservation/mark_reservation_ready/
// collect_reservation's *own* internal record_runtime_evidence() calls
// emit a richer, reservation-scoped event instead
// (reservation.{confirmed,cancelled,ready,collected}.v1, aggregate_type=
// 'reservation', aggregate_id=<reservation id>) -- the actor on those is
// pharmacy staff, not the patient, so the recipient has to be resolved
// from the reservation row itself (readable by service_role since PR#26's
// grant migration).
async function resolveReservationPatient(
  database: SupabaseClient,
  tenantId: string,
  reservationId: string,
): Promise<string | null> {
  const { data, error } = await database
    .from("reservations")
    .select("patient_id")
    .eq("organization_id", tenantId)
    .eq("id", reservationId)
    .maybeSingle<ReservationPatientRow>();
  if (error) throw infrastructureError(error);
  return data?.patient_id ?? null;
}

function reservationLifecycleConsumer(
  database: SupabaseClient,
  eventType: string,
  template: string,
  notifications: NotificationService,
): EventConsumer {
  return {
    eventType,
    async handle(event: OutboxEvent): Promise<void> {
      const reservationId = event.aggregateId;
      if (!reservationId) return;
      const recipientId = await resolveReservationPatient(database, event.tenantId, reservationId);
      if (!recipientId) return;
      await notifications.send(
        {
          id: event.id,
          tenantId: event.tenantId,
          recipientId,
          template,
          variables: {},
          channel: "whatsapp",
        },
        event.id,
      );
    },
  };
}

// The original G09 consumer: reservations.create's actor *is* the
// recipient patient, so no reservation lookup is needed here.
class ReservationCreatedNotificationConsumer implements EventConsumer {
  readonly eventType = "runtime.operation.completed";

  constructor(private readonly notifications: NotificationService) {}

  async handle(event: OutboxEvent): Promise<void> {
    if (event.payload.operation !== "reservations.create") return;
    const recipientId = event.payload.actorId;
    if (typeof recipientId !== "string" || recipientId === "") return;

    await this.notifications.send(
      {
        id: event.id,
        tenantId: event.tenantId,
        recipientId,
        template: "reservation_confirmed",
        variables: {},
        channel: "whatsapp",
      },
      event.id,
    );
  }
}

// Wires every piece above into the one dispatcher this slice needs. Two
// independent call sites drive it: every reservation lifecycle route
// (apps/patient's create route, apps/pharmacy's decide/ready/collect
// routes) piggybacks a best-effort dispatch() right after its own
// successful response, so events are usually picked up immediately; and
// apps/web's POST /api/internal/notification-dispatch (same
// bearer-token-worker pattern as /api/internal/inventory-expiry and
// /api/internal/clinical-pipeline) exists so an external scheduler can
// advance the queue on a fixed cadence even during a quiet period with no
// reservation traffic at all -- this repository has no in-process
// cron/scheduler itself.
export function buildReservationNotificationDispatcher(
  database: SupabaseClient,
  whatsAppAccessToken: string,
  // Test-only seam: every real caller (apps/patient, apps/pharmacy) omits
  // this and gets the real GraphApiWhatsAppSender. Never omit it in
  // production code -- this parameter exists so unit tests can verify
  // recipient resolution/idempotency/template safety without making a
  // live network call to Meta's Graph API.
  sender?: WhatsAppSender,
  e2eGraphApiBaseUrl?: string,
): OutboxDispatcher {
  const resolvedSender = sender ?? new GraphApiWhatsAppSender(
    whatsAppAccessToken,
    fetch,
    "v21.0",
    10_000,
    e2eGraphApiBaseUrl,
  );
  const store = new SupabaseOutboxStore(database);
  const channel = new WhatsAppNotificationChannel(
    resolvedSender,
    toSupabaseWhatsAppRecipientResolver(database),
  );
  const notifications = new NotificationService([channel], new SupabaseNotificationStore(database));

  const consumers: readonly EventConsumer[] = [
    new ReservationCreatedNotificationConsumer(notifications),
    reservationLifecycleConsumer(database, "reservation.confirmed.v1", "reservation_confirmed", notifications),
    reservationLifecycleConsumer(database, "reservation.cancelled.v1", "reservation_cancelled", notifications),
    reservationLifecycleConsumer(database, "reservation.ready.v1", "reservation_ready", notifications),
    reservationLifecycleConsumer(database, "reservation.collected.v1", "reservation_collected", notifications),
    reservationLifecycleConsumer(database, "payment.required.v1", "payment_required", notifications),
    reservationLifecycleConsumer(database, "payment.failed.v1", "payment_failed", notifications),
    reservationLifecycleConsumer(database, "payment.succeeded.v1", "payment_succeeded", notifications),
  ];
  return new OutboxDispatcher(store, consumers, () => new Date());
}
