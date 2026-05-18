/* global window */
(function (global) {
  /**
   * Standard Unicode chess symbols (same as most docs / UTF-8 chess text).
   * White: hollow/outline forms U+2654–2659. Black: filled forms U+265A–265F.
   */
  var UNICODE = {
    w: { k: "\u2654", q: "\u2655", r: "\u2656", b: "\u2657", n: "\u2658", p: "\u2659" },
    b: { k: "\u265a", q: "\u265b", r: "\u265c", b: "\u265d", n: "\u265e", p: "\u265f" },
  };

  function glyph(type, color) {
    var side = color === "b" ? "b" : "w";
    var row = UNICODE[side];
    return (row && row[type]) || UNICODE.w.p;
  }

  /**
   * @param {string} type - p,n,b,r,q,k
   * @param {string} className - CSS classes on root <svg>
   * @param {{ color?: string, ariaHidden?: boolean }} [opts] - color 'w'|'b' for correct symbol
   */
  function svg(type, className, opts) {
    opts = opts || {};
    var cls = className || "piece-svg piece-svg--staunton";
    var aria = opts.ariaHidden === false ? "" : ' aria-hidden="true"';
    var ch = glyph(type, opts.color);
    return (
      '<svg class="' +
      cls +
      '" width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"' +
      aria +
      '><text class="piece-svg__unicode" x="12" y="12" text-anchor="middle" dominant-baseline="central">' +
      ch +
      "</text></svg>"
    );
  }

  global.PieceArt = { svg: svg, glyph: glyph, UNICODE: UNICODE };
})(typeof window !== "undefined" ? window : this);
