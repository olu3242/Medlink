import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl items-center px-6 py-16">
      <section aria-labelledby="page-title" className="max-w-2xl">
        <p className="mb-3 font-semibold text-teal-700">MedLink Platform Core</p>
        <h1 id="page-title" className="text-5xl font-bold tracking-tight">
          Safer access to the medicine people need.
        </h1>
        <p className="my-6 text-lg leading-8 text-slate-700">
          The Phase 0 foundation is online. Authentication and tenant-aware
          workflows are ready for the clinical foundation.
        </p>
        <Link
          className="inline-block rounded-lg bg-teal-700 px-4 py-2 font-semibold text-white"
          href="/auth/sign-in"
        >
          Sign in securely
        </Link>
      </section>
    </main>
  );
}
