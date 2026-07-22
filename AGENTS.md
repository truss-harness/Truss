# Agent Instructions

When starting Truss for validation, use a non-launching command so repeated test runs do not open browser tabs.

Preferred commands:

```bash
bun run start
bun run truss spawn . --no-autolaunch
```

Do not run `bun run truss spawn` without `--no-autolaunch` during automated validation unless the task specifically requires browser autolaunch behavior.
