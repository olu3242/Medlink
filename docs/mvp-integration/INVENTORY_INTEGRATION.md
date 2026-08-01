# Inventory Integration

Inventory reads and manual RC1 updates use `@medlink/inventory` ports and always include tenant and pharmacy scope. Availability, price, quantity, and low-stock state come from the inventory system of record. Reservations use inventory locks rather than read-then-write availability checks. External ERP synchronization is outside RC1.
