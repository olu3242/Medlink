import type { SupabaseClient } from "@supabase/supabase-js";
import type { EventConsumer, OutboxEvent, OutboxStore } from "@medlink/workflows";
import { OutboxDispatcher } from "@medlink/workflows";
import type { Notification, NotificationChannel, NotificationStore } from "@medlink/notifications";
import { NotificationError, NotificationService } from "@medlink/notifications";
import type { WhatsAppSender } from "@medlink/whatsapp";
import { GraphApiWhatsAppSender } from "@medlink/whatsapp";
import { RuntimeError } from "@medlink/runtime";

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

// G09 minimum slice (FINAL_GO_NO_GO.md): "one real NotificationChannel
// (WhatsApp) plus wiring OutboxDispatcher to at least one real event."
// Everything in this file is a Supabase-backed adapter for an interface
// that already exists in a package (@medlink/workflows' OutboxStore,
// @medlink/notifications' NotificationChannel/NotificationStore) --
// following the same "adapter lives in the consuming app" boundary as
// SupabaseEscalationStore and SupabasePrescriptionFileStore. No new
// abstraction was invented for this pass.

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
// needs FOR UPDATE SKIP LOCKED (migration 202608040001), which PostgREST's
// .update()/.select() cannot express. published()/retry()/deadLetter() are
// plain single-row updates on a row this worker already exclusively holds
// (locked_by = its own worker id from the claim), the same read-then-write
// style apps/web/lib/workflow-store.ts's markStep() already uses for a
// field that depends on the row's current value.
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
  // populated by this pass -- it exists for exactly this, but this slice's
  // single consumer (ReservationConfirmedNotificationConsumer) either
  // no-ops (wrong operation) or sends one WhatsApp message; dead-lettering
  // it would only ever mean a real, rare WhatsApp delivery failure after
  // four retries. Named here, not silently skipped: a genuinely
  // dead-lettered event gets this status flag but no audit-log row yet.
  async deadLetter(id: string, errorCode: string): Promise<void> {
    const { error } = await this.database.from("runtime_outbox_events")
      .update({ status: "dead_letter", last_error_code: errorCode })
      .eq("id", id);
    if (error) throw infrastructureError(error);
  }
}

// The one template this slice needs. Deliberately no patient name or
// medicine name -- packages/runtime's journal.commit() (packages/api/src/
// index.ts) only carries {operation, requestId, actorId} through to the
// outbox event, not the RPC's own output, so richer content isn't
// available here without a broader change to RuntimeDependencies.journal
// that touches every operation, not just this one. Named as a follow-up,
// not silently worked around.
const NOTIFICATION_TEMPLATES: Readonly<Record<string, string>> = {
  reservation_confirmed:
    "Hi! Your MedLink medication reservation has been confirmed and is being " +
    "prepared for pickup. Open the MedLink app for pickup details.",
};

export interface RecipientWhatsAppIdentity {
  readonly phoneNumberId: string;
  readonly to: string;
}

export type ResolveWhatsAppRecipient = (
  tenantId: string,
  recipientId: string,
) => Promise<RecipientWhatsAppIdentity | null>;

// The only NotificationChannel this slice builds, per FINAL_GO_NO_GO.md's
// own wording. Wraps the already-tested GraphApiWhatsAppSender -- no new
// transport code, just the mapping from the generic Notification shape to
// WhatsAppMessageSend and back.
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
// what runtime_outbox_events/OutboxDispatcher already does for this slice
// -- the same "don't leave two competing declarations for the same
// concern" call this session already made retiring the orphaned
// medicine-match agent. notifications and notification_delivery_attempts
// are used here only as the durable idempotency/evidence record
// NotificationStore's contract needs; notification_outbox itself is left
// deliberately unpopulated.
//
// Scoped per call by message.tenantId, not a constructor-fixed
// organizationId: a single dispatch() pass can claim outbox rows across
// more than one tenant (the worker isn't tenant-scoped, unlike every
// other client in this codebase), so a fixed organizationId here would
// misfile a second tenant's notification under the first's -- exactly the
// cross-tenant defect this program's RLS discipline exists to prevent.
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

// The one real event this slice wires OutboxDispatcher to. Every operation
// commits the same generic "runtime.operation.completed" event type
// (packages/api/src/index.ts) -- this consumer is registered once for that
// type and decides, per event, whether it has anything to do; every other
// operation's event passes through as a silent no-op (a successful
// handle(), so the dispatcher marks it published, not retried or
// dead-lettered).
export class ReservationConfirmedNotificationConsumer implements EventConsumer {
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

// Wires every piece above into the one dispatcher this slice needs. There
// is no scheduler/cron in this environment (building one is exactly the
// full Integration/Notification Platform superprompt this session's
// earlier AskUserQuestion answer explicitly declined in favor of this
// minimal slice) -- dispatch is instead piggybacked opportunistically on
// the reservations route, right after a reservation is created, per the
// caller in apps/patient/app/api/v1/reservations/route.ts. That is a real,
// named tradeoff: a pending event only gets picked up on the next
// reservation request from any patient in the same environment, not on a
// fixed schedule. A production rollout would replace this call site with a
// real scheduled worker calling the same dispatch() method -- out of scope
// here, and named rather than silently worked around.
export function buildReservationNotificationDispatcher(
  database: SupabaseClient,
  whatsAppAccessToken: string,
): OutboxDispatcher {
  const store = new SupabaseOutboxStore(database);
  const sender = new GraphApiWhatsAppSender(whatsAppAccessToken);
  const channel = new WhatsAppNotificationChannel(
    sender,
    toSupabaseWhatsAppRecipientResolver(database),
  );
  const notifications = new NotificationService([channel], new SupabaseNotificationStore(database));
  const consumer = new ReservationConfirmedNotificationConsumer(notifications);
  return new OutboxDispatcher(store, [consumer], () => new Date());
}
