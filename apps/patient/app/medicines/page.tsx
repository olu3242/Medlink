import { MedicineCatalogue } from "./medicine-catalogue";

export default function MedicinesPage() {
  return (
    <>
      <header className="head">
        <div>
          <div className="eyebrow">Trusted medicine information</div>
          <h1>Medicine catalogue</h1>
          <p className="muted">
            Browse active, regulated medicines. Catalogue alternatives always
            require pharmacist review.
          </p>
        </div>
      </header>
      <MedicineCatalogue />
    </>
  );
}
