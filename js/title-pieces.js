(function () {
  function mountTitlePieces() {
    if (!window.PieceArt) return;
    document.querySelectorAll("[data-piece-art]").forEach(function (el) {
      var t = el.getAttribute("data-piece-art");
      var cls = el.getAttribute("data-piece-classes") || "piece-svg piece-svg--staunton";
      if (!t) return;
      var ah = el.getAttribute("aria-hidden");
      var forced = el.getAttribute("data-piece-color");
      var color;
      if (forced === "w" || forced === "b") {
        color = forced;
      } else {
        var card = el.closest(".side-card");
        color =
          card && card.classList.contains("side-card--black")
            ? "b"
            : card && card.classList.contains("side-card--white")
              ? "w"
              : "w";
      }
      el.innerHTML = PieceArt.svg(t, cls, {
        color: color,
        ariaHidden: ah !== "false",
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountTitlePieces);
  } else {
    mountTitlePieces();
  }
})();
