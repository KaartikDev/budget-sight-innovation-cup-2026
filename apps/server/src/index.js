import fs from "node:fs";
import path from "node:path";
import express from "express";
import { app } from "./app.js";
import { config, configurationStatus } from "./config.js";
import { reconcileRuntimes } from "./runtime.js";

reconcileRuntimes();

const webDist = path.join(config.projectRoot, "apps/web/dist");
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(webDist, "index.html"));
  });
}

app.listen(config.port, () => {
  console.log(`BudgetSight server listening on http://localhost:${config.port}`);
  console.log("Configuration:", configurationStatus());
});
