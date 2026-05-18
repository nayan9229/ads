(function () {
  "use strict";

  function renderMockCreative(doc, adId) {
    doc.open();
    doc.write(
      '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
        "html,body{margin:0;padding:0;height:100%;font-family:system-ui,sans-serif;}" +
        ".mock{box-sizing:border-box;width:100%;height:100%;background:#7cf;color:#013;" +
        "display:flex;flex-direction:column;align-items:center;justify-content:center;" +
        "border:2px dashed #036;}" +
        ".mock b{font-size:14px;letter-spacing:0.5px;}" +
        ".mock span{font-size:11px;opacity:0.7;margin-top:4px;}" +
        '</style></head><body><div class="mock" data-mock-ad>' +
        "<b>MOCK AD</b><span>" +
        adId +
        "</span></div></body></html>",
    );
    doc.close();
  }

  window.MOCK_PBJS_CALLS = { requestBids: [] };

  var slotSize = {};
  var slotMediaType = {};

  window.pbjs = {
    que: [],
    setConfig: function () {},
    addAdUnits: function (units) {
      for (var i = 0; i < units.length; i++) {
        var u = units[i];
        if (u.mediaTypes && u.mediaTypes.native) {
          slotMediaType[u.code] = "native";
        } else {
          slotMediaType[u.code] = "banner";
          var sizes = (u.mediaTypes && u.mediaTypes.banner && u.mediaTypes.banner.sizes) || [
            [300, 250],
          ];
          slotSize[u.code] = sizes[0];
        }
      }
    },
    requestBids: function (args) {
      window.MOCK_PBJS_CALLS.requestBids.push({
        adUnitCodes: args.adUnitCodes.slice(),
        ts: Date.now(),
      });
      setTimeout(function () {
        args.bidsBackHandler({});
      }, 30);
    },
    getHighestCpmBids: function (code) {
      var scenario = window.MOCK_BIDDER_SCENARIO || "all-win";
      if (scenario === "no-fill") return [];

      if (slotMediaType[code] === "native") {
        var nativeBids = window.MOCK_NATIVE_BIDS || {};
        var override = nativeBids[code];
        return [
          {
            adId: "native_" + code + "_" + Date.now(),
            cpm: 2.5,
            mediaType: "native",
            native: override || {
              title: "Mock Native Ad",
              body: "Demonstrating native rendering.",
              cta: "Learn more",
              sponsoredBy: "MockCo",
              image: { url: "https://placehold.co/300x150/036/fff?text=Native" },
              clickUrl: "https://example.com/landing",
              clickTrackers: [],
              impressionTrackers: [],
            },
          },
        ];
      }

      var sz = slotSize[code] || [300, 250];
      return [
        {
          adId: "mock_" + code + "_" + Date.now(),
          width: sz[0],
          height: sz[1],
          cpm: 1.5,
          mediaType: "banner",
        },
      ];
    },
    removeAdUnit: function () {},
    renderAd: function (doc, adId) {
      renderMockCreative(doc, adId);
    },
  };
})();
