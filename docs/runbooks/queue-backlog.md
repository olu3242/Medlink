# Queue backlog

1. Measure queue depth, oldest event age, worker count, and publish failures.
2. Verify the target dependency is healthy before increasing worker capacity.
3. Scale consumers gradually and retain aggregate and tenant ordering.
4. Stop draining if retry or dead-letter rates increase.
5. Confirm queue age and depth return below alert thresholds.
