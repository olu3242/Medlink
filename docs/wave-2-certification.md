# Wave 2 certification — Clinical Intelligence

## Scope

- Medicine Knowledge
- Medication Equivalency
- Prescription Intelligence
- Clinical validation and catalog search
- Admin catalog experience

Wave 1 packages remain frozen. The new Wave 2 migration is the only required
change under the shared Supabase directory.

## Safety invariants

- Equivalence candidates never auto-substitute.
- Every equivalence requires pharmacist review.
- OCR output always enters `needs_review`.
- Critical clinical findings create a hard stop until pharmacist acknowledgement.
- Prescription data is tenant-scoped and protected by RLS.

## API surface

- `GET|POST /api/v1/medicines`
- `GET|PATCH /api/v1/medicines/{id}`
- `GET /api/v1/brands`
- `GET /api/v1/generics`
- `GET|POST /api/v1/prescriptions`
- `GET /api/v1/equivalents?medicineId={uuid}`

## Certification checklist

- [x] Strict TypeScript domain packages
- [x] Unit tests for parsing, validation, search, and equivalency
- [x] Versioned API boundaries with input validation
- [x] Responsive admin catalog UI
- [x] RLS and index migration reviewed statically
- [ ] Migration executed against local Supabase
- [ ] API integration tests against local Supabase
- [ ] OCR provider adapter selected and credentials configured

The unchecked items require a local PostgreSQL/Supabase runtime. Docker Desktop
or Podman is not currently available on the build host.
