#!/usr/bin/env node
/**
 * Gives the client's asset tree its generated models.
 *
 * The pipeline lives in `tools/asset-pipeline/node/`: shared geometry helpers, one spec per model, a
 * runner that normalises every build into the art bible's envelope, and a validator that re-measures
 * the shipped files. This file is the workspace-local entry point, so
 * `npm run assets:generate --workspace @happy-farm/web` keeps working from the client package.
 *
 * See `docs/HAPPYFARM_ART_BIBLE.md` for the contract these models satisfy and
 * `tools/asset-pipeline/README.md` for the Blender path.
 */
import "../../../tools/asset-pipeline/node/generate-models.mjs";
