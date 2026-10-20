# Editing the Resources tab

The Resources tab and the Shift checklists come from a Google Sheet. Edit the sheet, and volunteers see the change the next time they open the app with signal.

**Everything in this sheet is public.** Anyone who opens the app can see it, so keep the schedule, phone numbers and volunteer names in Discord.

## One-time setup
1. Make a new Google Sheet, then go to File › Import › Upload and choose `resources-template.csv`. Pick "Replace current sheet".
2. Go to File › Share › Publish to web. Choose that sheet and **Comma-separated values (.csv)**, then click Publish and copy the link.
3. Paste the link into `config.js` as `resourcesCsv`, or send it to whoever maintains the app.

## How the sheet works
Each row is one piece of content, and rows show up in the same order as the sheet.

| column | what goes in it |
|---|---|
| section | The collapsible section the row belongs to, e.g. `Parking`. Each new name starts a new section. |
| kind | The type of row (see below). |
| title | Heading or link text. For a `stop`, the stop number. |
| text | Paragraph text, caption, address, or one list item per line. |
| link | A web address, or a file name that ships with the app. |

**Kinds**
- `quick`: a big button at the top of the tab. Leave `section` blank. `title` is the label, `text` is the small line under it, and `link` is where it goes.
- `heading`: a small heading inside a section (`title`).
- `note`: a paragraph (`text`).
- `callout`: a highlighted paragraph (`text`).
- `list`: bullet points, one per line in `text`.
- `address`: an address with Apple Maps and Google Maps buttons (`text`).
- `image`: a picture (`link`) with an optional caption (`text`). For a photo in Google Drive, set sharing to "Anyone with the link" and paste the share link.
- `link`: a button that opens a link (`title`, `link`). Links in a row next to each other are grouped together.
- `stops`: shows the stop list for the route named in `title`.
- `stop`: one stop on a route. `section` is the route name (e.g. `Broad St. route`), `title` is the stop number, and `text` is the building. These rows also make up the checklist on the Shift tab, so a new route name adds a new route.

## Each season
- Edit parking notes, swap in new route maps, and add or remove stops.
- Change the training video link in both `quick` and `Printouts and guides`.
- Nothing needs to be published again, because the published link updates on its own (Google can take about 5 minutes).
