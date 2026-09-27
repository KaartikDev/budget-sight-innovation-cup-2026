# Reusable checklist: presenting Erdős-related material

Use this before drafting, presenting, or revising an Erdős problem explanation. Tailor the depth to the audience; keep the claims and attribution exact.

## Purpose and audience

- [ ] Name the intended audience(s): general, mathematically curious, undergraduate, specialist, or mixed.
- [ ] State one sentence the audience should remember.
- [ ] Identify expected background and define any prerequisite that cannot be assumed.
- [ ] Decide what belongs in the main explanation and what can be optional technical detail.

## Question and result

- [ ] State the original question in plain language before introducing dense notation.
- [ ] Define what is counted, over what range, and under which assumptions.
- [ ] Explain unfamiliar asymptotic language (for example, `o(k)`) in words.
- [ ] Give the answer early, with the decisive construction or theorem stated precisely.
- [ ] Tell the reader what the result does and does not establish.

## Explanatory path

- [ ] Preview the proof’s main steps and why each is needed.
- [ ] Use a small example or diagram to reveal the pattern before relying on abstraction.
- [ ] Pair every analogy or example with its exact mathematical counterpart.
- [ ] Introduce notation only when needed; define it at first use and keep it consistent.
- [ ] Signpost transitions (“first the growth condition,” “now the coverage claim”).
- [ ] Separate logically independent proof obligations.
- [ ] Explain the key inference between equations; do not make the audience supply it.
- [ ] Check endpoints, exceptional cases, quantifiers, and domains explicitly.
- [ ] End with a one-sentence interpretation that returns to the original question.

## Erdős Problem 280: content-specific checks

- [ ] State `n_i = 2^i` and `a_i = 1 + 2^(i−1) mod 2^i` unambiguously.
- [ ] Separate the growth proof `2ᵏ > 2k log k` from the residue coverage proof.
- [ ] Define `v₂(x)` only for nonzero `x`, and handle `m = 1` separately.
- [ ] Include `m = 0`: `m − 1 = −1`, so `v₂(−1) = 0`.
- [ ] Show `t = v₂(m − 1) ≤ k − 1`, hence index `t + 1 ∈ {1, …, k}`.
- [ ] Explain why `m ≡ 1 + 2ᵗ ≡ aₜ₊₁ (mod 2ᵗ⁺¹)`.
- [ ] Verify the survivor `m = 1` avoids every class.
- [ ] Conclude the count is exactly 1, hence `1 = o(k)`.
- [ ] Keep the interval `0 ≤ m < 2ᵏ` distinct from the congruence classes modulo each `2ⁱ`.

## Accuracy, credit, and presentation

- [ ] Check every claim against the source and the repository’s proof; distinguish sourced fact from explanatory interpretation.
- [ ] Name original contributors and link the problem record or primary source.
- [ ] Label the work accurately as a new result, independent proof, exposition, or verification.
- [ ] Do not describe an already recorded counterexample as a new solution.
- [ ] Expand acronyms and replace avoidable jargon; read the explanation aloud for clarity.
- [ ] Keep equations readable and give the audience time to inspect them.
- [ ] Ask a reader from each target background to paraphrase the claim and proof mechanism.
- [ ] Recheck all links, dates, notation, and citations before sharing.
