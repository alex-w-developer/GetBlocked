document.querySelector("#exercise-decoy").addEventListener("click", () => {
  fetch("https://api.segment.io/v1/p?anonymous_id=real-browser-fixture", {
    body: JSON.stringify({
      event: "page_view",
      user_id: "real-browser-fixture",
      traits: { email: "browser-fixture@example.com" }
    }),
    headers: { "content-type": "text/plain" },
    method: "POST",
    mode: "no-cors"
  }).catch(() => {});

  const xhr = new XMLHttpRequest();
  xhr.open(
    "POST",
    "https://api.segment.io/v1/track?client_id=real-browser-fixture"
  );
  xhr.setRequestHeader("content-type", "application/x-www-form-urlencoded");
  xhr.send("event=page_view&device_id=real-browser-fixture");

  navigator.sendBeacon?.(
    "https://analytics.twitter.com/i/adsct?cid=real-browser-fixture",
    "event=page_view&session_id=real-browser-fixture"
  );
});
