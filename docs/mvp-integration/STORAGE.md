# Secure Storage

Prescription objects reside in a private bucket named by `PRESCRIPTION_STORAGE_BUCKET`. The `PrivateDocumentStore` contract requires tenant-scoped writes, short-lived signed reads, and reasoned deletion. Upload validation permits JPEG, PNG, and PDF up to 10 MiB by default. Production certification additionally requires bucket RLS, encryption, retention/deletion jobs, malware scanning policy, and restore evidence from the deployment environment.
