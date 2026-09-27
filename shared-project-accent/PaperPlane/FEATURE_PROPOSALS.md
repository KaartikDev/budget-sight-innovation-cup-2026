# PaperPlane feature proposals

Source reviewed: `griffing52/PaperPlane` on GitHub, `main` commit `65c30aab47fd9d848e55cd9dfd616c96f8160ea3`.

The assignments below are to named regular users found in the local BudgetSight account database. They are documented ownership assignments; no BudgetSight task or GitHub issue has been created.

| # | Feature | Intended user | BudgetSight owner |
|---|---|---|---|
| 1 | Review OCR results before import | Pilot digitizing a paper logbook | Maya Chen (`maya.chen`) |
| 2 | Rolling currency dashboard | Pilot preparing for a flight | Jordan Patel (`jordan.patel`) |
| 3 | CSV export and import | Pilot moving between logbook products | Sofia Ramirez (`sofia.ramirez`) |
| 4 | Verification evidence and retry | Pilot correcting an unmatched flight | Liam O'Connor (`liam.oconnor`) |
| 5 | Search, filters, and saved views | Pilot with hundreds of entries | Aisha Thompson (`aisha.thompson`) |

## 1. Review OCR results before import — Maya Chen

**Current gap:** `app/dashboard/page.tsx` saves every OCR record immediately. `UploadPreviewModal.tsx` shows only the source image and a completion state.

**Behavior:** After upload, show parsed rows beside the image. The pilot can edit each field, reject individual rows, and confirm the remaining rows. Flag missing date, tail number, source, or destination and possible duplicates against existing entries. Save only after confirmation.

**Acceptance:** Uploading a page with three recognized rows and one bad row creates zero entries before confirmation; the pilot can correct or discard the bad row; confirmation creates exactly the selected rows; a failed save names the affected row without duplicating successful rows on retry.

**Likely areas:** `ocr/`, `app/dashboard/page.tsx`, `components/dashboard/UploadPreviewModal.tsx`, and the flight entry API.

## 2. Rolling currency dashboard — Jordan Patel

**Current gap:** `StatusBar.tsx` sums all historical time and compares it with fixed goals; it does not calculate dated activity windows.

**Behavior:** Add cards for landings, night landings, and instrument activity over configurable rolling windows. Each card shows the window dates, qualifying entries, next expiration, and a link that filters the logbook to the counted flights. Keep the rule set versioned and label any result that cannot be determined from existing entry fields. Aviation rules should be validated with a qualified subject matter reviewer before the UI describes a pilot as current.

**Acceptance:** Changing the date of a qualifying entry across a window boundary changes the count immediately; an entry without the required detail is shown as incomplete; the user can inspect every counted entry.

**Likely areas:** `components/dashboard/StatusBar.tsx`, `app/dashboard/page.tsx`, `types/logbook.ts`, and possibly the Prisma entry model for missing detail.

## 3. CSV export and import — Sofia Ramirez

**Current gap:** The app has CRUD routes for flight entries but no bulk portability workflow.

**Behavior:** Export a signed-in pilot's entries to a documented CSV format with one row per flight. Import the same format through a preview that validates dates, ICAO codes, hour fields, and duplicate candidates. Support a dry run and a confirmed import; scope both operations to the authenticated user.

**Acceptance:** Export then import into a fresh account preserves all supported entry fields; malformed rows are reported with row number and field; a dry run writes nothing; another user's entries are never included in an export.

**Likely areas:** `server/src/routes.ts`, `server/src/controllers/FlightEntryController.ts`, `server/src/schema.ts`, `lib/api/logbook.ts`, and the dashboard.

## 4. Verification evidence and retry — Liam O'Connor

**Current gap:** Verification results live in browser local storage in `app/dashboard/page.tsx`. The UI shows only success or failure, and `server/src/verify.ts` selects the first candidate within the duration tolerance.

**Behavior:** Persist verification status, checked time, matched archived flight ID, and a reason for no match on each entry. Show the compared date, tail number, airports, and duration. Let the pilot edit an entry and retry; clear stale status when matching fields change. If several archive flights match, present candidates instead of silently choosing the first.

**Acceptance:** Status is consistent after sign-out and on a second device; editing a matching field invalidates the old result; an unmatched result explains which criteria failed; the API cannot verify or inspect another user's entry.

**Likely areas:** `server/prisma/schema.prisma`, `server/src/verify.ts`, `server/src/routes.ts`, `lib/api/logbook.ts`, and `components/dashboard/LogbookList.tsx`.

## 5. Search, filters, and saved views — Aisha Thompson

**Current gap:** `LogbookList.tsx` renders the full entry array in date order without search or filters.

**Behavior:** Filter by date range, tail number, source/destination, verification state, and remarks text. Add sort by date and total hours. Save named filter sets per user, with a clear active-filter indicator and one-click reset. Apply filters on the server so large logbooks do not require fetching every row.

**Acceptance:** Filters combine predictably; the table, selection count, and exported subset refer to the same visible result set; a saved view survives sign-out; a pilot cannot retrieve another pilot's saved views.

**Likely areas:** `server/src/controllers/FlightEntryController.ts`, `server/src/schema.ts`, `app/dashboard/page.tsx`, `components/dashboard/LogbookList.tsx`, and a saved-view model.
