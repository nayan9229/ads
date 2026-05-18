# Prebid Wrapper SDK (Production-Ready JS Package)

## Overview

This project is a production-ready JavaScript SDK wrapper around Prebid.js that simplifies ad rendering for publishers and applications.

The SDK will:

- Initialize with a single configuration object
- Dynamically inject ad containers into the DOM
- Load and initialize Prebid.js asynchronously
- Support:
  - Banner Ads
  - Video Ads
  - Native HTML Ads
- Execute parallel bidding requests across configured demand partners
- Select and render the highest CPM winning ad
- Render Video Ads exclusively using Google IMA SDK
- Expose lifecycle callbacks and analytics hooks
- Provide a production-ready testing page
- Bundle into a single lightweight distributable JS file
- Avoid bundling external dependencies inside the SDK
- Load third-party libraries asynchronously at runtime
- Follow industry-standard Prebid.js implementation practices

---

# Goals

## Primary Goals

1. Simplify Prebid.js integration
2. Provide a declarative configuration-driven API
3. Support all major ad formats
4. Maintain optimal performance
5. Avoid Prebid policy violations
6. Keep implementation modular internally
7. Output a single distributable bundle
8. Support enterprise-grade observability and debugging

---

# Supported Ad Formats

## 1. Banner Ads

Supported:
- 300x250
- 320x50
- 728x90
- 970x250
- Responsive sizes

Features:
- Dynamic slot injection
- Multi-bidder support
- Refresh support
- Lazy loading
- Viewability tracking

---

## 2. Video Ads

Supported:
- Instream Video
- Outstream Video
- Rewarded Video (future phase)
- VAST
- VPAID (optional)
- VMAP (future phase)

Requirements:
- Render ONLY using Google IMA SDK
- Prebid Video Module integration
- Video cache support
- Ad podding support (future phase)

Features:
- Auto play policies
- Mute/unmute handling
- Mobile support
- Quartile tracking
- Skip support
- Error recovery
- Timeout fallback

---

## 3. Native HTML Ads

Supported:
- Image
- Title
- Description
- CTA
- Sponsored by
- Icon

Features:
- Fully customizable rendering templates
- Secure HTML rendering
- Click tracking
- Impression tracking
- Asset validation

---

# High-Level Architecture

```text
Publisher Page
      |
      V
Wrapper SDK
      |
      |---- Config Manager
      |---- DOM Injection Manager
      |---- Prebid Adapter Layer
      |---- Bid Orchestrator
      |---- Renderer
      |---- Event Bus
      |---- Analytics Layer
      |---- Error Manager
      |
      V
Prebid.js
      |
      V
Demand Partners
```

---

# SDK Workflow

```text
SDK Init
   |
   V
Validate Config
   |
   V
Inject Ad Containers
   |
   V
Load External Dependencies
   |
   |--- Prebid.js
   |--- Google IMA SDK
   |
   V
Initialize Prebid
   |
   V
Request Bids (Parallel)
   |
   V
Auction Complete
   |
   V
Select Highest CPM
   |
   +--- Banner Render
   |
   +--- Native Render
   |
   +--- Video Render via IMA
   |
   V
Callbacks + Analytics
```

---

# Recommended Project Structure

```text
project-root/
│
├── src/
│   ├── core/
│   ├── prebid/
│   ├── renderers/
│   ├── dom/
│   ├── analytics/
│   ├── callbacks/
│   ├── utils/
│   └── index.ts
│
├── test-page/
├── dist/
├── rollup.config.js
├── tsconfig.json
├── package.json
└── README.md
```

---

# SDK Public API

## Initialization

```javascript
AdWrapper.init({
  debug: true,
  timeout: 1200,
  prebidSrc: "https://cdn.jsdelivr.net/npm/prebid.js",
  imaSdkSrc: "https://imasdk.googleapis.com/js/sdkloader/ima3.js",

  adUnits: [
    {
      id: "banner_1",
      type: "banner",
      sizes: [[300, 250]],
      bidders: []
    }
  ]
});
```

---

# Lifecycle Callbacks

```javascript
{
  onInit: () => {},
  onReady: () => {},
  onBidRequested: () => {},
  onBidResponse: () => {},
  onAuctionStart: () => {},
  onAuctionEnd: () => {},
  onAdRenderSuccess: () => {},
  onAdRenderFail: () => {},
  onTimeout: () => {},
  onNoFill: () => {},
  onError: () => {},
  onDestroy: () => {}
}
```

---

# Dependency Loading Strategy

## External Dependencies

These MUST NOT be bundled:

| Dependency | Strategy |
|---|---|
| Prebid.js | Async CDN load |
| Google IMA SDK | Async CDN load |
| GPT (optional) | Async CDN load |

---

# Build Requirements

## Tooling

| Tool | Purpose |
|---|---|
| TypeScript | Type safety |
| Rollup | Bundling |
| Babel | ES5 transpilation |
| ESLint | Linting |
| Prettier | Formatting |
| Jest | Unit tests |
| Playwright | Browser testing |

---

# Compliance Requirements

## MUST FOLLOW

- Prebid.js official architecture
- IAB standards
- Google IMA SDK guidelines
- GDPR compliance hooks
- CCPA compliance hooks
- TCF v2 support

---

# Deliverables

## Final Deliverables

### 1. SDK
- Single production bundle
- Source maps
- Minified version

### 2. Documentation
- README
- API documentation
- Integration guide

### 3. Test Environment
- Advanced HTML demo page
- Mock bidders
- Debug tools

### 4. CI/CD
- Build pipeline
- Test automation
- Linting pipeline

---

# Example Usage Requested

```html
<!DOCTYPE html>
<html lang="en">

<head>
    <title>300x250</title>
    <meta charset="UTF-8">
    <meta name="viewport"
        content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
    <meta name="ad.size" content="width=300,height=250">
</head>

<body>
    <script id="1729" src="JS_FILE"></script>
</body>

</html>
```

---

# Success Criteria

The SDK is considered complete when:

- Banner ads render successfully
- Video ads render through IMA SDK
- Native ads render correctly
- Highest CPM wins
- All requests happen in parallel
- External dependencies load dynamically
- Bundle remains lightweight
- No Prebid policy violations exist
- SDK is stable in production environments
