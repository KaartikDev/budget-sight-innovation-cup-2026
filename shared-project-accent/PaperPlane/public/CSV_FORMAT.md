# PaperPlane CSV format

Export CSV from the dashboard to get a ready-to-import file. The first line must contain exactly these column names (in any order):

`date,tailNumber,srcIcao,destIcao,route,totalFlightTime,picTime,dualReceivedTime,crossCountry,night,solo,instrumentTime,dayLandings,nightLandings,remarks,logbookUrl`

One row represents one flight. Files use UTF-8 and standard CSV quoting: surround values containing commas, quotes, or line breaks with double quotes, and double any quote inside a quoted value. A UTF-8 byte order mark is accepted. Maximum size is 1 MB and maximum length is 1,000 data rows.

| Column | Format |
|---|---|
| `date` | Required, real calendar date, `YYYY-MM-DD` |
| `tailNumber` | Required aircraft registration |
| `srcIcao`, `destIcao` | Required four-letter ICAO airport codes |
| `route`, `remarks` | Optional text |
| `totalFlightTime`, `picTime`, `dualReceivedTime`, `instrumentTime` | Nonnegative decimal hours; blank means zero |
| `dayLandings`, `nightLandings` | Nonnegative whole numbers; blank means zero |
| `crossCountry`, `night`, `solo` | `true` or `false`; blank means `false` |
| `logbookUrl` | Optional HTTP or HTTPS URL |

Example:

```csv
date,tailNumber,srcIcao,destIcao,route,totalFlightTime,picTime,dualReceivedTime,crossCountry,night,solo,instrumentTime,dayLandings,nightLandings,remarks,logbookUrl
2026-09-25,N12345,KLAX,KSFO,"KLAX, KSFO",2.5,2.5,0,true,false,false,0,1,0,"Training, cross-country",
```

Preview is a dry run and writes nothing. It reports row and field errors, plus duplicate candidates. A candidate has the same date, aircraft registration, source and destination airports, and total time as an existing entry or an earlier row in the file. Confirmation imports valid new rows and skips duplicate candidates. If any row has an error, confirmation is blocked. The server checks the file again when confirming. Exports include only the signed-in pilot's entries. Entry IDs, archive matches, timestamps, and account information are not part of the portable format.
