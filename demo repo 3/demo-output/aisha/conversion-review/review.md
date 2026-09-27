# Conversion review

**Page reviewed:** static `index.html` / `styles.css`  
**Lens:** product-page conversion, message clarity, hierarchy, accessibility, and mobile behavior

## Priorities

### P0 — Make the offer match the intended product
The page currently welcomes visitors and shares YouTube trivia. It does not explain BudgetSight, who it serves, what problem it solves, or what a visitor can do next. If this is meant to represent BudgetSight, the current message and all three facts are off-task; visitors have no reason to trust or convert on a budgeting product. Replace the demo content with a clear audience, outcome, and proof before polishing the visual design.

### P1 — Give the hero one concrete promise and one meaningful action
“Hello, world!” and “A tiny page with a big welcome” set a playful mood but no expectation of product value. The primary button, “See the fun facts,” only scrolls to trivia, while the secondary link exits to YouTube. Neither advances a BudgetSight evaluation. Lead with the practical outcome and make the main action something like starting a demo or seeing how it works.

### P1 — Reorder the hierarchy around a decision
The oversized greeting and decorative video player dominate the first screen. There is no product preview, benefit summary, evidence, or audience cue. Put the value proposition and primary CTA first, then a compact product visual, key benefits, and trust/proof content. Keep decorative elements subordinate to the decision path.

### P2 — Tighten accessibility and link clarity
Keyboard focus is visible and reduced-motion preferences are considered. The hero illustration has an `aria-label` on a generic `div`, which does not reliably expose an accessible name; mark it decorative if redundant, or use a semantic figure with a caption. The play control is a link and already has an informative label, but its small target and the several generic “Read the story / Explore the report / See the source” links could be more explicit. Give each link a destination-specific accessible name, verify text and focus contrast, and preserve a clear heading order.

### P2 — Check the narrow layout in a browser
The layout stacks below 900px and facts become one column below 650px, which is a sensible base. At phone widths, the rotated video card, 355px orbit, and floating note may crowd or clip; the hero retains a 615px minimum height as its contents stack, which can create excess space. Check 320–390px widths, long text, zoom, and keyboard navigation; remove unnecessary fixed minimum height and let the artwork scale without overlap.

## Five easy wins

1. Replace the greeting with a one-line BudgetSight outcome for a named audience.
2. Change the main CTA from “See the fun facts” to a high-intent, truthful next step such as “Explore the demo.”
3. Add one short supporting line under the hero explaining what BudgetSight helps users do.
4. Replace the YouTube trivia illustration with a real product screenshot or a simple, labeled product preview.
5. Clarify outbound link names and test the hero and artwork at 320px, including focus and reduced-motion states.

## Replacement hero copy

**Eyebrow:** BUDGETING THAT’S EASIER TO SEE  
**Headline:** Make your money make sense.  
**Supporting copy:** BudgetSight brings your spending and budget into one clear view, so you can spot patterns and decide what to do next.  
**Primary CTA:** Explore the BudgetSight demo

Use “Explore the BudgetSight demo” only if it opens a working demo. If the demo is not available, use an action the page can fulfill, such as “See how BudgetSight works,” and link it to a genuine product walkthrough.
