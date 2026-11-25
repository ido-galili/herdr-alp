---
name: alp-runs
description: Find and read the dev servers, tasks and commands the person started from Herdr's Run panel (Alp layout), instead of starting a second copy. Use when you need a running server's logs or errors, want to know whether the local stack is up, or need the output of a task the person ran.
---

# Runs started from Alp's Run panel

The person starts the runs in Alp's config (`.herdr/alp.json` in the repo, plus their own) from
Basecamp's Run tab. Each run is a herdr-core terminal with a name and labels. Its output stays readable after it exits.

## Find the runs of this repo

```sh
hc ls --label alp.workspace="$(git rev-parse --show-toplevel)" --json
```

Each terminal's `name` is the handle to read it by. The labels are:

| Label | Value |
|---|---|
| `alp.run` | the entry's name, as the Run tab shows it |
| `alp.run.kind` | `run`, or `compound` for a group |
| `alp.workspace` | the repo root it ran in |
| `alp.run.exit` | the exit code, set once the command ended; absent while it runs |

In a worktree, `alp.workspace` is the worktree's root. A run in the main checkout has the main
checkout's root.

## Read one

```sh
hc read <name> --lines 200
```

A run that ended prints `[<entry> exited with <code>]` as its last line.

## Rules

- Before you start a server or the local stack, check for a run of it. Read the running one
  instead of starting another.
- Don't stop, restart or close a run. The person owns them. Say what you found and ask.
- Don't type into a run's terminal with `hc send`.
