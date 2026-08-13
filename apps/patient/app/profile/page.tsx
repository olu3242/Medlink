import { ProfileForm } from "./profile-form";

export default function ProfilePage() {
  return (
    <>
      <header className="head">
        <div>
          <div className="eyebrow">Patient profile</div>
          <h1>Your pilot details</h1>
          <p className="muted">
            Keep your contact and communication preferences current.
          </p>
        </div>
      </header>
      <ProfileForm />
    </>
  );
}
