# LogMate SEO implementation guide

This repository currently has one public marketing URL: `https://logmate.co.za/`. The feature and pricing content is rendered on the home page, while the files under `/html/` are application, authentication, checkout, recovery, or utility routes. Keep those private routes out of search results.

## 1. Sitemap and robots

The root `sitemap.xml` contains only URLs that exist today. When standalone public pages are created, add them with their final canonical URLs:

```xml
<url>
  <loc>https://logmate.co.za/features/</loc>
  <changefreq>monthly</changefreq>
  <priority>0.8</priority>
</url>
<url>
  <loc>https://logmate.co.za/pricing/</loc>
  <changefreq>monthly</changefreq>
  <priority>0.8</priority>
</url>
<url>
  <loc>https://logmate.co.za/sars-compliance/</loc>
  <changefreq>monthly</changefreq>
  <priority>0.7</priority>
</url>
<url>
  <loc>https://logmate.co.za/privacy/</loc>
  <changefreq>yearly</changefreq>
  <priority>0.4</priority>
</url>
```

Do not include dashboard URLs: they require authentication, contain user-specific data, and are not useful landing pages. `robots.txt` blocks the application directory and points crawlers at the sitemap. Blocking a URL does not remove an already indexed URL, so retain the page-level `noindex` tags below and return authenticated pages normally for users.

## 2. Private page protection

Every page under `/html/` should include this head element. It is present on the current private routes, including overview, vehicles, fill-ups, trips, reports, analytics, help, fleet, settings, login, checkout, reset, and offline pages:

```html
<meta name="robots" content="noindex, nofollow, noarchive">
```

The HTTP equivalent is useful as a deployment backstop:

```apache
<FilesMatch "^(dashboard|vehicles|logbook|trip|report|trip-report|analytics|help|fleet|settings|login|checkout|reset-password|offline|add-vehicle)\.html$">
  Header set X-Robots-Tag "noindex, nofollow, noarchive"
</FilesMatch>
```

## 3. Public head template

Use one self-referencing canonical per public page, with a unique title and description. Canonical URLs must use HTTPS, the production host, and a stable trailing-slash policy.

```html
<title>South African vehicle and fuel logbook | LogMate</title>
<meta name="description" content="Track vehicle costs, fuel, trips, service history, and SARS-oriented mileage records in one secure South African logbook.">
<link rel="canonical" href="https://logmate.co.za/">
<meta name="robots" content="index, follow">
<link rel="alternate" hreflang="en-ZA" href="https://logmate.co.za/">
```

Suggested public metadata:

| URL | Title | Description |
| --- | --- | --- |
| `/` | `LogMate | Vehicle, fuel, and trip logbook` | `Track vehicles, fuel, trips, service reminders, and SARS-oriented mileage records in one secure South African driving logbook.` |
| `/features/` | `Vehicle and trip logbook features | LogMate` | `Record fill-ups, live and manual trips, service history, reminders, reports, and offline driving data with LogMate.` |
| `/pricing/` | `LogMate pricing | Personal and fleet vehicle tracking` | `Compare LogMate plans for personal driving, business mileage, fuel records, analytics, and fleet reporting.` |
| `/sars-compliance/` | `SARS-oriented vehicle logbook reports | LogMate` | `Keep trip dates, odometers, destinations, business reasons, and distance splits ready for your own South African tax records.` |
| `/privacy/` | `Privacy notice | LogMate` | `Read how LogMate handles account, vehicle, trip, fuel, location, and service data.` |

## 4. Structured data

Place this JSON-LD on the public home page. Keep prices, ratings, and availability out unless they are maintained from authoritative current data.

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "WebApplication",
  "name": "LogMate",
  "url": "https://logmate.co.za/",
  "description": "Vehicle, fuel, trip, and service logbook for South African drivers and small fleets.",
  "applicationCategory": "BusinessApplication",
  "operatingSystem": "Web browser, Android, iOS",
  "browserRequirements": "Requires JavaScript and a modern browser",
  "inLanguage": "en-ZA",
  "publisher": {
    "@type": "Organization",
    "name": "LogMate",
    "url": "https://logmate.co.za/"
  }
}
</script>
```

## 5. Headings, images, and links

Use one visible `h1` per public page, then `h2` for page sections, `h3` for cards or feature groups, and `h4` for details. Bootstrap classes such as `h1`, `h2`, and `h3` may style headings, but do not replace semantic heading elements with styled `div`s.

```html
<h1 class="display-4">Keep every journey moving.</h1>
<h2 class="h3">Everything connected</h2>
<h3 class="h5">Capture every stop</h3>
```

Images that convey meaning need useful alternatives; decorative marks use `alt=""`. Charts need a nearby text summary or `aria-label`, not just an empty SVG container.

```html
<img src="assets/dashboard-preview.webp" width="960" height="640" alt="LogMate dashboard showing fuel, trip, and vehicle summaries">
```

Run this in DevTools to audit image alternatives:

```js
[...document.images].filter((image) => !image.hasAttribute("alt") || image.alt.trim() === "").map((image) => image.src);
```

Use root-relative links for public URLs (`/features/`) and document-relative links only inside the current static app directory (`../html/login.html`). Run a crawler such as the free desktop version of Screaming Frog SEO Spider, or `lychee` in CI, to catch dead navigation anchors.

## 6. Performance and mobile checks

- Set explicit `width` and `height` or `aspect-ratio` on logos, previews, charts, and dashboard placeholders to prevent CLS.
- Load only the Bootstrap bundle and modules needed by the current page; defer non-critical scripts.
- Keep dashboard grids on Bootstrap responsive columns such as `col-12 col-lg-6` and allow tables to scroll horizontally.
- Test navigation, forms, charts, and reports at 320px, 375px, 768px, and 1280px widths.
- Measure LCP, INP, and CLS in Lighthouse and PageSpeed Insights on a production build.
- Convert large raster assets to WebP or AVIF with `sharp`, Squoosh CLI, or ImageMagick; preserve SVG for simple logos and icons.

## 7. HTTPS, URLs, and backlinks

Apache deployment:

```apache
RewriteEngine On
RewriteCond %{HTTPS} !=on
RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [R=301,L]
Header always set Strict-Transport-Security "max-age=31536000; includeSubDomains"
```

Use readable slugs such as `/reports/fuel/`, `/reports/trips/`, `/help/`, and `/privacy/`. Keep query parameters for filters, not page identity. Nginx equivalents should use a separate HTTP server block with `return 301 https://$host$request_uri;`.

Build legitimate links by publishing a South African mileage-logbook explainer with original examples, partnering with local automotive and SME accountants for genuinely useful resources, and contributing data-led fuel-cost or business-mileage guides that cite LogMate as the source. Avoid paid link schemes and mass directory submissions.