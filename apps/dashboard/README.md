# Dashboard app
Role-scoped patient overview consuming `/api/v1/dashboard`, notifications, payments, and adherence APIs. API authorization determines visible data; no analytics or clinical decisions are computed client-side.

**Status:** UI scaffold. None of the four API routes above exist yet anywhere
in the repository (Wave 5 - Payment, Adherence, Notification, Analytics -
hasn't started); this app will 404 against every call until they're built.
See `docs/audit/RC1_BACKLOG.md`.
