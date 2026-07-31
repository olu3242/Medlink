import { PrescriptionUploadForm } from "./prescription-upload-form";

export default function NewPrescriptionPage() {
  return (
    <>
      <header className="head">
        <div>
          <div className="eyebrow">Prescription intake</div>
          <h1>Upload a prescription</h1>
          <p className="muted">
            Upload a clear JPEG, PNG, or PDF up to 10 MB. A pharmacist reviews
            every prescription before fulfillment.
          </p>
        </div>
      </header>
      <PrescriptionUploadForm />
    </>
  );
}
