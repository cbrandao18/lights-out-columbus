# Collision Log

A phone-friendly replacement front-end for the **Lights Out Columbus v2.0** Survey123 form.
It sends records to the same ArcGIS feature layer the survey uses, so they show up alongside Survey123 submissions.

## What it fixes
- **Bag ID is yours to set.** Type the ID from the card in the bag (or tap *New ID* to make one). It is never regenerated behind your back.
- **Photos work on iPhone.** Uses Safari's normal photo picker (Photo Library, Take Photo, or Files). Every photo is converted to a standard JPEG (max 2560 px) before upload, so HEIC and large photos are fine.
- **Nothing is lost.** Records and photos are saved on the phone as you type. With no signal, send later.
- **No duplicates.** The bird record is created once. If a photo fails, *Retry photos* re-sends only the missing photos.
- **Copy to a new bird here** for multiple birds at the same spot (keeps building, location, etc.; clears the ID and photos).

## Practice mode
The app starts in **practice mode**: *Send* shows exactly what would be submitted but sends nothing.
Turn it off under *About this app* on the home screen when you're ready to send for real.

## Hosting
It's a static site (no server). Any HTTPS static host works: GitHub Pages, Netlify, Cloudflare Pages.
On iPhone open the URL in Safari, then Share > Add to Home Screen.

## Where data goes
`https://services6.arcgis.com/tuxY7TQIaDhLWARO/arcgis/rest/services/service_a0bd32db2eb9405aac5082db25de5724/FeatureServer/0`
(public, create-only). The bird is added with `applyEdits` (with its own GlobalID), photos with `addAttachment`.
Answer lists (species, buildings) are refreshed from the layer whenever the app is online.

## Testing locally
Serve this folder on localhost; you can point it at a fake layer with `?layer=http://localhost:8080/mock/FeatureServer/0`
(the override only works on localhost).
