# Measuring performance

How to see where time goes in Oculith Draw on a real drawing, and how to
run the repeatable performance check.

## Timings inside the app

The app times its main operations as they happen (`js/core/perf.js`):

- full redraws and pan/zoom frames
- the markup index rebuild
- the Markups List build
- page renders
- saves
- operations an edition plug-in adds

It also counts main-thread stalls: frames that arrive more than 100 ms late.
Only operation names and times are kept, never drawing content.

- **Start with `OPDS_PERF=1`** to write a summary to the app log every minute. The summary is under the `perf` target in `open-pdf-studio.log`, in the app's log folder. Each line gives count, mean, p50, p95 and max per operation.
- **Read them through the MCP bridge** with `app_perf_snapshot`. Pass `reset: true` to start a clean measurement, and `flush: true` to also write the summary to the log.

## The web inspector

- **On the machine itself:** start the app with `OPDS_DEVTOOLS=1` and the web inspector opens with the window. Use the Timelines tab for JavaScript, layout, paint and frames.
- **From another machine (Linux):** start the app with `WEBKIT_INSPECTOR_HTTP_SERVER=127.0.0.1:9333`. Forward that port over SSH and open `http://127.0.0.1:9333` in a WebKit-based browser such as GNOME Web.

## The performance run

1. **Make workloads** with the seeded generator:
   ```
   node scripts/perf/make-workload.mjs work/w-1x20k.pdf --sheets 1 --markups 20000
   node scripts/perf/make-workload.mjs work/w-10x2k.pdf --sheets 10 --markups 2000
   node scripts/perf/make-workload.mjs work/w-dense.pdf --sheets 1 --markups 500 --segments 200000
   ```
   Real drawings can go in the same folder; keep them out of the repository.
2. **Run against an installed build**, with the app closed:
   ```
   node scripts/perf/perf-run.mjs <path-to-open-pdf-studio> work results --label <build>
   ```
   The run starts the app with isolated settings. For each workload it opens the file, zooms in and out, pages through and saves, then records the app's own timings and the memory of the app and its web process.

It prints a table against these budgets, and against the previous run in the results folder:

| Measure | Budget |
| --- | --- |
| Open to first paint | 3 s |
| Pan/zoom frame, p95 | 16.7 ms |
| Full redraw, p95 | 50 ms |
| Markups List build, p95 | 300 ms |
| Save | 2 s |
| Longest stall | 200 ms |
| Memory, app and web process | 1.5 GB |

A measure fails when it is over budget or more than 25 % worse than last time. The run then exits with status 1.
