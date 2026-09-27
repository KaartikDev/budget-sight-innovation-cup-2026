import { rebuildTurnIndexFromEvents } from "./turn-projector.js";
import { enqueueFeatureBackfill, processNextFeatureJob } from "./feature-worker.js";
import { db } from "./db.js";
import { EXTRACTOR_VERSION } from "./feature-contract.js";

function optionsFromArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--turn-id") options.turnId = argv[++index];
    else if (argument === "--task-id") options.taskId = argv[++index];
    else if (argument === "--limit") options.limit = Number(argv[++index]);
    else if (["--failed-only", "--retry-failed"].includes(argument)) options.failedOnly = true;
  }
  return options;
}

rebuildTurnIndexFromEvents();
const count = enqueueFeatureBackfill(optionsFromArgs(process.argv.slice(2)));
console.log(`Queued ${count} turn${count === 1 ? "" : "s"} for feature extraction.`);

let processed = 0;
while (true) {
  const ready = db.prepare(`
    SELECT id FROM feature_extraction_jobs
    WHERE extractor_version=? AND state IN ('queued','waiting_for_ollama') AND available_at<=? LIMIT 1
  `).get(EXTRACTOR_VERSION, new Date().toISOString());
  if (!ready) break;
  await processNextFeatureJob({ ignoreDisabled: true });
  processed += 1;
}
console.log(`Processed ${processed} ready job${processed === 1 ? "" : "s"}.`);
