import Link from "next/link";
import type { MedicineSummary } from "../lib/api";

export function MedicineTable({ medicines }: { medicines: MedicineSummary[] }) {
  if (medicines.length === 0) {
    return (
      <div className="empty">
        <h2>No medicines found</h2>
        <p className="muted">Try changing the filters or add the first medicine.</p>
        <Link className="secondary-link" href="/admin/medicine/new">Add medicine</Link>
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table>
        <caption className="skip-link">Medicine catalog results</caption>
        <thead>
          <tr>
            <th scope="col">Medicine</th>
            <th scope="col">Generic</th>
            <th scope="col">Strength</th>
            <th scope="col">Form</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {medicines.map((medicine) => (
            <tr key={medicine.id}>
              <td>
                <Link className="medicine-link" href={`/admin/medicine/${medicine.id}`}>
                  {medicine.brandName}
                </Link>
                {medicine.manufacturer
                  ? <div className="muted">{medicine.manufacturer}</div>
                  : null}
              </td>
              <td>{medicine.genericName}</td>
              <td>{medicine.strength}</td>
              <td>{medicine.dosageForm}</td>
              <td>
                <span className={`badge ${medicine.status !== "active" ? "inactive" : ""}`}>
                  {medicine.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
