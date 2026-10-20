const script = document.createElement("script");
script.id = "wise-global-popup-script";
script.src = "/wise-popup.js";
script.dataset.site = "etf";
script.dataset.configUrl = import.meta.env.DEV ? "http://127.0.0.1:3002/api/public/popup" : "https://www.wise-invest.org/api/public/popup";
script.defer = true;
document.head.append(script);
