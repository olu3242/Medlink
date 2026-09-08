import Link from "next/link";
import {
  dashboard,
  inventoryAlerts,
  queue,
  type Review,
} from "../lib/api";
import type { PharmacistDashboard } from "@medlink/clinical";
import type { InventoryBatch } from "@medlink/inventory";

export const dynamic = "force-dynamic";

function expiresSoon(date: string) {
  return new Date(`${date}T00:00:00Z`).getTime()
    <= Date.now() + 30 * 86_400_000;
}

export default async function Page() {
  let rows: Review[] = [];
  let stock: InventoryBatch[] = [];
  let metrics: PharmacistDashboard | null = null;
  let failed = false;
  try {
    [rows, metrics, stock] = await Promise.all([
      queue(),
      dashboard(),
      inventoryAlerts(),
    ]);
  } catch {
    failed = true;
  }
  const alerts = stock.filter((item) =>
    item.availabilityState === "low_stock"
    || (item.recordStatus !== "expired" && expiresSoon(item.expiresOn)));

  return (
    <>
      <header className="head">
        <div>
          <div className="eyebrow">Batch 2 · Clara responsibility</div>
          <h1>Pharmacist workspace</h1>
          <p className="muted">
            Automated extraction and stock signals are advisory. Every clinical
            decision remains with a verified pharmacist.
          </p>
        </div>
        <div className="quick-actions">
          {rows[0] ? <Link className="button" href={`/pharmacist/review/${rows[0].id}`}>Review next</Link> : null}
          <Link className="button secondary" href="/pharmacist">Refresh workspace</Link>
        </div>
      </header>
      {failed || !metrics
        ? (
          <div className="error" role="alert">
            The pharmacist workspace is unavailable. Refresh to retry; no
            clinical decision has been changed.
          </div>
        )
        : (
          <>
            <section className="kpis" aria-label="Pharmacist indicators">
              <article className="kpi"><span>Pending reviews</span><strong>{metrics.pendingReviews}</strong></article>
              <article className="kpi warning"><span>Needs information</span><strong>{metrics.needsInformation}</strong></article>
              <article className="kpi"><span>Approved (UTC day)</span><strong>{metrics.approvedTodayUtc}</strong></article>
              <article className="kpi"><span>Rejected (UTC day)</span><strong>{metrics.rejectedTodayUtc}</strong></article>
              <article className="kpi warning"><span>Unresolved medicines</span><strong>{metrics.unresolvedMedicines}</strong></article>
              <article className="kpi warning"><span>Inventory alerts</span><strong>{alerts.length}</strong></article>
            </section>
            <div className="workspace">
              <section aria-labelledby="review-queue-heading">
                <h2 id="review-queue-heading">Prescription review queue</h2>
                <div className="queue-list">
                  {rows.map((review) => (
                    <article className="card queue-card" key={review.id}>
                      <span className={`status ${review.priority}`}>{review.priority} priority</span>
                      <h3>{review.medicineNames.join(", ") || "Unresolved medicine"}</h3>
                      <p>{review.reason}</p>
                      <p className="muted">{review.patientReference} · submitted {new Date(review.createdAt).toLocaleString()}</p>
                      <Link className="button" href={`/pharmacist/review/${review.id}`}>Open review</Link>
                    </article>
                  ))}
                  {!rows.length ? <div className="card"><h3>Queue clear</h3><p className="muted">No prescriptions currently require pharmacist action.</p></div> : null}
                </div>
              </section>
              <aside className="side-stack">
                <section className="card">
                  <h2>Inventory alerts</h2>
                  {alerts.slice(0, 8).map((item) => (
                    <article className="alert-row" key={item.id}>
                      <strong>{item.brandName} {item.strength}</strong>
                      <span>{item.pharmacyName}: {item.availableQuantity} {item.unit}; expires {item.expiresOn}</span>
                    </article>
                  ))}
                  {!alerts.length ? <p className="muted">No low-stock or 30-day expiry alerts.</p> : null}
                </section>
                <section className="card">
                  <h2>Recent clinical activity</h2>
                  {metrics.recentActivity.map((activity) => (
                    <p className="activity" key={activity.reviewId}>
                      <span className="status">{activity.status.replaceAll("_", " ")}</span>{" "}
                      {new Date(activity.occurredAt).toLocaleString()}
                    </p>
                  ))}
                  {!metrics.recentActivity.length ? <p className="muted">No review activity is visible.</p> : null}
                </section>
              </aside>
            </div>
          </>
        )}
    </>
  );
}
