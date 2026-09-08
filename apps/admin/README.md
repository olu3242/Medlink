# MedLink Admin

Wave 2 catalog administration UI. This app consumes MedLink's versioned HTTP API
and contains no medicine business logic or direct database access.

## Run

```bash
npm run dev --workspace @medlink/admin
```

Set `MEDLINK_API_URL` to the canonical origin hosting `/api/v1`. Local development
uses `http://localhost:3000`; hosted runtime fails closed if the variable is absent.
Browser mutations use the prefixed `/admin/api/v1/medicines` routes.

## Routes

- `/catalog` — searchable and filterable medicine catalog
- `/medicine/new` — create a medicine
- `/medicine/:id` — review and edit a medicine

The API is responsible for authentication, authorization, tenant isolation,
validation, audit logging, and clinical policy enforcement.
