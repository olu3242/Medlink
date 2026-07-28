# MedLink Admin

Wave 2 catalog administration UI. This app consumes MedLink's versioned HTTP API
and contains no medicine business logic or direct database access.

## Run

```bash
npm run dev --workspace @medlink/admin
```

Set `MEDLINK_API_URL` to the origin hosting `/api/v1`. It defaults to
`http://localhost:3000`. Browser mutations use same-origin `/api/v1/medicines`;
deploy the admin app behind the MedLink API gateway or configure an equivalent
proxy at the edge.

## Routes

- `/catalog` — searchable and filterable medicine catalog
- `/medicine/new` — create a medicine
- `/medicine/:id` — review and edit a medicine

The API is responsible for authentication, authorization, tenant isolation,
validation, audit logging, and clinical policy enforcement.
