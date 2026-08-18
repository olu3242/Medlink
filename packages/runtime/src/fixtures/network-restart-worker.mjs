import pg from "pg";

const payload = JSON.parse(process.env.MEDLINK_RESTART_PAYLOAD ?? "null");
const connectionString = process.env.MEDLINK_CERTIFICATION_DB_URL;
if (!payload || !connectionString) throw new Error("restart certification context is missing");

const db = new pg.Client({ connectionString });
await db.connect();
const actor = async (id, role = "authenticated") => db.query(
  "select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)",
  [id, role],
);

try {
  await actor(payload.pharmacyStaff);
  const readyArgs = [payload.pharmacyOrganizationId, payload.pharmacyStaff, payload.correlation, "network-ready", payload.reservationId];
  await db.query("select public.mark_reservation_ready($1,$2,$3,$3,$4,'web',$5)", readyArgs);
  await db.query("select public.mark_reservation_ready($1,$2,$3,$3,$4,'web',$5)", readyArgs);
  await actor(payload.patient);
  await db.query(
    "select public.issue_pickup_credential($1,$2,$3,$3,$4,'web',$5,$6)",
    [payload.patientOrganizationId, payload.patient, payload.correlation, "network-credential", payload.reservationId, payload.pickupHash],
  );
  await actor(payload.pharmacyStaff);
  const collectArgs = [payload.pharmacyOrganizationId, payload.pharmacyStaff, payload.correlation, "network-collect", payload.reservationId, payload.pickupHash];
  await db.query("select public.collect_reservation($1,$2,$3,$3,$4,'web',$5,$6)", collectArgs);
  await db.query("select public.collect_reservation($1,$2,$3,$3,$4,'web',$5,$6)", collectArgs);

  const evidence = (await db.query(
    `select reservation.id "reservationId",payment.id "paymentId",reservation.status,
      (select count(*)::int from public.reservations where id=reservation.id) "reservationCount",
      (select count(*)::int from public.payments where reservation_id=reservation.id) "paymentCount",
      (select count(*)::int from public.inventory_locks where reservation_id=reservation.id and status='active') "activeLockCount",
      (select count(*)::int from public.inventory_locks where reservation_id=reservation.id and status='consumed') "consumedLockCount",
      (select count(*)::int from public.fulfillment_transitions where reservation_id=reservation.id and to_state='collected') "collectedTransitionCount",
      (select count(*)::int from public.runtime_outbox_events where aggregate_id=reservation.id::text and event_type='reservation.ready.v1') "readyEventCount"
     from public.reservations reservation join public.payments payment on payment.reservation_id=reservation.id
     where reservation.id=$1 and payment.id=$2`,
    [payload.reservationId, payload.paymentId],
  )).rows[0];
  process.stdout.write(JSON.stringify(evidence));
} finally {
  await db.end();
}
