# GoRouteX marketing redesign

## Scope and design read
Business SaaS marketing for delivery teams. Clean, confident, blue brand identity. Taste settings: design variance 6, motion intensity 3, visual density 3. Native HTML/CSS matches the existing static-site architecture; no application framework added.

## Existing-page audit
The page used navy text, blue accents, a GX mark, system text mixed with externally loaded Manrope/Sora, and many rounded cards. Repeated benefits and a large simulated planner obscured the main selling point. Navigation anchors, login/signup destinations, SEO title/description, brand mark, free-plan facts and Coming Soon disclosures were retained. No customer testimonials or savings statistics were invented.

## Delivered changes
- Split hero with a direct route-planning message and custom generated delivery photography.
- Consistent blue palette, spacing, typography and corner sizes, with system dark mode.
- Open benefit layout, use cases, simple workflow, compact pricing and expandable comparison/FAQ.
- Prices reflect the existing SGD billing configuration: GoPlan 5/month, ProPlan 20/month or 200/year. No checkout or payment logic changes.
- Shared product definitions still supply plan limits and feature eligibility.
- Responsive WebP images, lazy loading for the second photograph, local icon, no external fonts.
- Mobile menu supports Escape, link selection and outside-click dismissal.

## Validation
- Browser checks at 390, 768, 1024 and 1440 pixels, light and dark: no horizontal page overflow, all three plan cards rendered, both images loaded, all anchor targets valid, no JavaScript errors. Menu, Escape, FAQ and full comparison checked.
- Local Lighthouse mobile audit: performance 100, accessibility 100, best practices 100, SEO 100. LCP 1.8 seconds, CLS 0, total blocking time 0 milliseconds. These are local lab results, not production field measurements.
- Build completed with the marketing assets included in dist.
- Source changes are limited to index.html, marketing-site.css, marketing-site.js and marketing image/icon assets. App, route, login, subscription and restriction code were not edited.

## Delivery
Local preview: http://localhost:8891/index.html. This redesign has not been deployed to production.
