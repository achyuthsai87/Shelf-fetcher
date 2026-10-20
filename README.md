# Shelf Finder

Search any liquor brand, flavor or type and see which aisle and shelf it sits on. Works offline once installed, and all data stays on the phone (localStorage).

**Live:** https://achyuthsai87.github.io/Shelf-fetcher/

## Install on a phone
- **iPhone (Safari):** Share, then *Add to Home Screen*
- **Android (Chrome):** the three dots menu, then *Install app*

## What's in the app
- **Find:** one search box covers brand, flavor, type, size, aisle and shelf. Several words narrow the results. Type chips (Vodka, Tequila and so on) filter the list.
- **Browse:** every aisle or section as a folder. Open one to see all the bottles on it, in shelf order.
- **Add:** brand is the only required field. *Save and add another* keeps type, size, aisle and shelf filled in for walking a shelf.
- **Find by photo:** tap the camera button next to the search box. Take a photo, paste a picture (a screenshot works), or upload one. The label is read on the phone, matched against your list, and the aisle and shelf appear. For a bottle that isn't listed, *Add as new bottle* opens the Add form with the brand, type and size already filled in.
- **Map:** add a photo of your store drawing or printout and trace a box over each aisle or section. The app draws a clean 3D version of the store, with straight edges and evenly sized blocks, and a glowing green dot sits on the shelf where the bottle is. Search on the Map tab, or tap *Show on map* on any result. *Tidy up* snaps the sections to a neat grid. Sections can be shelves, a counter or a floor marker (entrance, register). Set whether shelf 1 is the top or the bottom shelf.
- **More:** import a pasted list or CSV file (Brand, Flavor, Type, Size, Aisle, Shelf), export everything as CSV, and see where the list is stored.

## Moving the list to another phone
Export CSV on the first phone, send the file, then open *More, Import a list* on the other phone and choose it. Bottles already listed are skipped.

## Deploy
Static site with no build step. Push to `main` and turn on GitHub Pages for the repo root (Settings, Pages, Deploy from branch, `main`, `/ (root)`). Bump `CACHE` in `sw.js` when changing cached files.

## Photo privacy
Photos are never saved, uploaded or cached. A picture exists only in memory while the label is read, then it is wiped. The camera view is captured in the page itself, so no file is created in the phone's photo library. The text reader (Tesseract, in `vendor/tesseract`) is bundled with the app and runs on the device. Open Find by photo once while online so the reader files are stored for offline use. A screenshot taken earlier already sits in the phone's Photos, and the app cannot delete it. On iPhone, tap the screenshot preview, then Done, then *Copy and Delete* to avoid keeping it.

## Map privacy
The store plan photo and the sections you trace are saved on this phone only (not in any account). *Remove map* in the Map tab deletes them. Bottle photos used in Find by photo are still never saved.
