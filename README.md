# REBUILD PWA

## What this version includes
- Mobile-first dashboard
- Weeks 1–2 and Weeks 3–4 program phases
- Sunday-through-Saturday daily workouts
- Readiness check for Achilles/back
- Exercise demos via YouTube search links
- Set check-offs and exercise completion
- Rest timer
- Steps and bodyweight logging
- Training history
- Data export
- Offline caching / installable PWA support

## Important hosting note
For full PWA/Home Screen behavior, these files must be served over HTTPS from a web host.
Opening index.html directly from Files will display the app, but service workers/offline installation may not work.

## Good deployment targets
- GitHub Pages
- Cloudflare Pages
- Netlify
- Vercel

After deployment, open the HTTPS link in Safari on iPhone:
Share -> Add to Home Screen -> Open as Web App.

## Data
This MVP stores workout data in the browser using localStorage.
That means your history stays on that device/browser unless you export the backup JSON.
A later version can sync to Google Sheets or another cloud database.
