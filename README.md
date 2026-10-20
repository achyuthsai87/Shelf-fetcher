# Shelf Finder

Search any liquor brand, flavor or type and see which aisle and shelf it sits on. Works offline once installed, and all data stays on the phone (localStorage).

## Install on a phone
- **iPhone (Safari):** Share, then *Add to Home Screen*
- **Android (Chrome):** the three dots menu, then *Install app*

## What's in the app
- **Find:** one search box covers brand, flavor, type, size, aisle and shelf. Several words narrow the results. Type chips (Vodka, Tequila and so on) filter the list.
- **Browse:** every aisle or section as a folder. Open one to see all the bottles on it, in shelf order.
- **Add:** brand is the only required field. *Save and add another* keeps type, size, aisle and shelf filled in for walking a shelf.
- **More:** import a pasted list or CSV file (Brand, Flavor, Type, Size, Aisle, Shelf), export everything as CSV, and see where the list is stored.

## Moving the list to another phone
Export CSV on the first phone, send the file, then open *More, Import a list* on the other phone and choose it. Bottles already listed are skipped.

## Deploy
Static site with no build step. Push to `main` and turn on GitHub Pages for the repo root (Settings, Pages, Deploy from branch, `main`, `/ (root)`). Bump `CACHE` in `sw.js` when changing cached files.
