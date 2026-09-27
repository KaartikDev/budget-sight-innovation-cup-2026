# Editorial package: Erdős Problem 280

## Abstract (150 words)

Erdős Problem 280 asks whether sufficiently rapid growth of a sequence of moduli prevents a small number of integers from avoiding one chosen residue class modulo each modulus. The repository’s mathematical note answers no by presenting and verifying a construction attributed to Stijn Cambie and recorded by T. F. Bloom. Set the ith modulus to 2^i and choose the class 1 + 2^(i−1) modulo 2^i. These moduli satisfy the stated growth condition with ε = 1. Yet, among integers from 0 through 2^k−1, exactly one avoids the first k classes: 1. For every other integer m, the exponent of 2 dividing m−1 identifies a class that contains m; m = 1 escapes all of them. Thus the uncovered count is constantly one, and so is o(k). The note checks growth and coverage separately, and frames its contribution as exposition and independent verification, not a new resolution of the problem posed here.

## Plain-language summary

Can residue classes cover almost every integer even when their moduli grow quickly? The note gives a yes: use moduli 2, 4, 8, and so on, with a carefully chosen class at each step. Each class catches numbers according to the exact power of 2 dividing their difference from 1. In every interval from 0 to 2^k−1, all numbers except 1 are caught by one of the first k classes. The moduli also meet the problem’s growth condition. The result is presented as an exposition and independent verification of Cambie’s counterexample, recorded by Bloom—not as a new resolution.

## Pull quotes / callouts

- **One survivor at every stage:** exactly one integer in `[0, 2^k)` avoids the first `k` classes.
- **The survivor is 1:** it escapes because its difference from each class representative is one less than the modulus.
- **Fast growth is no obstacle here:** the moduli are `2^i` and meet the stated condition with `ε = 1`.
- **A power of two sorts the rest:** `v₂(m−1)` identifies a class covering each `m ≠ 1`.
- **Attribution matters:** the note verifies and explains a counterexample already observed by Stijn Cambie and recorded by T. F. Bloom.

## Suggested article outline

1. **The question:** Explain the residue classes, the interval being counted, and the proposed growth condition in plain language.
2. **The answer and construction:** State that the answer is no; introduce `nᵢ = 2ⁱ` and `aᵢ = 1 + 2ⁱ⁻¹ (mod 2ⁱ)`.
3. **Why the classes cover the interval:** Explain exact powers of two in `m−1`, with `m = 1` as the lone exception; then give the valuation argument, including `m = 0`.
4. **Why the moduli qualify:** Verify `2ᵏ > 2k log k` for `k ≥ 1`, separating the general bound from the small cases.
5. **What the result establishes:** Connect the constant uncovered count to `o(k)` and state the attribution and scope: exposition and independent verification, not a new resolution.

## Title options

1. **One Integer Escapes: A Counterexample to Erdős Problem 280**
2. **When Fast-Growing Moduli Leave Just One Survivor**
3. **The Powers of Two Behind a Counterexample to Erdős Problem 280**
