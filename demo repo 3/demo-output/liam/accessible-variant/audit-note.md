# Accessibility audit note

Audited the source `index.html` and `styles.css`; this standalone variant keeps the welcoming “Hello, world!” hero, decorative video-player illustration, and three YouTube fact cards.

- **Structure and navigation:** Added a skip link, landmark-based page structure, one clear page heading, labelled content sections, and article elements for the facts. Decorative artwork and emoji are hidden from assistive technology; the artwork has a concise image description.
- **Keyboard access:** Kept links as native links, added a high-visibility `:focus-visible` outline, and gave the skip link a visible-on-focus state. External links announce that they open a new tab.
- **Contrast:** Raised muted copy and decorative labels to lighter values, strengthened orbit and divider strokes, and made illustration labels legible. Fact-card text uses dark ink on pastel backgrounds. Approximate key pairs: muted body `#c3c5ce` on `#10121b` ≈ 10:1; dark card text `#24232a` on the lightest pastel `#d7ecbb` ≈ 10:1; lime `#e9ff82` on page background ≈ 17:1.
- **Motion and reflow:** Reduced-motion preferences disable smooth scrolling and movement transitions. Grid layouts collapse progressively to one column; text and controls wrap on narrow screens without a fixed page width.

This is a code-level audit, not a substitute for checking with screen readers, browser zoom, and real devices. The inherited factual claims and source links were retained, not independently fact-checked.
